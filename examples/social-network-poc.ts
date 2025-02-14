import { S3CoreDB } from '../src/S3CoreDB';
import { FileSystemStorageAdapter } from '../src/filesystem-storage-adapter';
import { AuthContext } from '../src/types';

async function main() {
    // Initialize DB with FileSystemStorageAdapter, store data in a 'db-data' directory
    const adapter = new FileSystemStorageAdapter('db-data');
    const db = new S3CoreDB({
        endpoint: "http://localhost:4566",
        accessKeyId: "test",
        secretAccessKey: "test",
        bucket: "test-bucket",
        s3ForcePathStyle: true
    }, adapter);

    // Clean up any existing test data
    console.log("🧹 Cleaning up old data...");
    await adapter.cleanup();

    // Simple auth context for demo
    db.setDefaultAuthContext({
        userPermissions: ["create", "read"],
        isAdmin: true
    });

    try {
        // 1. Create users
        console.log("\n📝 Creating users...");
        const alice = await db.createNode({
            type: "user",
            properties: { 
                name: "Alice", 
                interests: ["coding", "graph databases"],
                joinDate: new Date().toISOString()
            },
            permissions: ["read"]
        });
        console.log(`Created user: ${alice.properties.name} (ID: ${alice.id})`);

        const bob = await db.createNode({
            type: "user",
            properties: { 
                name: "Bob", 
                interests: ["photography", "databases"],
                joinDate: new Date().toISOString()
            },
            permissions: ["read"]
        });
        console.log(`Created user: ${bob.properties.name} (ID: ${bob.id})`);

        const charlie = await db.createNode({
            type: "user",
            properties: { 
                name: "Charlie", 
                interests: ["hiking", "coding"],
                joinDate: new Date().toISOString()
            },
            permissions: ["read"]
        });
        console.log(`Created user: ${charlie.properties.name} (ID: ${charlie.id})`);

        // 2. Create relationships
        console.log("\n🤝 Creating relationships...");
        
        // Alice follows Bob
        await db.createRelationship({
            from: alice.id,
            to: bob.id,
            type: "FOLLOWS",
            permissions: ["read"],
            properties: {
                since: new Date().toISOString(),
                notificationPreference: "all"
            }
        });
        console.log("Created: Alice -> FOLLOWS -> Bob");

        // Bob follows Charlie
        await db.createRelationship({
            from: bob.id,
            to: charlie.id,
            type: "FOLLOWS",
            permissions: ["read"],
            properties: {
                since: new Date().toISOString(),
                notificationPreference: "mentions"
            }
        });
        console.log("Created: Bob -> FOLLOWS -> Charlie");

        // 3. Query examples
        console.log("\n🔍 Querying followers...");
        const bobFollowers = await db.queryRelatedNodes(
            bob.id,
            "FOLLOWS",
            { userPermissions: ["read"], isAdmin: false },
            { direction: "IN" }
        );

        if (bobFollowers.length === 0) {
            console.log("No followers found for Bob");
        } else {
            bobFollowers.forEach(follower => {
                console.log(`${follower.properties.name} follows Bob`);
            });
        }

        // 4. Query by property (now with deduplication)
        console.log("\n🔎 Querying users interested in coding or databases...");
        const techUsers = await db.queryNodes({
            type: "user",
            "properties.interests": ["coding", "databases"]
        });
        
        if (techUsers.length === 0) {
            console.log("No users found with matching interests");
        } else {
            techUsers.forEach(user => {
                console.log(`${user.properties.name} is interested in: ${user.properties.interests.join(', ')}`);
            });
        }

        console.log("\n💾 Data has been persisted to the 'db-data' directory. Check the following locations:");
        console.log("- Nodes: ./db-data/nodes/");
        console.log("- Relationships: ./db-data/relationships/");

    } catch (error) {
        console.error("❌ Error in POC:", error);
        process.exit(1);
    }
}

main();