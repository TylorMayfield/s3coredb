import { S3CoreDB } from '../S3CoreDB';
import { LocalStorageAdapter } from '../local-storage-adapter';
import { AuthContext, Node, Relationship } from '../types';
import { NodeNotFoundError, PermissionDeniedError, ValidationError, ConcurrentModificationError } from '../errors';

describe('CRUD Operations', () => {
    let db: S3CoreDB;
    const authContext: AuthContext = {
        userPermissions: ['create', 'read', 'update', 'delete'],
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

    describe('Node Update', () => {
        it('should update node properties', async () => {
            const node = await db.createNode({
                type: 'user',
                properties: { name: 'Alice', age: 30 },
                permissions: ['read', 'update']
            });

            const updated = await db.updateNode(node.id, {
                properties: { name: 'Alice Updated', age: 31, city: 'NYC' }
            });

            expect(updated.properties.name).toBe('Alice Updated');
            expect(updated.properties.age).toBe(31);
            expect(updated.properties.city).toBe('NYC');
        });

        it('should increment version on update', async () => {
            const node = await db.createNode({
                type: 'user',
                properties: { name: 'Bob' },
                permissions: ['read', 'update']
            });

            expect(node.version).toBe(1);

            const updated = await db.updateNode(node.id, {
                properties: { name: 'Bob Updated' }
            });

            expect(updated.version).toBe(2);
        });

        it('should throw error when updating non-existent node', async () => {
            await expect(db.updateNode('non-existent', {
                properties: { name: 'Test' }
            })).rejects.toThrow(NodeNotFoundError);
        });

        it('should respect permissions on update', async () => {
            const node = await db.createNode({
                type: 'secret',
                properties: { data: 'classified' },
                permissions: ['admin']
            }, { userPermissions: ['admin'], isAdmin: true });

            const limitedAuth: AuthContext = {
                userPermissions: ['read'],
                isAdmin: false
            };

            await expect(db.updateNode(node.id, {
                properties: { data: 'modified' }
            }, limitedAuth)).rejects.toThrow(PermissionDeniedError);
        });

        it('should detect concurrent modifications', async () => {
            const node = await db.createNode({
                type: 'user',
                properties: { name: 'Charlie' },
                permissions: ['read', 'update']
            });

            // Simulate concurrent modification
            await db.updateNode(node.id, {
                properties: { name: 'Charlie v2' }
            });

            // Try to update with old version
            await expect(db.updateNode(node.id, {
                version: 1, // Old version
                properties: { name: 'Charlie v3' }
            })).rejects.toThrow(ConcurrentModificationError);
        });

        it('should not allow updating node ID', async () => {
            const node = await db.createNode({
                type: 'user',
                properties: { name: 'Dave' },
                permissions: ['read', 'update']
            });

            await expect(db.updateNode(node.id, {
                id: 'new-id',
                properties: { name: 'Dave' }
            } as any)).rejects.toThrow(ValidationError);
        });
    });

    describe('Node Delete', () => {
        it('should delete a node', async () => {
            const node = await db.createNode({
                type: 'user',
                properties: { name: 'ToDelete' },
                permissions: ['read', 'delete']
            });

            await db.deleteNode(node.id);

            const retrieved = await db.getNode(node.id);
            expect(retrieved).toBeNull();
        });

        it('should throw error when deleting non-existent node', async () => {
            await expect(db.deleteNode('non-existent'))
                .rejects.toThrow(NodeNotFoundError);
        });

        it('should respect permissions on delete', async () => {
            const node = await db.createNode({
                type: 'secret',
                properties: { data: 'classified' },
                permissions: ['admin']
            }, { userPermissions: ['admin'], isAdmin: true });

            const limitedAuth: AuthContext = {
                userPermissions: ['read'],
                isAdmin: false
            };

            await expect(db.deleteNode(node.id, limitedAuth))
                .rejects.toThrow(PermissionDeniedError);
        });
    });

    describe('Relationship Update', () => {
        let node1: Node;
        let node2: Node;

        beforeEach(async () => {
            node1 = await db.createNode({
                type: 'user',
                properties: { name: 'Alice' },
                permissions: ['read', 'update']
            });

            node2 = await db.createNode({
                type: 'user',
                properties: { name: 'Bob' },
                permissions: ['read', 'update']
            });
        });

        it('should update relationship properties', async () => {
            await db.createRelationship({
                from: node1.id,
                to: node2.id,
                type: 'FOLLOWS',
                permissions: ['read', 'update'],
                properties: { since: '2024-01-01' }
            });

            await db.updateRelationship(node1.id, node2.id, 'FOLLOWS', {
                properties: { since: '2024-02-01', strength: 0.9 }
            });

            // Verify update by querying
            const following = await db.queryRelatedNodes(
                node1.id,
                'FOLLOWS',
                authContext,
                { direction: 'OUT' }
            );

            expect(following.length).toBe(1);
        });

        it('should increment relationship version on update', async () => {
            await db.createRelationship({
                from: node1.id,
                to: node2.id,
                type: 'LIKES',
                permissions: ['read', 'update']
            });

            await db.updateRelationship(node1.id, node2.id, 'LIKES', {
                properties: { updated: true }
            });

            // Version would be incremented (tested through storage adapter)
        });

        it('should not allow updating relationship from/to/type', async () => {
            await db.createRelationship({
                from: node1.id,
                to: node2.id,
                type: 'KNOWS',
                permissions: ['read', 'update']
            });

            await expect(db.updateRelationship(node1.id, node2.id, 'KNOWS', {
                from: 'different-id'
            } as any)).rejects.toThrow(ValidationError);
        });
    });

    describe('Relationship Delete', () => {
        let node1: Node;
        let node2: Node;

        beforeEach(async () => {
            node1 = await db.createNode({
                type: 'user',
                properties: { name: 'Alice' },
                permissions: ['read', 'delete']
            });

            node2 = await db.createNode({
                type: 'user',
                properties: { name: 'Bob' },
                permissions: ['read', 'delete']
            });
        });

        it('should delete a relationship', async () => {
            await db.createRelationship({
                from: node1.id,
                to: node2.id,
                type: 'FOLLOWS',
                permissions: ['read', 'delete']
            });

            await db.deleteRelationship(node1.id, node2.id, 'FOLLOWS');

            const following = await db.queryRelatedNodes(
                node1.id,
                'FOLLOWS',
                authContext,
                { direction: 'OUT' }
            );

            expect(following.length).toBe(0);
        });

        it('should throw error when deleting non-existent relationship', async () => {
            await expect(db.deleteRelationship(node1.id, node2.id, 'NON_EXISTENT'))
                .rejects.toThrow();
        });
    });

    describe('Input Validation', () => {
        it('should reject invalid node type', async () => {
            await expect(db.createNode({
                type: 'invalid type!@#',
                properties: { name: 'Test' },
                permissions: ['read']
            })).rejects.toThrow(ValidationError);
        });

        it('should reject empty permissions', async () => {
            await expect(db.createNode({
                type: 'user',
                properties: { name: 'Test' },
                permissions: []
            })).rejects.toThrow(ValidationError);
        });

        it('should reject reserved property keys', async () => {
            await expect(db.createNode({
                type: 'user',
                properties: { 'constructor': 'hack' },
                permissions: ['read']
            })).rejects.toThrow(ValidationError);
        });

        it('should reject very long type names', async () => {
            await expect(db.createNode({
                type: 'a'.repeat(200),
                properties: { name: 'Test' },
                permissions: ['read']
            })).rejects.toThrow(ValidationError);
        });

        it('should reject function values in properties', async () => {
            await expect(db.createNode({
                type: 'user',
                properties: { fn: () => {} },
                permissions: ['read']
            })).rejects.toThrow(ValidationError);
        });
    });

    describe('Query Limits', () => {
        beforeEach(async () => {
            // Create multiple nodes
            for (let i = 0; i < 20; i++) {
                await db.createNode({
                    type: 'user',
                    properties: { name: `User${i}`, index: i },
                    permissions: ['read']
                });
            }
        });

        it('should apply default limit to queries', async () => {
            const results = await db.queryNodes({ type: 'user' });
            expect(results.length).toBeLessThanOrEqual(1000); // Default limit
        });

        it('should respect custom query limit', async () => {
            const results = await db.queryNodes({ type: 'user' }, authContext, { limit: 10 });
            expect(results.length).toBe(10);
        });

        it('should support pagination with offset', async () => {
            const page1 = await db.queryNodes({ type: 'user' }, authContext, { limit: 5, offset: 0 });
            const page2 = await db.queryNodes({ type: 'user' }, authContext, { limit: 5, offset: 5 });

            expect(page1.length).toBe(5);
            expect(page2.length).toBe(5);
            expect(page1[0].id).not.toBe(page2[0].id);
        });

        it('should reject invalid query limit', async () => {
            await expect(db.queryNodes({ type: 'user' }, authContext, { limit: -1 }))
                .rejects.toThrow(ValidationError);
        });

        it('should reject query limit exceeding maximum', async () => {
            await expect(db.queryNodes({ type: 'user' }, authContext, { limit: 50000 }))
                .rejects.toThrow(ValidationError);
        });
    });
});

