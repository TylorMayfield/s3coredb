import { S3CoreDB } from '../src/S3CoreDB';
import { FileSystemStorageAdapter } from '../src/filesystem-storage-adapter';
import { Node, AuthContext } from '../src/types';
import { logger } from '../src/logger';
import { performance } from 'perf_hooks';

// Disable debug logging for cleaner output
logger.level = 'warn';

// Utility functions for benchmarking
function formatNumber(num: number): string {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatDuration(ms: number): string {
    return `${(ms / 1000).toFixed(2)}s`;
}

async function runBenchmark(name: string, fn: () => Promise<void>) {
    console.log(`\n🏃 Running benchmark: ${name}`);
    const start = performance.now();
    await fn();
    const duration = performance.now() - start;
    console.log(`✅ Completed in ${formatDuration(duration)}`);
    return duration;
}

interface BenchmarkResults {
    operation: string;
    databaseSize: number;
    relationshipDensity?: number;
    duration: number;
    operationsPerSecond: number;
}

async function main() {
    const adapter = new FileSystemStorageAdapter('benchmark-data');
    const db = new S3CoreDB({
        endpoint: "",
        accessKeyId: "",
        secretAccessKey: "",
        bucket: "",
        s3ForcePathStyle: false
    }, adapter);

    console.log("🧹 Cleaning up old benchmark data...");
    await adapter.cleanup();

    const auth: AuthContext = {
        userPermissions: ["create", "read"],
        isAdmin: true
    };
    db.setDefaultAuthContext(auth);

    const results: BenchmarkResults[] = [];
    
    // Test different database sizes
    const databaseSizes = [1000, 10000, 50000];
    // Test different relationship densities (avg relationships per node)
    const relationshipDensities = [1, 5, 10];

    console.log("📊 Starting benchmarks...");

    try {
        // First create the base dataset for each size
        for (const size of databaseSizes) {
            console.log(`\n📊 Testing with ${formatNumber(size)} nodes`);
            const nodes: Node[] = [];

            // 1. Write Performance Test
            adapter.startBatch();
            const writeDuration = await runBenchmark(`Writing ${formatNumber(size)} nodes`, async () => {
                for (let i = 0; i < size; i++) {
                    const node = await db.createNode({
                        type: "user",
                        properties: {
                            name: `User ${i}`,
                            age: Math.floor(Math.random() * 50) + 20,
                            active: Math.random() > 0.5,
                            score: Math.random() * 100
                        },
                        permissions: ["read"]
                    });
                    nodes.push(node);
                }
            });
            await adapter.commitBatch();

            results.push({
                operation: "Write",
                databaseSize: size,
                duration: writeDuration,
                operationsPerSecond: (size / (writeDuration / 1000))
            });

            // 2. Read Performance Test
            const readDuration = await runBenchmark(`Random reads from ${formatNumber(size)} nodes`, async () => {
                // Perform random reads totaling 20% of database size
                const readCount = Math.floor(size * 0.2);
                for (let i = 0; i < readCount; i++) {
                    const randomNode = nodes[Math.floor(Math.random() * nodes.length)];
                    await db.getNode(randomNode.id);
                }
            });

            results.push({
                operation: "Read",
                databaseSize: size,
                duration: readDuration,
                operationsPerSecond: (Math.floor(size * 0.2) / (readDuration / 1000))
            });

            // 3. Test different relationship densities
            for (const density of relationshipDensities) {
                adapter.startBatch();
                const relationshipDuration = await runBenchmark(
                    `Creating relationships with density ${density} for ${formatNumber(size)} nodes`, 
                    async () => {
                        // For each node, create N relationships where N is the density
                        for (const node of nodes) {
                            for (let i = 0; i < density; i++) {
                                let targetNode;
                                do {
                                    targetNode = nodes[Math.floor(Math.random() * nodes.length)];
                                } while (targetNode.id === node.id);

                                await db.createRelationship({
                                    from: node.id,
                                    to: targetNode.id,
                                    type: "CONNECTED_TO",
                                    permissions: ["read"],
                                    properties: {
                                        weight: Math.random()
                                    }
                                });
                            }
                        }
                    }
                );
                await adapter.commitBatch();

                results.push({
                    operation: "Create Relationships",
                    databaseSize: size,
                    relationshipDensity: density,
                    duration: relationshipDuration,
                    operationsPerSecond: (size * density / (relationshipDuration / 1000))
                });

                // 4. Test relationship traversal performance
                const traversalDuration = await runBenchmark(
                    `Traversing relationships with density ${density} for ${formatNumber(size)} nodes`,
                    async () => {
                        // Query related nodes for 10% of the nodes
                        const sampleSize = Math.floor(size * 0.1);
                        for (let i = 0; i < sampleSize; i++) {
                            const randomNode = nodes[Math.floor(Math.random() * nodes.length)];
                            await db.queryRelatedNodes(randomNode.id, "CONNECTED_TO");
                        }
                    }
                );

                results.push({
                    operation: "Traverse Relationships",
                    databaseSize: size,
                    relationshipDensity: density,
                    duration: traversalDuration,
                    operationsPerSecond: (Math.floor(size * 0.1) / (traversalDuration / 1000))
                });

                // Test advanced query performance
                const advancedQueryDuration = await runBenchmark(
                    `Running advanced queries with complex filters on ${formatNumber(size)} nodes`,
                    async () => {
                        // Complex filter with AND/OR conditions
                        await db.queryNodesAdvanced({
                            filter: {
                                logic: 'and',
                                filters: [
                                    { field: 'type', operator: 'eq', value: 'user' },
                                    { 
                                        logic: 'or',
                                        filters: [
                                            { field: 'properties.age', operator: 'gt', value: 30 },
                                            { field: 'properties.active', operator: 'eq', value: true }
                                        ]
                                    }
                                ]
                            },
                            sort: [{ field: 'age', direction: 'desc' }],
                            aggregations: [
                                { field: 'age', operator: 'avg', alias: 'avgAge' },
                                { field: 'age', operator: 'max', alias: 'maxAge' },
                                { field: 'type', operator: 'count', alias: 'total' }
                            ],
                            pagination: { offset: 0, limit: 100 }
                        }, auth);
                    }
                );

                results.push({
                    operation: "Advanced Query",
                    databaseSize: size,
                    relationshipDensity: density,
                    duration: advancedQueryDuration,
                    operationsPerSecond: (1 / (advancedQueryDuration / 1000)) // 1 complex query per execution
                });
            }
        }

        // Print final summary
        console.log("\n📊 Benchmark Summary:");
        console.table(results.map(r => ({
            Operation: r.operation,
            "Database Size": formatNumber(r.databaseSize),
            "Relationship Density": r.relationshipDensity || "N/A",
            Duration: formatDuration(r.duration),
            "Ops/Second": formatNumber(Math.floor(r.operationsPerSecond))
        })));

    } catch (error) {
        console.error("❌ Error during benchmark:", error);
    }
}

main().catch(console.error);