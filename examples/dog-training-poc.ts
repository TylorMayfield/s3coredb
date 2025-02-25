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
        endpoint: "http://localhost:4566",
        accessKeyId: "test",
        secretAccessKey: "test",
        bucket: "test-bucket",
        s3ForcePathStyle: true
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

    } catch (error) {
        console.error("Error in dog training POC:", error);
    }
}

main().catch(console.error);