import { S3CoreDB } from '../src/S3CoreDB';
import { FileSystemStorageAdapter } from '../src/filesystem-storage-adapter';
import { Node, AuthContext } from '../src/types';
import { logger } from '../src/logger';
import { performance } from 'perf_hooks';

logger.level = 'warn';

const formatNumber = (num: number) => num.toLocaleString();
const formatDuration = (ms: number) => `${(ms / 1000).toFixed(8)}s`;

async function runBenchmark(name: string, fn: () => Promise<void>): Promise<number> {
    console.log(`\n🏃 Running benchmark: ${name}`);
    const start = performance.now();
    await fn();
    const duration = performance.now() - start;
    console.log(`✅ Completed in ${formatDuration(duration)}`);
    return duration;
}

const TIMEOUT_DURATION = 300000;
const timeout = (ms: number) => new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms / 1000}s`)), ms));
const raceWithTimeout = (promise: Promise<any>, timeoutMs: number = TIMEOUT_DURATION) => Promise.race([promise, timeout(timeoutMs)]);

async function main() {
    const adapter = new FileSystemStorageAdapter('benchmark-data');
    console.log('🧹 Cleaning up old benchmark data...');
    await adapter.cleanup();
    adapter.configureCacheOptions({
        maxSize: 1000000,
        ttl: 3600000,
        dbCache: {
            enabled: true,
            directory: 'benchmark-cache',
            persistenceInterval: 30000,
            maxCacheAge: 3600000
        }
    });
    const db = new S3CoreDB({ endpoint: "", accessKeyId: "", secretAccessKey: "", bucket: "" }, adapter);

    const auth = { userPermissions: ["create", "read"], isAdmin: true };
    db.setDefaultAuthContext(auth);
    const results: { name: string; size: number; density: number; writeDuration: number; readDuration: number; opsDuration: number; writeOps: number; readOps: number; relationshipOps: number; }[] = [];

    console.log('📊 Starting benchmarks...');

    const testScenarios = [
        { name: "Small Dataset", size: 1000, densities: [1, 2, 3], traversalSamples: 100, readSampleSize: 100, advancedSampleSize: 100, querySampleSize: 100 },
        { name: "Medium Dataset", size: 10000, densities: [1, 2, 3], traversalSamples: 100, readSampleSize: 100, advancedSampleSize: 100, querySampleSize: 100 },
        // { name: "Large Dataset", size: 50000, densities: [1, 2, 3], traversalSamples: 100, readSampleSize: 100, advancedSampleSize: 100, querySampleSize: 100 },
        // { name: "Huge Dataset", size: 100000, densities: [1, 2, 3], traversalSamples: 100, readSampleSize: 100, advancedSampleSize: 100, querySampleSize: 100 },
    ];

    for (const { name, size, densities, traversalSamples, readSampleSize, advancedSampleSize, querySampleSize } of testScenarios) {
        console.log(`\n📊 Testing ${name} with ${formatNumber(size)} nodes`);
        const nodes: Node[] = [];
        let writeOps = 0;
        let readOps = 0;

        const writeDuration = await runBenchmark(`Writing ${formatNumber(size)} nodes`, async () => {
            adapter.startBatch();
            let processed = 0;
            console.log(`Progress: ${processed}/${formatNumber(size)} nodes created`);

            for (let i = 0; i < size; i++) {
                nodes.push(await db.createNode({
                    type: "user",
                    properties: {
                        name: `User ${i}`,
                        age: Math.random() * 50 + 20
                    },
                    permissions: ["read"]
                }));
                writeOps++;
                processed++;
                if (processed % 500 === 0 || processed === size) {
                    await adapter.commitBatch();
                    console.log(`Progress: ${processed}/${formatNumber(size)} nodes created`);
                    adapter.startBatch();
                }
            }
            await adapter.commitBatch();
        });

        const readDuration = await runBenchmark(`Random reads from ${formatNumber(size)} nodes`, async () => {
            for (let i = 0; i < readSampleSize; i++) {
                const node = nodes[Math.floor(Math.random() * nodes.length)];
                await raceWithTimeout(db.getNode(node.id));
                readOps++;
            }
        });

        for (const density of densities) {
            let relationshipOps = 0;
            const opsDuration = await runBenchmark(`Creating relationships with density ${density} for ${formatNumber(size)} nodes`, async () => {
                adapter.startBatch();
                let processed = 0;
                console.log(`Progress: ${processed}/${formatNumber(size)} relationships created`);

                for (const node of nodes) {
                    const targets = new Set<string>();
                    while (targets.size < density) {
                        const targetNode = nodes[Math.floor(Math.random() * nodes.length)];
                        if (targetNode.id !== node.id) {
                            targets.add(targetNode.id);
                        }
                    }
                    for (const target of targets) {
                        await db.createRelationship({
                            from: node.id,
                            to: target,
                            type: "CONNECTED_TO"
                        });
                        relationshipOps++;
                    }
                    processed++;
                    if (processed % 1000 === 0 || processed === size) {
                        await adapter.commitBatch();
                        console.log(`Progress: ${processed}/${formatNumber(size)} relationships created`);
                        adapter.startBatch();
                    }
                }
                await adapter.commitBatch();
            });

            await runBenchmark(`Traversal benchmark (density ${density}, ${traversalSamples} samples)`, async () => {
                // First do a few warmup traversals to populate cache
                console.log('🔥 Warming up traversal cache...');
                const warmupSize = Math.min(10, traversalSamples);
                for (let i = 0; i < warmupSize; i++) {
                    const node = nodes[Math.floor(Math.random() * nodes.length)];
                    await db.queryRelatedNodes(node.id, "CONNECTED_TO");
                }

                console.log(`Running ${traversalSamples} traversals...`);
                const timings: number[] = [];

                for (let i = 0; i < traversalSamples; i++) {
                    const node = nodes[Math.floor(Math.random() * nodes.length)];
                    const start = performance.now();
                    await raceWithTimeout(db.queryRelatedNodes(node.id, "CONNECTED_TO"));
                    timings.push(performance.now() - start);
                }

                const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
                const max = Math.max(...timings);
                const min = Math.min(...timings);
                console.log(`Results:\n- Average: ${formatDuration(avg)}\n- Min: ${formatDuration(min)}\n- Max: ${formatDuration(max)}`);
            });

            await runBenchmark(`Advanced query benchmark - depth 2 traversal (density ${density}, ${advancedSampleSize} samples)`, async () => {
                console.log('🔍 Testing complex relationship traversal...');
                const advancedTimings: number[] = [];

                for (let i = 0; i < advancedSampleSize; i++) {
                    const node = nodes[Math.floor(Math.random() * nodes.length)];
                    const start = performance.now();
                    const firstLevel = await raceWithTimeout(db.queryRelatedNodes(node.id, "CONNECTED_TO"));
                    await Promise.all(
                        firstLevel.map((friend: Node) =>
                            raceWithTimeout(db.queryRelatedNodes(friend.id, "CONNECTED_TO"))
                        )
                    );
                    advancedTimings.push(performance.now() - start);
                }

                const advancedAvg = advancedTimings.reduce((a, b) => a + b, 0) / advancedTimings.length;
                const advancedMax = Math.max(...advancedTimings);
                const advancedMin = Math.min(...advancedTimings);
                console.log(`Advanced Query Results:\n- Average: ${formatDuration(advancedAvg)}\n- Min: ${formatDuration(advancedMin)}\n- Max: ${formatDuration(advancedMax)}`);
            });

            await runBenchmark(`Advanced query benchmark - complex filtering (density ${density}, ${querySampleSize} samples)`, async () => {
                console.log('🔍 Testing complex filtering...');
                const queryTimings: number[] = [];

                for (let i = 0; i < querySampleSize; i++) {
                    const start = performance.now();
                    await raceWithTimeout(db.queryNodesAdvanced({
                        filter: {
                            logic: 'and',
                            filters: [
                                { field: 'type', operator: 'eq', value: 'user' },
                                { field: 'properties.age', operator: 'gt', value: 30 },
                                {
                                    logic: 'or',
                                    filters: [
                                        { field: 'properties.name', operator: 'contains', value: 'User 1' },
                                        { field: 'properties.name', operator: 'contains', value: 'User 2' }
                                    ]
                                }
                            ]
                        },
                        pagination: { limit: 50, offset: 0 }
                    }, auth));
                    queryTimings.push(performance.now() - start);
                }

                const queryAvg = queryTimings.reduce((a, b) => a + b, 0) / queryTimings.length;
                const queryMax = Math.max(...queryTimings);
                const queryMin = Math.min(...queryTimings);
                console.log(`Complex Query Results:\n- Average: ${formatDuration(queryAvg)}\n- Min: ${formatDuration(queryMin)}\n- Max: ${formatDuration(queryMax)}`);
            });

            results.push({
                name,
                size,
                density,
                writeDuration,
                readDuration,
                opsDuration,
                writeOps,
                readOps,
                relationshipOps
            });
        }
    }

    console.log('\n📊 Final Results:');
    console.table(results.map(result => ({
        'Scenario': result.name,
        'Nodes': formatNumber(result.size),
        'Density': result.density,
        'Writes (s)': formatDuration(result.writeDuration),
        'Reads (s)': formatDuration(result.readDuration),
        'Ops (s)': formatDuration(result.opsDuration),
        'Node Writes': formatNumber(result.writeOps),
        'Node Reads': formatNumber(result.readOps),
        'Relationship Ops': formatNumber(result.relationshipOps),
        'Writes/s': formatNumber(Math.round(result.writeOps / (result.writeDuration / 1000))),
        'Reads/s': formatNumber(Math.round(result.readOps / (result.readDuration / 1000))),
        'Ops/s': formatNumber(Math.round((result.writeOps + result.readOps + result.relationshipOps) / ((result.writeDuration + result.readDuration + result.opsDuration) / 1000)))
    })));
}

main().catch(console.error);