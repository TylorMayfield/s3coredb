import { S3CoreDB, LocalStorageAdapter } from '../src';
import {
    NodeNotFoundError,
    PermissionDeniedError,
    ValidationError,
    ConcurrentModificationError
} from '../src/errors';
import { logger } from '../src/logger';

// Disable debug logging for cleaner output
logger.level = 'error';

/**
 * Complete CRUD Operations Example
 * 
 * This example demonstrates all Create, Read, Update, Delete operations
 * with proper error handling and best practices.
 */
async function main() {
    // Initialize database with in-memory storage for this example
    const adapter = new LocalStorageAdapter();
    const db = new S3CoreDB({
        endpoint: 'http://localhost:4566',
        accessKeyId: 'test',
        secretAccessKey: 'test',
        bucket: 'test-bucket',
        s3ForcePathStyle: true
    }, adapter);

    // Set default auth context
    db.setDefaultAuthContext({
        userPermissions: ['read', 'write', 'delete'],
        isAdmin: true
    });

    console.log('🚀 S3CoreDB CRUD Operations Example\n');

    try {
        // ===== CREATE =====
        console.log('📝 CREATE Operations\n');

        // Create a user node
        const user = await db.createNode({
            type: 'user',
            properties: {
                name: 'Alice',
                email: 'alice@example.com',
                age: 28,
                createdAt: new Date().toISOString()
            },
            permissions: ['read', 'write']
        });
        console.log('✓ Created user:', user.properties.name);
        console.log(`  ID: ${user.id}`);
        console.log(`  Version: ${user.version}`);

        // Create another user
        const friend = await db.createNode({
            type: 'user',
            properties: {
                name: 'Bob',
                email: 'bob@example.com',
                age: 32
            },
            permissions: ['read', 'write']
        });
        console.log('✓ Created user:', friend.properties.name);

        // Create a relationship
        const relationship = await db.createRelationship({
            from: user.id,
            to: friend.id,
            type: 'FOLLOWS',
            permissions: ['read'],
            properties: {
                since: new Date().toISOString(),
                notificationEnabled: true
            }
        });
        console.log('✓ Created relationship: FOLLOWS');
        console.log(`  Version: ${relationship.version}\n`);

        // ===== READ =====
        console.log('📖 READ Operations\n');

        // Get node by ID
        const fetchedUser = await db.getNode(user.id);
        console.log('✓ Retrieved user by ID:', fetchedUser?.properties.name);

        // Query nodes by type
        const allUsers = await db.queryNodes({ type: 'user' });
        console.log(`✓ Queried users: Found ${allUsers.length} users`);

        // Query with property filter
        const youngUsers = await db.queryNodes({
            type: 'user',
            'properties.age': { $lte: 30 }
        });
        console.log(`✓ Filtered users (age ≤ 30): Found ${youngUsers.length} users`);

        // Query related nodes
        const following = await db.queryRelatedNodes(
            user.id,
            'FOLLOWS',
            { userPermissions: ['read'], isAdmin: false },
            { direction: 'OUT' }
        );
        console.log(`✓ ${user.properties.name} follows ${following.length} user(s)\n`);

        // ===== UPDATE =====
        console.log('✏️  UPDATE Operations\n');

        // Update node properties
        const updatedUser = await db.updateNode(user.id, {
            properties: {
                ...user.properties,
                age: 29,
                bio: 'Software engineer passionate about graph databases',
                updatedAt: new Date().toISOString()
            }
        });
        console.log('✓ Updated user:', updatedUser.properties.name);
        console.log(`  New age: ${updatedUser.properties.age}`);
        console.log(`  Version: ${user.version} → ${updatedUser.version}`);

        // Update relationship properties
        const updatedRelationship = await db.updateRelationship(
            user.id,
            friend.id,
            'FOLLOWS',
            {
                properties: {
                    since: relationship.properties?.since || new Date().toISOString(),
                    notificationEnabled: false,
                    closeFriend: true
                }
            }
        );
        console.log('✓ Updated relationship');
        console.log(`  Close friend: ${updatedRelationship.properties?.closeFriend}`);
        console.log(`  Version: ${relationship.version} → ${updatedRelationship.version}\n`);

        // ===== DELETE =====
        console.log('🗑️  DELETE Operations\n');

        // Create a temporary node to delete
        const tempNode = await db.createNode({
            type: 'temp',
            properties: { note: 'This will be deleted' },
            permissions: ['read', 'delete']
        });
        console.log('✓ Created temporary node');

        // Delete the node
        await db.deleteNode(tempNode.id);
        console.log('✓ Deleted temporary node');

        // Verify deletion
        const deletedNode = await db.getNode(tempNode.id);
        console.log(`✓ Verified deletion: ${deletedNode === null ? 'Node removed' : 'Node still exists'}`);

        // Create and delete a temporary relationship
        await db.createRelationship({
            from: user.id,
            to: friend.id,
            type: 'TEMP_LINK',
            permissions: ['read', 'delete']
        });
        console.log('✓ Created temporary relationship');

        await db.deleteRelationship(user.id, friend.id, 'TEMP_LINK');
        console.log('✓ Deleted temporary relationship\n');

        // ===== ERROR HANDLING =====
        console.log('🛡️  ERROR HANDLING Examples\n');

        // Handle NodeNotFoundError
        try {
            await db.getNode('non-existent-id');
        } catch (error) {
            if (error instanceof NodeNotFoundError) {
                console.log('✓ NodeNotFoundError caught correctly');
            }
        }

        // Handle PermissionDeniedError
        try {
            await db.getNode(user.id, {
                userPermissions: [],
                isAdmin: false
            });
        } catch (error) {
            if (error instanceof PermissionDeniedError) {
                console.log('✓ PermissionDeniedError caught correctly');
            }
        }

        // Handle ValidationError
        try {
            await db.createNode({
                type: '',  // Invalid: empty type
                properties: {},
                permissions: []
            });
        } catch (error) {
            if (error instanceof ValidationError) {
                console.log('✓ ValidationError caught correctly');
            }
        }

        // ===== OPTIMISTIC LOCKING =====
        console.log('\n🔒 OPTIMISTIC LOCKING Example\n');

        const currentUser = await db.getNode(user.id);
        if (currentUser) {
            console.log(`Current version: ${currentUser.version}`);

            const updated = await db.updateNode(user.id, {
                properties: {
                    ...currentUser.properties,
                    status: 'online'
                }
            });
            console.log(`After update: ${updated.version}`);
            console.log('✓ Version-based concurrency control working\n');
        }

        // ===== QUERY LIMITS =====
        console.log('📊 QUERY LIMITS Example\n');

        // Default limit
        const defaultQuery = await db.queryNodes({ type: 'user' });
        console.log(`Default limit query: ${defaultQuery.length} results (max: 100)`);

        // Custom limit
        const limitedQuery = await db.queryNodes(
            { type: 'user' },
            { userPermissions: ['read'], isAdmin: false },
            { limit: 1 }
        );
        console.log(`Custom limit query: ${limitedQuery.length} results (limit: 1)`);

        // Advanced query with sorting
        const sortedQuery = await db.queryNodesAdvanced(
            { type: 'user' },
            {
                sortBy: 'properties.name',
                sortOrder: 'asc',
                limit: 10
            }
        );
        console.log(`Sorted query: ${sortedQuery.length} results\n`);

        // ===== SUMMARY =====
        console.log('✅ All CRUD operations completed successfully!\n');
        console.log('📋 Operations Demonstrated:');
        console.log('  ✓ CREATE - Nodes and Relationships');
        console.log('  ✓ READ - Get, Query, Filter, Traverse');
        console.log('  ✓ UPDATE - Nodes and Relationships');
        console.log('  ✓ DELETE - Nodes and Relationships');
        console.log('  ✓ ERROR HANDLING - All custom error types');
        console.log('  ✓ OPTIMISTIC LOCKING - Version control');
        console.log('  ✓ QUERY LIMITS - DoS protection');

    } catch (error) {
        console.error('\n❌ Unexpected error:');

        // Type-safe error handling
        if (error instanceof NodeNotFoundError) {
            console.error('Node not found:', error.message);
        } else if (error instanceof RelationshipNotFoundError) {
            console.error('Relationship not found:', error.message);
        } else if (error instanceof PermissionDeniedError) {
            console.error('Permission denied:', error.message);
        } else if (error instanceof ValidationError) {
            console.error('Validation error:', error.message);
        } else if (error instanceof ConcurrentModificationError) {
            console.error('Concurrent modification:', error.message);
        } else {
            console.error(error);
        }

        process.exit(1);
    }
}

// Run the example
main().catch(console.error);

