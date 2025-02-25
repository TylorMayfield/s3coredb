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
    recordCount: number;
    duration: number;
    recordsPerSecond: number;
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

    // Configure larger cache for benchmarking
    adapter.configureCacheOptions({
        ttl: 30 * 60 * 1000, // 30 minutes
        maxSize: 100000 // Cache up to 100k entries
    });

    console.log("🧹 Cleaning up old benchmark data...");
    await adapter.cleanup();

    const auth: AuthContext = {
        userPermissions: ["create", "read"],
        isAdmin: true
    };
    db.setDefaultAuthContext(auth);

    const results: BenchmarkResults[] = [];
    const datasetSizes = [1000, 10000, 100000]; // Sizes in records
    console.log("📊 Starting benchmarks...");

    try {
        for (const size of datasetSizes) {
            console.log(`\n📊 Testing with ${formatNumber(size)} records`);
            const userNodes: Node[] = [];

            // Benchmark node creation
            const createDuration = await runBenchmark(`Creating ${formatNumber(size)} users`, async () => {
                for (let i = 0; i < size; i++) {
                    const node = await db.createNode({
                        type: "user",
                        properties: {
                            id: `user${i}`,
                            name: `User ${i}`,
                            email: `user${i}@example.com`,
                            age: Math.floor(Math.random() * 50) + 20,
                            city: ["New York", "London", "Tokyo", "Paris", "Berlin"][Math.floor(Math.random() * 5)],
                            interests: ["coding", "reading", "gaming", "sports", "music"].slice(0, Math.floor(Math.random() * 4) + 1)
                        },
                        permissions: ["read"]
                    });
                    userNodes.push(node);
                }
            });
            results.push({
                operation: "Node Creation",
                recordCount: size,
                duration: createDuration,
                recordsPerSecond: (size / (createDuration / 1000))
            });
            console.log(`✅ Created ${formatNumber(size)} users in ${formatDuration(createDuration)}`);

            // Benchmark complex queries
            const complexQueryDuration = await runBenchmark(`Running complex queries on ${formatNumber(size)} records`, async () => {
                await db.queryNodesAdvanced({
                    filter: {
                        logic: 'and',
                        filters: [
                            { field: 'type', operator: 'eq', value: 'user' },
                            { field: 'properties.age', operator: 'gt', value: 30 },
                            { field: 'properties.city', operator: 'eq', value: 'New York' }
                        ]
                    },
                    sort: [{ field: 'properties.age', direction: 'desc' }],
                    pagination: { limit: 100, offset: 0 }
                }, auth);
            });
            results.push({
                operation: "Complex Query",
                recordCount: size,
                duration: complexQueryDuration,
                recordsPerSecond: (size / (complexQueryDuration / 1000))
            });
            console.log(`✅ Completed complex query in ${formatDuration(complexQueryDuration)}`);

            // Create relationships between random users
            const relationshipCount = Math.floor(size * 0.5); // 5% of total nodes
            const relationshipDuration = await runBenchmark(`Creating ${formatNumber(relationshipCount)} relationships`, async () => {
                for (let i = 0; i < relationshipCount; i++) {
                    const fromNode = userNodes[Math.floor(Math.random() * userNodes.length)];
                    let toNode;
                    do {
                        toNode = userNodes[Math.floor(Math.random() * userNodes.length)];
                    } while (toNode.id === fromNode.id);

                    await db.createRelationship({
                        from: fromNode.id,
                        to: toNode.id,
                        type: "FOLLOWS",
                        permissions: ["read"],
                        properties: {
                            since: new Date().toISOString()
                        }
                    });
                }
            });
            results.push({
                operation: "Relationship Creation",
                recordCount: relationshipCount,
                duration: relationshipDuration,
                recordsPerSecond: (relationshipCount / (relationshipDuration / 1000))
            });
            console.log(`✅ Created ${formatNumber(relationshipCount)} relationships in ${formatDuration(relationshipDuration)}`);

            // Benchmark relationship traversal
            const traversalDuration = await runBenchmark(`Traversing relationships for ${formatNumber(size / 100)} users`, async () => {
                for (let i = 0; i < size / 100; i++) {
                    const randomNode = userNodes[Math.floor(Math.random() * userNodes.length)];
                    await db.queryRelatedNodes(randomNode.id, "FOLLOWS", auth, { direction: "OUT" });
                }
            });
            results.push({
                operation: "Relationship Traversal",
                recordCount: size / 100,
                duration: traversalDuration,
                recordsPerSecond: ((size / 100) / (traversalDuration / 1000))
            });
            console.log(`✅ Completed relationship traversal in ${formatDuration(traversalDuration)}`);
        }

        // Print summary
        console.log("\n📈 Benchmark Summary:");
        console.table(results.map(r => ({
            Operation: r.operation,
            "Record Count": formatNumber(r.recordCount),
            Duration: formatDuration(r.duration),
            "Records/Second": formatNumber(Math.floor(r.recordsPerSecond))
        })));

    } catch (error) {
        console.error("❌ Error during benchmark:", error);
    }
}

main().catch(console.error);