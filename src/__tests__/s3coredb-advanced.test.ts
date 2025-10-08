import { S3CoreDB } from '../S3CoreDB';
import { Node, AuthContext, Relationship, QueryOptions } from '../types';
import { LocalStorageAdapter } from '../local-storage-adapter';

describe('S3CoreDB Advanced Tests', () => {
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
                bucket: 'test-bucket',
                s3ForcePathStyle: true
            },
            adapter
        );
        db.setDefaultAuthContext(authContext);
    });

    describe('Permission System', () => {
        it('should enforce permission requirements on node creation', async () => {
            const restrictedNode = {
                type: 'secret',
                properties: { data: 'classified' },
                permissions: ['admin']
            };

            const limitedAuth: AuthContext = {
                userPermissions: ['read'],
                isAdmin: false
            };

            await expect(db.createNode(restrictedNode, limitedAuth))
                .rejects.toThrow('Permission denied');
        });

        it('should allow admin users to bypass permission checks', async () => {
            const adminAuth: AuthContext = {
                userPermissions: [],
                isAdmin: true
            };

            const restrictedNode = {
                type: 'secret',
                properties: { data: 'classified' },
                permissions: ['admin']
            };

            const node = await db.createNode(restrictedNode, adminAuth);
            expect(node).toHaveProperty('id');
        });

        it('should allow node creation when user has at least one matching permission', async () => {
            const auth: AuthContext = {
                userPermissions: ['create', 'read'],
                isAdmin: false
            };

            const node = {
                type: 'user',
                properties: { name: 'Test' },
                permissions: ['create', 'admin']
            };

            const created = await db.createNode(node, auth);
            expect(created).toHaveProperty('id');
        });

        it('should filter nodes by permissions in queries', async () => {
            const adminAuth: AuthContext = {
                userPermissions: ['admin'],
                isAdmin: false
            };

            // Create admin-only node
            await db.createNode({
                type: 'secret',
                properties: { level: 'high' },
                permissions: ['admin']
            }, adminAuth);

            // Create public node
            await db.createNode({
                type: 'secret',
                properties: { level: 'low' },
                permissions: ['read']
            }, authContext);

            // Query with limited permissions
            const results = await db.queryNodes({ type: 'secret' }, authContext);
            expect(results.length).toBe(1);
            expect(results[0].properties.level).toBe('low');
        });

        it('should prevent relationship creation to inaccessible nodes', async () => {
            const adminAuth: AuthContext = {
                userPermissions: ['admin', 'create', 'read'],
                isAdmin: false
            };

            const publicNode = await db.createNode({
                type: 'user',
                properties: { name: 'Public' },
                permissions: ['read']
            }, authContext);

            const secretNode = await db.createNode({
                type: 'user',
                properties: { name: 'Secret' },
                permissions: ['admin']
            }, adminAuth);

            const relationship: Relationship = {
                from: publicNode.id,
                to: secretNode.id,
                type: 'KNOWS',
                permissions: ['read']
            };

            // Limited user cannot create relationship to secret node
            // Note: For security, this returns "not found" error instead of revealing the node exists but is inaccessible
            await expect(db.createRelationship(relationship, authContext))
                .rejects.toThrow('Node not found');
        });
    });

    describe('Node Querying Edge Cases', () => {
        it('should handle empty query results', async () => {
            const results = await db.queryNodes({ type: 'non-existent' });
            expect(results).toEqual([]);
        });

        it('should handle special characters in properties', async () => {
            const node = await db.createNode({
                type: 'user',
                properties: {
                    email: 'test@example.com',
                    name: 'O\'Brien',
                    description: 'Line 1\nLine 2'
                },
                permissions: ['read']
            });

            const results = await db.queryNodes({
                type: 'user',
                'properties.email': 'test@example.com'
            });

            expect(results.length).toBe(1);
            expect(results[0].properties.name).toBe('O\'Brien');
        });

        it('should handle null and undefined properties', async () => {
            const node = await db.createNode({
                type: 'user',
                properties: {
                    name: 'Test',
                    optional: null,
                    missing: undefined
                },
                permissions: ['read']
            });

            const retrieved = await db.getNode(node.id);
            expect(retrieved?.properties.name).toBe('Test');
        });

        it('should handle complex nested properties', async () => {
            const node = await db.createNode({
                type: 'user',
                properties: {
                    profile: {
                        personal: {
                            name: 'Alice',
                            age: 30
                        },
                        settings: {
                            theme: 'dark'
                        }
                    }
                },
                permissions: ['read']
            });

            const retrieved = await db.getNode(node.id);
            expect(retrieved?.properties.profile.personal.name).toBe('Alice');
        });

        it('should handle very large property values', async () => {
            const largeString = 'x'.repeat(10000);
            const node = await db.createNode({
                type: 'document',
                properties: {
                    content: largeString
                },
                permissions: ['read']
            });

            const retrieved = await db.getNode(node.id);
            expect(retrieved?.properties.content).toBe(largeString);
        });

        it('should handle array properties correctly', async () => {
            const node = await db.createNode({
                type: 'user',
                properties: {
                    tags: ['developer', 'node.js', 'typescript'],
                    scores: [10, 20, 30]
                },
                permissions: ['read']
            });

            const retrieved = await db.getNode(node.id);
            expect(retrieved?.properties.tags).toEqual(['developer', 'node.js', 'typescript']);
            expect(retrieved?.properties.scores).toEqual([10, 20, 30]);
        });

        it('should query by array property inclusion', async () => {
            await db.createNode({
                type: 'user',
                properties: {
                    skills: ['javascript', 'typescript', 'react']
                },
                permissions: ['read']
            });

            const results = await db.queryNodes({
                type: 'user',
                'properties.skills': ['javascript', 'typescript']
            });

            expect(results.length).toBe(1);
        });
    });

    describe('Relationship Edge Cases', () => {
        let node1: Node;
        let node2: Node;

        beforeEach(async () => {
            node1 = await db.createNode({
                type: 'user',
                properties: { name: 'Alice' },
                permissions: ['read']
            });

            node2 = await db.createNode({
                type: 'user',
                properties: { name: 'Bob' },
                permissions: ['read']
            });
        });

        it('should handle relationships with properties', async () => {
            const relationship: Relationship = {
                from: node1.id,
                to: node2.id,
                type: 'FOLLOWS',
                permissions: ['read'],
                properties: {
                    since: new Date().toISOString(),
                    strength: 0.8,
                    metadata: {
                        source: 'recommendation'
                    }
                }
            };

            await db.createRelationship(relationship);

            const following = await db.queryRelatedNodes(
                node1.id,
                'FOLLOWS',
                authContext,
                { direction: 'OUT' }
            );

            expect(following.length).toBe(1);
        });

        it('should reject relationships with non-existent nodes', async () => {
            const relationship: Relationship = {
                from: node1.id,
                to: 'non-existent-id',
                type: 'FOLLOWS',
                permissions: ['read']
            };

            await expect(db.createRelationship(relationship))
                .rejects.toThrow('Node not found');
        });

        it('should handle self-referential relationships', async () => {
            const relationship: Relationship = {
                from: node1.id,
                to: node1.id,
                type: 'LIKES',
                permissions: ['read']
            };

            await db.createRelationship(relationship);

            const outgoing = await db.queryRelatedNodes(
                node1.id,
                'LIKES',
                authContext,
                { direction: 'OUT' }
            );

            expect(outgoing.length).toBe(1);
            expect(outgoing[0].id).toBe(node1.id);
        });

        it('should handle multiple relationships between same nodes', async () => {
            await db.createRelationship({
                from: node1.id,
                to: node2.id,
                type: 'FOLLOWS',
                permissions: ['read']
            });

            await db.createRelationship({
                from: node1.id,
                to: node2.id,
                type: 'LIKES',
                permissions: ['read']
            });

            const follows = await db.queryRelatedNodes(
                node1.id,
                'FOLLOWS',
                authContext,
                { direction: 'OUT' }
            );

            const likes = await db.queryRelatedNodes(
                node1.id,
                'LIKES',
                authContext,
                { direction: 'OUT' }
            );

            expect(follows.length).toBe(1);
            expect(likes.length).toBe(1);
        });

        it('should distinguish between IN and OUT directions', async () => {
            await db.createRelationship({
                from: node1.id,
                to: node2.id,
                type: 'FOLLOWS',
                permissions: ['read']
            });

            const outgoing = await db.queryRelatedNodes(
                node1.id,
                'FOLLOWS',
                authContext,
                { direction: 'OUT' }
            );

            const incoming = await db.queryRelatedNodes(
                node1.id,
                'FOLLOWS',
                authContext,
                { direction: 'IN' }
            );

            expect(outgoing.length).toBe(1);
            expect(outgoing[0].id).toBe(node2.id);
            expect(incoming.length).toBe(0);
        });
    });

    describe('Advanced Querying', () => {
        beforeEach(async () => {
            await db.createNode({
                type: 'user',
                properties: { name: 'Alice', age: 30, city: 'NYC' },
                permissions: ['read']
            });

            await db.createNode({
                type: 'user',
                properties: { name: 'Bob', age: 25, city: 'LA' },
                permissions: ['read']
            });

            await db.createNode({
                type: 'user',
                properties: { name: 'Charlie', age: 35, city: 'NYC' },
                permissions: ['read']
            });
        });

        it('should support advanced query with filters', async () => {
            const options: QueryOptions = {
                filter: {
                    field: 'properties.city',
                    operator: 'eq',
                    value: 'NYC'
                }
            };

            const result = await db.queryNodesAdvanced(options);

            expect(result.items.length).toBeGreaterThan(0);
            expect(result.items.every(item => item.properties.city === 'NYC')).toBe(true);
        });

        it('should support sorting in advanced queries', async () => {
            const options: QueryOptions = {
                sort: [{ field: 'properties.age', direction: 'asc' }]
            };

            const result = await db.queryNodesAdvanced(options);

            expect(result.items.length).toBe(3);
            expect(result.items[0].properties.age).toBeLessThanOrEqual(result.items[1].properties.age);
            expect(result.items[1].properties.age).toBeLessThanOrEqual(result.items[2].properties.age);
        });

        it('should support pagination', async () => {
            const options: QueryOptions = {
                pagination: {
                    limit: 2,
                    offset: 0
                }
            };

            const result = await db.queryNodesAdvanced(options);

            expect(result.items.length).toBe(2);
            expect(result.total).toBe(3);
            expect(result.hasMore).toBe(true);
        });

        it('should combine filters, sorting, and pagination', async () => {
            const options: QueryOptions = {
                filter: {
                    field: 'properties.city',
                    operator: 'eq',
                    value: 'NYC'
                },
                sort: [{ field: 'properties.age', direction: 'desc' }],
                pagination: {
                    limit: 1,
                    offset: 0
                }
            };

            const result = await db.queryNodesAdvanced(options);

            expect(result.items.length).toBe(1);
            expect(result.items[0].properties.city).toBe('NYC');
        });
    });

    describe('Error Handling', () => {
        it('should handle missing storage adapter gracefully', () => {
            expect(() => {
                new S3CoreDB({
                    endpoint: 'http://localhost:4566',
                    accessKeyId: 'test',
                    secretAccessKey: 'test',
                    bucket: 'test-bucket'
                });
            }).toThrow('Storage adapter is required');
        });

        it('should handle invalid node data', async () => {
            const invalidNode = {
                type: 'user',
                // Missing properties
                permissions: ['read']
            };

            await expect(db.createNode(invalidNode as any))
                .rejects.toThrow();
        });

        it('should return null for non-existent node', async () => {
            const node = await db.getNode('non-existent-id');
            expect(node).toBeNull();
        });

        it('should handle concurrent node creation', async () => {
            const promises = Array.from({ length: 10 }, (_, i) =>
                db.createNode({
                    type: 'user',
                    properties: { name: `User${i}` },
                    permissions: ['read']
                })
            );

            const nodes = await Promise.all(promises);

            expect(nodes.length).toBe(10);
            expect(new Set(nodes.map(n => n.id)).size).toBe(10); // All unique IDs
        });

        it('should handle concurrent relationship creation', async () => {
            const node1 = await db.createNode({
                type: 'user',
                properties: { name: 'Alice' },
                permissions: ['read']
            });

            const nodes = await Promise.all(
                Array.from({ length: 5 }, (_, i) =>
                    db.createNode({
                        type: 'user',
                        properties: { name: `User${i}` },
                        permissions: ['read']
                    })
                )
            );

            const relationships = await Promise.all(
                nodes.map(node =>
                    db.createRelationship({
                        from: node1.id,
                        to: node.id,
                        type: 'FOLLOWS',
                        permissions: ['read']
                    })
                )
            );

            expect(relationships.length).toBe(5);
        });
    });

    describe('Auth Context Management', () => {
        it('should use default auth context when not provided', async () => {
            db.setDefaultAuthContext({
                userPermissions: ['read'],
                isAdmin: false
            });

            const node = await db.createNode({
                type: 'user',
                properties: { name: 'Test' },
                permissions: ['read']
            });

            expect(node).toHaveProperty('id');
        });

        it('should override default auth context when provided', async () => {
            db.setDefaultAuthContext({
                userPermissions: ['read'],
                isAdmin: false
            });

            const customAuth: AuthContext = {
                userPermissions: ['admin'],
                isAdmin: false
            };

            const node = await db.createNode({
                type: 'secret',
                properties: { data: 'classified' },
                permissions: ['admin']
            }, customAuth);

            expect(node).toHaveProperty('id');
        });
    });

    describe('Node Type Retrieval', () => {
        it('should get node type from ID', async () => {
            const node = await db.createNode({
                type: 'user',
                properties: { name: 'Test' },
                permissions: ['read']
            });

            const type = await db.getNodeTypeFromId(node.id);
            expect(type).toBe('user');
        });

        it('should return null for non-existent node type', async () => {
            const type = await db.getNodeTypeFromId('non-existent');
            expect(type).toBeNull();
        });
    });

    describe('Complex Scenarios', () => {
        it('should handle a social network scenario', async () => {
            // Create users
            const alice = await db.createNode({
                type: 'user',
                properties: { name: 'Alice', interests: ['coding', 'music'] },
                permissions: ['read']
            });

            const bob = await db.createNode({
                type: 'user',
                properties: { name: 'Bob', interests: ['coding', 'sports'] },
                permissions: ['read']
            });

            const charlie = await db.createNode({
                type: 'user',
                properties: { name: 'Charlie', interests: ['music', 'art'] },
                permissions: ['read']
            });

            // Create relationships
            await db.createRelationship({
                from: alice.id,
                to: bob.id,
                type: 'FOLLOWS',
                permissions: ['read']
            });

            await db.createRelationship({
                from: alice.id,
                to: charlie.id,
                type: 'FOLLOWS',
                permissions: ['read']
            });

            await db.createRelationship({
                from: bob.id,
                to: alice.id,
                type: 'FOLLOWS',
                permissions: ['read']
            });

            // Query: Who does Alice follow?
            const aliceFollows = await db.queryRelatedNodes(
                alice.id,
                'FOLLOWS',
                authContext,
                { direction: 'OUT' }
            );

            expect(aliceFollows.length).toBe(2);

            // Query: Who follows Alice?
            const aliceFollowers = await db.queryRelatedNodes(
                alice.id,
                'FOLLOWS',
                authContext,
                { direction: 'IN' }
            );

            expect(aliceFollowers.length).toBe(1);
            expect(aliceFollowers[0].properties.name).toBe('Bob');

            // Query users interested in coding
            const coders = await db.queryNodes({
                type: 'user',
                'properties.interests': ['coding']
            });

            expect(coders.length).toBeGreaterThanOrEqual(1);
        });
    });
});

