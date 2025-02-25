import { S3CoreDB } from "../src/S3CoreDB";
import { S3StorageAdapter } from "../src/s3-storage-adapter";
import { Node } from "../src/types";
import { FileSystemStorageAdapter } from '../src/filesystem-storage-adapter';
import { logger } from '../src/logger';

// Disable debug logging for cleaner output
logger.level = 'warn';

async function main() {
    // Initialize the storage adapter and database
    const adapter = new FileSystemStorageAdapter('db-data');
    const db = new S3CoreDB({
        // Using filesystem adapter doesn't need S3 config
        endpoint: "",
        accessKeyId: "",
        secretAccessKey: "",
        bucket: "",
        s3ForcePathStyle: false
    }, adapter);

    console.log("🧹 Cleaning up old data...");
    await adapter.cleanup();

    // Set default auth context to allow operations
    db.setDefaultAuthContext({
        userPermissions: ["create", "read"],
        isAdmin: true
    });

    try {
        // Create a trainer
        const trainer = await db.createNode({
            type: "trainer",
            properties: {
                name: "John Smith",
                specialties: ["behavior modification", "puppy training", "obedience"],
                certifications: ["CPDT-KA", "AKC CGC Evaluator"],
                email: "john.smith@example.com"
            },
            permissions: ["read"]
        });
        console.log(`Created trainer: ${trainer.properties.name}`);

        // Create another trainer with different specialties
        const trainer2 = await db.createNode({
            type: "trainer",
            properties: {
                name: "Sarah Wilson",
                specialties: ["agility", "therapy dog training", "tricks"],
                certifications: ["CPDT-KA", "CTDI"],
                email: "sarah.wilson@example.com"
            },
            permissions: ["read"]
        });
        console.log(`Created trainer: ${trainer2.properties.name}`);

        // Create training packages
        const basicPackage = await db.createNode({
            type: "package",
            properties: {
                name: "Basic Obedience Package",
                description: "6-week program covering basic commands and house manners",
                duration: "6 weeks",
                sessionsCount: 6,
                price: 299.99
            },
            permissions: ["read"]
        });

        const advancedPackage = await db.createNode({
            type: "package",
            properties: {
                name: "Advanced Training Package",
                description: "8-week program for advanced commands and behavior modification",
                duration: "8 weeks",
                sessionsCount: 12,
                price: 499.99
            },
            permissions: ["read"]
        });

        // Create clients with their dogs
        const client1 = await db.createNode({
            type: "client",
            properties: {
                name: "Alice Johnson",
                email: "alice@example.com",
                phone: "555-0101"
            },
            permissions: ["read"]
        });

        const dog1 = await db.createNode({
            type: "dog",
            properties: {
                name: "Max",
                breed: "Golden Retriever",
                age: 1.5,
                issues: ["pulling on leash", "jumping on people"]
            },
            permissions: ["read"]
        });

        const client2 = await db.createNode({
            type: "client",
            properties: {
                name: "Bob Wilson",
                email: "bob@example.com",
                phone: "555-0102"
            },
            permissions: ["read"]
        });

        const dog2 = await db.createNode({
            type: "dog",
            properties: {
                name: "Luna",
                breed: "German Shepherd",
                age: 2,
                issues: ["anxiety", "excessive barking"]
            },
            permissions: ["read"]
        });

        // Add another dog without behavior issues to verify filtering
        const dog3 = await db.createNode({
            type: "dog",
            properties: {
                name: "Bella",
                breed: "Labrador Retriever",
                age: 3,
                issues: ["food stealing"]
            },
            permissions: ["read"]
        });

        // Create relationships
        console.log("\n🤝 Creating relationship network...");
        
        // Connect trainers to packages
        await db.createRelationship({
            from: trainer.id,
            to: basicPackage.id,
            type: "OFFERS",
            permissions: ["read"],
            properties: { since: "2023-01-01" }
        });

        await db.createRelationship({
            from: trainer.id,
            to: advancedPackage.id,
            type: "OFFERS",
            permissions: ["read"],
            properties: { since: "2023-01-01" }
        });

        // Connect clients to their dogs
        await db.createRelationship({
            from: client1.id,
            to: dog1.id,
            type: "OWNS",
            permissions: ["read"],
            properties: { since: "2022-06-15" }
        });

        await db.createRelationship({
            from: client2.id,
            to: dog2.id,
            type: "OWNS",
            permissions: ["read"],
            properties: { since: "2021-12-01" }
        });

        // Subscribe clients to packages
        await db.createRelationship({
            from: client1.id,
            to: basicPackage.id,
            type: "SUBSCRIBED_TO",
            permissions: ["read"],
            properties: { 
                startDate: "2023-06-01",
                endDate: "2023-07-15",
                status: "active"
            }
        });

        await db.createRelationship({
            from: client2.id,
            to: advancedPackage.id,
            type: "SUBSCRIBED_TO",
            permissions: ["read"],
            properties: { 
                startDate: "2023-06-15",
                endDate: "2023-08-15",
                status: "active"
            }
        });

        // Create training sessions with notes
        const session1 = await db.createNode({
            type: "session",
            properties: {
                date: "2023-06-01",
                duration: 60,
                notes: "Max showed good progress with basic commands. Need to work more on loose leash walking.",
                homework: "Practice 'heel' command 3x daily for 10 minutes"
            },
            permissions: ["read"]
        });

        // Link session to client, dog, and package
        await Promise.all([
            db.createRelationship({
                from: session1.id,
                to: client1.id,
                type: "SESSION_FOR",
                permissions: ["read"],
                properties: {}
            }),
            db.createRelationship({
                from: session1.id,
                to: dog1.id,
                type: "SESSION_WITH",
                permissions: ["read"],
                properties: {}
            }),
            db.createRelationship({
                from: session1.id,
                to: basicPackage.id,
                type: "PART_OF",
                permissions: ["read"],
                properties: { sessionNumber: 1 }
            })
        ]);

        // Query Examples
        console.log("\n🔍 Finding all clients for a trainer...");
        const readAuth = { userPermissions: ["read"] };

        // Get all packages offered by the trainer
        const trainerPackages = await db.queryRelatedNodes(
            trainer.id,
            "OFFERS",
            readAuth,
            { direction: "OUT" }
        );

        // For each package, find subscribed clients
        for (const package_ of trainerPackages) {
            const subscribers = await db.queryRelatedNodes(
                package_.id,
                "SUBSCRIBED_TO",
                readAuth,
                { direction: "IN" }
            );
            
            console.log(`\nSubscribers to ${package_.properties.name}:`);
            for (const subscriber of subscribers) {
                // Get subscriber's dog
                const [dogs, sessions] = await Promise.all([
                    db.queryRelatedNodes(subscriber.id, "OWNS", readAuth, { direction: "OUT" }),
                    db.queryRelatedNodes(subscriber.id, "SESSION_FOR", readAuth, { direction: "IN" })
                ]);

                console.log(`- ${subscriber.properties.name} with dog ${dogs[0]?.properties.name}`);
                console.log(`  Latest session notes: ${sessions[0]?.properties.notes}`);
            }
        }

        // Advanced Query Examples
        console.log("\n📊 Running advanced queries...");

        // Find all dogs with specific issues and age > 1, sorted by age
        const dogQuery = await db.queryNodesAdvanced({
            filter: {
                logic: 'and',
                filters: [
                    { field: 'type', operator: 'eq', value: 'dog' },
                    { field: 'properties.age', operator: 'gt', value: 1 },
                    { 
                        logic: 'or',
                        filters: [
                            { field: 'properties.issues', operator: 'contains', value: 'anxiety' },
                            { field: 'properties.issues', operator: 'contains', value: 'pulling on leash' }
                        ]
                    }
                ]
            },
            sort: [{ field: 'properties.age', direction: 'desc' }],
            pagination: { limit: 10, offset: 0 }
        }, readAuth);

        console.log("\nDogs with behavior issues (age > 1):");
        if (dogQuery.items.length > 0) {
            dogQuery.items.forEach(dog => {
                console.log(`- ${dog.properties.name} (${dog.properties.age} years): ${dog.properties.issues.join(', ')}`);
            });
        } else {
            console.log("No matching dogs found");
        }

        // Get package statistics
        const packageStats = await db.queryNodesAdvanced({
            filter: { field: 'type', operator: 'eq', value: 'package' },
            aggregations: [
                { field: 'properties.price', operator: 'avg', alias: 'avg_price' },
                { field: 'properties.price', operator: 'min', alias: 'min_price' },
                { field: 'properties.price', operator: 'max', alias: 'max_price' },
                { field: 'properties.sessionsCount', operator: 'sum', alias: 'total_sessions' }
            ]
        }, readAuth);

        console.log("\nPackage Statistics:");
        if (packageStats.aggregations) {
            const { avg_price, min_price, max_price, total_sessions } = packageStats.aggregations;
            if (typeof avg_price === 'number') console.log(`Average Price: $${avg_price.toFixed(2)}`);
            if (typeof min_price === 'number' && typeof max_price === 'number') {
                console.log(`Price Range: $${min_price.toFixed(2)} - $${max_price.toFixed(2)}`);
            }
            if (typeof total_sessions === 'number') console.log(`Total Available Sessions: ${total_sessions}`);
        } else {
            console.log("No package statistics available");
        }

        // Get session statistics
        const sessionStats = await db.queryNodesAdvanced({
            filter: { field: 'type', operator: 'eq', value: 'session' },
            aggregations: [
                { field: 'properties.duration', operator: 'avg', alias: 'avg_duration' },
                { field: 'type', operator: 'count', alias: 'session_count' }
            ]
        }, readAuth);

        console.log("\nSession Statistics:");
        if (sessionStats.aggregations) {
            const { avg_duration, session_count } = sessionStats.aggregations;
            if (typeof avg_duration === 'number') {
                console.log(`Average Duration: ${avg_duration.toFixed(1)} minutes`);
            }
            if (typeof session_count === 'number') {
                console.log(`Total Sessions: ${session_count}`);
            }
        } else {
            console.log("No session statistics available");
        }

    } catch (error) {
        console.error("Error in dog training POC:", error);
    }
}

main().catch(console.error);