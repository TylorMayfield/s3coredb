import { S3CoreDB } from '../S3CoreDB';
import { LocalStorageAdapter } from '../local-storage-adapter';
import { FileSystemStorageAdapter } from '../filesystem-storage-adapter';
import { Node, AuthContext, Relationship } from '../types';
import * as fs from 'fs/promises';

describe('Integration Tests', () => {
    describe('Local Storage Adapter Integration', () => {
        let db: S3CoreDB;
        const authContext: AuthContext = {
            userPermissions: ['create', 'read'],
            isAdmin: false
        };

        beforeEach(() => {
            const adapter = new LocalStorageAdapter();
            db = new S3CoreDB(
                {
                    endpoint: 'http://localhost:4566',
                    accessKeyId: 'test',
                    secretAccessKey: 'test',
                    bucket: 'test-bucket'
                },
                adapter
            );
            db.setDefaultAuthContext(authContext);
        });

        it('should handle complete CRUD workflow', async () => {
            // Create
            const user = await db.createNode({
                type: 'user',
                properties: {
                    name: 'Alice',
                    email: 'alice@example.com',
                    age: 30
                },
                permissions: ['read']
            });

            expect(user).toHaveProperty('id');
            expect(user.properties.name).toBe('Alice');

            // Read
            const retrieved = await db.getNode(user.id);
            expect(retrieved).not.toBeNull();
            expect(retrieved?.properties.email).toBe('alice@example.com');

            // Query
            const users = await db.queryNodes({
                type: 'user',
                'properties.name': 'Alice'
            });
            expect(users.length).toBe(1);
            expect(users[0].id).toBe(user.id);
        });

        it('should handle social network workflow', async () => {
            // Create multiple users
            const alice = await db.createNode({
                type: 'user',
                properties: { name: 'Alice', bio: 'Software Engineer' },
                permissions: ['read']
            });

            const bob = await db.createNode({
                type: 'user',
                properties: { name: 'Bob', bio: 'Designer' },
                permissions: ['read']
            });

            const charlie = await db.createNode({
                type: 'user',
                properties: { name: 'Charlie', bio: 'Manager' },
                permissions: ['read']
            });

            // Create follow relationships
            await db.createRelationship({
                from: alice.id,
                to: bob.id,
                type: 'FOLLOWS',
                permissions: ['read'],
                properties: { since: '2024-01-01' }
            });

            await db.createRelationship({
                from: alice.id,
                to: charlie.id,
                type: 'FOLLOWS',
                permissions: ['read'],
                properties: { since: '2024-01-15' }
            });

            await db.createRelationship({
                from: bob.id,
                to: alice.id,
                type: 'FOLLOWS',
                permissions: ['read'],
                properties: { since: '2024-01-10' }
            });

            // Query: Who does Alice follow?
            const aliceFollowing = await db.queryRelatedNodes(
                alice.id,
                'FOLLOWS',
                authContext,
                { direction: 'OUT' }
            );

            expect(aliceFollowing.length).toBe(2);
            const followingNames = aliceFollowing.map(u => u.properties.name).sort();
            expect(followingNames).toEqual(['Bob', 'Charlie']);

            // Query: Who follows Alice?
            const aliceFollowers = await db.queryRelatedNodes(
                alice.id,
                'FOLLOWS',
                authContext,
                { direction: 'IN' }
            );

            expect(aliceFollowers.length).toBe(1);
            expect(aliceFollowers[0].properties.name).toBe('Bob');

            // Mutual follow check
            const bobFollowing = await db.queryRelatedNodes(
                bob.id,
                'FOLLOWS',
                authContext,
                { direction: 'OUT' }
            );

            const mutualFollows = aliceFollowing.filter(user =>
                bobFollowing.some(u => u.id === user.id)
            );

            // Alice and Bob don't have mutual follows (they follow each other but no common third party)
            expect(mutualFollows.length).toBe(0);
        });

        it('should handle content publishing workflow', async () => {
            // Create author
            const author = await db.createNode({
                type: 'user',
                properties: { name: 'Author', role: 'writer' },
                permissions: ['read']
            });

            // Create posts
            const post1 = await db.createNode({
                type: 'post',
                properties: {
                    title: 'Introduction to Graph Databases',
                    content: 'Graph databases are...',
                    publishedAt: new Date().toISOString()
                },
                permissions: ['read']
            });

            const post2 = await db.createNode({
                type: 'post',
                properties: {
                    title: 'Advanced Graph Queries',
                    content: 'Advanced querying techniques...',
                    publishedAt: new Date().toISOString()
                },
                permissions: ['read']
            });

            // Link author to posts
            await db.createRelationship({
                from: author.id,
                to: post1.id,
                type: 'AUTHORED',
                permissions: ['read']
            });

            await db.createRelationship({
                from: author.id,
                to: post2.id,
                type: 'AUTHORED',
                permissions: ['read']
            });

            // Create reader
            const reader = await db.createNode({
                type: 'user',
                properties: { name: 'Reader' },
                permissions: ['read']
            });

            // Reader likes a post
            await db.createRelationship({
                from: reader.id,
                to: post1.id,
                type: 'LIKES',
                permissions: ['read']
            });

            // Query: What posts did the author write?
            const authoredPosts = await db.queryRelatedNodes(
                author.id,
                'AUTHORED',
                authContext,
                { direction: 'OUT' }
            );

            expect(authoredPosts.length).toBe(2);

            // Query: What posts does the reader like?
            const likedPosts = await db.queryRelatedNodes(
                reader.id,
                'LIKES',
                authContext,
                { direction: 'OUT' }
            );

            expect(likedPosts.length).toBe(1);
            expect(likedPosts[0].properties.title).toBe('Introduction to Graph Databases');
        });

        it('should handle multi-level permission hierarchy', async () => {
            // Create nodes with different permission levels
            const publicNode = await db.createNode({
                type: 'document',
                properties: { title: 'Public Document', level: 'public' },
                permissions: ['read']
            });

            const internalNode = await db.createNode({
                type: 'document',
                properties: { title: 'Internal Document', level: 'internal' },
                permissions: ['internal']
            });

            const secretNode = await db.createNode({
                type: 'document',
                properties: { title: 'Secret Document', level: 'secret' },
                permissions: ['secret']
            });

            // Public user
            const publicAuth: AuthContext = {
                userPermissions: ['read'],
                isAdmin: false
            };

            const publicResults = await db.queryNodes({ type: 'document' }, publicAuth);
            expect(publicResults.length).toBe(1);
            expect(publicResults[0].properties.level).toBe('public');

            // Internal user
            const internalAuth: AuthContext = {
                userPermissions: ['read', 'internal'],
                isAdmin: false
            };

            const internalResults = await db.queryNodes({ type: 'document' }, internalAuth);
            expect(internalResults.length).toBe(2);

            // Secret user (has all permissions)
            const secretAuth: AuthContext = {
                userPermissions: ['read', 'internal', 'secret'],
                isAdmin: false
            };

            const secretResults = await db.queryNodes({ type: 'document' }, secretAuth);
            expect(secretResults.length).toBe(3);

            // Admin can see everything
            const adminAuth: AuthContext = {
                userPermissions: [],
                isAdmin: true
            };

            const adminResults = await db.queryNodes({ type: 'document' }, adminAuth);
            expect(adminResults.length).toBe(3);
        });

        it('should handle recommendation system workflow', async () => {
            // Create products
            const laptop = await db.createNode({
                type: 'product',
                properties: { name: 'Laptop', category: 'electronics', price: 1200 },
                permissions: ['read']
            });

            const mouse = await db.createNode({
                type: 'product',
                properties: { name: 'Mouse', category: 'electronics', price: 25 },
                permissions: ['read']
            });

            const keyboard = await db.createNode({
                type: 'product',
                properties: { name: 'Keyboard', category: 'electronics', price: 80 },
                permissions: ['read']
            });

            const book = await db.createNode({
                type: 'product',
                properties: { name: 'Programming Book', category: 'books', price: 40 },
                permissions: ['read']
            });

            // Create users
            const user1 = await db.createNode({
                type: 'user',
                properties: { name: 'Tech Enthusiast' },
                permissions: ['read']
            });

            const user2 = await db.createNode({
                type: 'user',
                properties: { name: 'Developer' },
                permissions: ['read']
            });

            // User 1 purchases
            await db.createRelationship({
                from: user1.id,
                to: laptop.id,
                type: 'PURCHASED',
                permissions: ['read']
            });

            await db.createRelationship({
                from: user1.id,
                to: mouse.id,
                type: 'PURCHASED',
                permissions: ['read']
            });

            // User 2 purchases
            await db.createRelationship({
                from: user2.id,
                to: laptop.id,
                type: 'PURCHASED',
                permissions: ['read']
            });

            await db.createRelationship({
                from: user2.id,
                to: keyboard.id,
                type: 'PURCHASED',
                permissions: ['read']
            });

            await db.createRelationship({
                from: user2.id,
                to: book.id,
                type: 'PURCHASED',
                permissions: ['read']
            });

            // Find what user1 purchased
            const user1Purchases = await db.queryRelatedNodes(
                user1.id,
                'PURCHASED',
                authContext,
                { direction: 'OUT' }
            );

            expect(user1Purchases.length).toBe(2);

            // Find what user2 purchased
            const user2Purchases = await db.queryRelatedNodes(
                user2.id,
                'PURCHASED',
                authContext,
                { direction: 'OUT' }
            );

            expect(user2Purchases.length).toBe(3);

            // Find products in electronics category
            const electronics = await db.queryNodes({
                type: 'product',
                'properties.category': 'electronics'
            });

            expect(electronics.length).toBe(3);
        });
    });

    describe('FileSystem Storage Adapter Integration', () => {
        let db: S3CoreDB;
        const testDir = 'test-integration-db';
        const authContext: AuthContext = {
            userPermissions: ['create', 'read'],
            isAdmin: false
        };

        beforeEach(async () => {
            const adapter = new FileSystemStorageAdapter(testDir);
            db = new S3CoreDB(
                {
                    endpoint: 'http://localhost:4566',
                    accessKeyId: 'test',
                    secretAccessKey: 'test',
                    bucket: 'test-bucket'
                },
                adapter
            );
            db.setDefaultAuthContext(authContext);
            // Wait for initialization
            await new Promise(resolve => setTimeout(resolve, 100));
        });

        afterEach(async () => {
            try {
                await fs.rm(testDir, { recursive: true, force: true });
            } catch (error) {
                // Ignore cleanup errors
            }
        });

        it('should persist data across operations', async () => {
            // Create multiple nodes
            const nodes = await Promise.all([
                db.createNode({
                    type: 'user',
                    properties: { name: 'User1' },
                    permissions: ['read']
                }),
                db.createNode({
                    type: 'user',
                    properties: { name: 'User2' },
                    permissions: ['read']
                }),
                db.createNode({
                    type: 'user',
                    properties: { name: 'User3' },
                    permissions: ['read']
                })
            ]);

            // Create relationships
            await db.createRelationship({
                from: nodes[0].id,
                to: nodes[1].id,
                type: 'KNOWS',
                permissions: ['read']
            });

            // Verify all data is queryable
            const allUsers = await db.queryNodes({ type: 'user' });
            expect(allUsers.length).toBe(3);

            const relationships = await db.queryRelatedNodes(
                nodes[0].id,
                'KNOWS',
                authContext,
                { direction: 'OUT' }
            );

            expect(relationships.length).toBe(1);
        });

        it('should handle large dataset', async () => {
            const nodeCount = 50;
            const nodes = [];

            // Create many nodes
            for (let i = 0; i < nodeCount; i++) {
                const node = await db.createNode({
                    type: 'user',
                    properties: {
                        name: `User${i}`,
                        index: i,
                        group: i % 5
                    },
                    permissions: ['read']
                });
                nodes.push(node);
            }

            // Query all nodes
            const allNodes = await db.queryNodes({ type: 'user' });
            expect(allNodes.length).toBe(nodeCount);

            // Query by property
            const group0 = await db.queryNodes({
                type: 'user',
                'properties.group': 0
            });

            expect(group0.length).toBe(nodeCount / 5);

            // Create relationships
            for (let i = 0; i < nodeCount - 1; i++) {
                await db.createRelationship({
                    from: nodes[i].id,
                    to: nodes[i + 1].id,
                    type: 'NEXT',
                    permissions: ['read']
                });
            }

            // Traverse chain
            const next = await db.queryRelatedNodes(
                nodes[0].id,
                'NEXT',
                authContext,
                { direction: 'OUT' }
            );

            expect(next.length).toBe(1);
            expect(next[0].properties.index).toBe(1);
        });

        it('should handle concurrent operations', async () => {
            const operations = Array.from({ length: 20 }, (_, i) =>
                db.createNode({
                    type: 'concurrent',
                    properties: { index: i },
                    permissions: ['read']
                })
            );

            const nodes = await Promise.all(operations);

            expect(nodes.length).toBe(20);
            expect(new Set(nodes.map(n => n.id)).size).toBe(20); // All unique

            const allNodes = await db.queryNodes({ type: 'concurrent' });
            expect(allNodes.length).toBe(20);
        });
    });

    describe('Complex Graph Traversal', () => {
        let db: S3CoreDB;
        const authContext: AuthContext = {
            userPermissions: ['read', 'create'],
            isAdmin: false
        };

        beforeEach(() => {
            const adapter = new LocalStorageAdapter();
            db = new S3CoreDB(
                {
                    endpoint: 'http://localhost:4566',
                    accessKeyId: 'test',
                    secretAccessKey: 'test',
                    bucket: 'test-bucket'
                },
                adapter
            );
            db.setDefaultAuthContext(authContext);
        });

        it('should handle multi-hop traversal', async () => {
            // Create a chain: A -> B -> C -> D
            const nodeA = await db.createNode({
                type: 'node',
                properties: { name: 'A' },
                permissions: ['read']
            });

            const nodeB = await db.createNode({
                type: 'node',
                properties: { name: 'B' },
                permissions: ['read']
            });

            const nodeC = await db.createNode({
                type: 'node',
                properties: { name: 'C' },
                permissions: ['read']
            });

            const nodeD = await db.createNode({
                type: 'node',
                properties: { name: 'D' },
                permissions: ['read']
            });

            await db.createRelationship({
                from: nodeA.id,
                to: nodeB.id,
                type: 'CONNECTS',
                permissions: ['read']
            });

            await db.createRelationship({
                from: nodeB.id,
                to: nodeC.id,
                type: 'CONNECTS',
                permissions: ['read']
            });

            await db.createRelationship({
                from: nodeC.id,
                to: nodeD.id,
                type: 'CONNECTS',
                permissions: ['read']
            });

            // First hop
            const firstHop = await db.queryRelatedNodes(
                nodeA.id,
                'CONNECTS',
                authContext,
                { direction: 'OUT' }
            );

            expect(firstHop.length).toBe(1);
            expect(firstHop[0].properties.name).toBe('B');

            // Second hop
            const secondHop = await db.queryRelatedNodes(
                firstHop[0].id,
                'CONNECTS',
                authContext,
                { direction: 'OUT' }
            );

            expect(secondHop.length).toBe(1);
            expect(secondHop[0].properties.name).toBe('C');
        });

        it('should handle diamond graph structure', async () => {
            // Create diamond: A -> B, A -> C, B -> D, C -> D
            const A = await db.createNode({
                type: 'node',
                properties: { name: 'A' },
                permissions: ['read']
            });

            const B = await db.createNode({
                type: 'node',
                properties: { name: 'B' },
                permissions: ['read']
            });

            const C = await db.createNode({
                type: 'node',
                properties: { name: 'C' },
                permissions: ['read']
            });

            const D = await db.createNode({
                type: 'node',
                properties: { name: 'D' },
                permissions: ['read']
            });

            await db.createRelationship({
                from: A.id,
                to: B.id,
                type: 'PATH',
                permissions: ['read']
            });

            await db.createRelationship({
                from: A.id,
                to: C.id,
                type: 'PATH',
                permissions: ['read']
            });

            await db.createRelationship({
                from: B.id,
                to: D.id,
                type: 'PATH',
                permissions: ['read']
            });

            await db.createRelationship({
                from: C.id,
                to: D.id,
                type: 'PATH',
                permissions: ['read']
            });

            // From A, we can reach B and C
            const fromA = await db.queryRelatedNodes(
                A.id,
                'PATH',
                authContext,
                { direction: 'OUT' }
            );

            expect(fromA.length).toBe(2);

            // D is reachable from both B and C
            const toD = await db.queryRelatedNodes(
                D.id,
                'PATH',
                authContext,
                { direction: 'IN' }
            );

            expect(toD.length).toBe(2);
        });
    });
});

