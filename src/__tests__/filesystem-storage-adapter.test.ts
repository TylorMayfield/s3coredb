import { FileSystemStorageAdapter } from '../filesystem-storage-adapter';
import { Node, AuthContext, Relationship, QueryOptions } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('FileSystemStorageAdapter', () => {
    let adapter: FileSystemStorageAdapter;
    const testDir = 'test-db-data';
    const authContext: AuthContext = {
        userPermissions: ['create', 'read'],
        isAdmin: false
    };

    beforeEach(async () => {
        adapter = new FileSystemStorageAdapter(testDir, 256, 2);
        // Wait for initialization
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    afterEach(async () => {
        try {
            await adapter.cleanup();
            await fs.rm(testDir, { recursive: true, force: true });
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    describe('Node Creation', () => {
        it('should create a node', async () => {
            const nodeData = {
                id: 'test-id',
                type: 'user',
                properties: { name: 'Alice', email: 'alice@example.com' },
                permissions: ['read']
            };

            const node = await adapter.createNode(nodeData, authContext);

            expect(node).toHaveProperty('id', 'test-id');
            expect(node.properties.name).toBe('Alice');
        });

        it('should generate ID if not provided', async () => {
            const nodeData = {
                type: 'user',
                properties: { name: 'Bob' },
                permissions: ['read']
            };

            const node = await adapter.createNode(nodeData as Node, authContext);

            expect(node).toHaveProperty('id');
            expect(node.id).toBeTruthy();
        });

        it('should persist node to filesystem', async () => {
            const nodeData = {
                id: 'persist-test',
                type: 'user',
                properties: { name: 'Charlie' },
                permissions: ['read']
            };

            await adapter.createNode(nodeData, authContext);

            // Check if file exists in filesystem
            const files = await fs.readdir(path.join(testDir, 'nodes', 'user'), { recursive: true });
            const nodeFile = files.find(f => f.toString().includes('persist-test.json'));
            expect(nodeFile).toBeDefined();
        });

        it('should validate node structure', async () => {
            const invalidNode = {
                id: 'invalid',
                // Missing type
                properties: { name: 'Invalid' },
                permissions: ['read']
            };

            await expect(adapter.createNode(invalidNode as Node, authContext))
                .rejects.toThrow('Type must be a non-empty string');
        });

        it('should validate node permissions', async () => {
            const invalidNode = {
                id: 'invalid',
                type: 'user',
                properties: { name: 'Invalid' },
                // Missing permissions
            };

            await expect(adapter.createNode(invalidNode as Node, authContext))
                .rejects.toThrow('Permissions must be an array');
        });

        it('should validate node properties', async () => {
            const invalidNode = {
                id: 'invalid',
                type: 'user',
                // Missing properties
                permissions: ['read']
            };

            await expect(adapter.createNode(invalidNode as Node, authContext))
                .rejects.toThrow('Properties must be a non-null object');
        });
    });

    describe('Node Retrieval', () => {
        it('should retrieve a created node', async () => {
            const nodeData = {
                id: 'retrieve-test',
                type: 'user',
                properties: { name: 'Dave' },
                permissions: ['read']
            };

            await adapter.createNode(nodeData, authContext);
            const retrieved = await adapter.getNode('retrieve-test', authContext);

            expect(retrieved).not.toBeNull();
            expect(retrieved?.properties.name).toBe('Dave');
        });

        it('should return null for non-existent node', async () => {
            const node = await adapter.getNode('non-existent', authContext);
            expect(node).toBeNull();
        });

        it('should use cache for retrieval', async () => {
            const nodeData = {
                id: 'cache-test',
                type: 'user',
                properties: { name: 'Eve' },
                permissions: ['read']
            };

            await adapter.createNode(nodeData, authContext);

            // First retrieval
            const first = await adapter.getNode('cache-test', authContext);
            // Second retrieval should use cache
            const second = await adapter.getNode('cache-test', authContext);

            expect(first).toEqual(second);
        });

        it('should respect permissions when retrieving', async () => {
            const restrictedNode = {
                id: 'restricted',
                type: 'secret',
                properties: { data: 'classified' },
                permissions: ['admin']
            };

            const adminAuth: AuthContext = {
                userPermissions: ['admin'],
                isAdmin: false
            };

            await adapter.createNode(restrictedNode, adminAuth);

            // User without admin permission should not see the node
            const limitedAuth: AuthContext = {
                userPermissions: ['read'],
                isAdmin: false
            };

            const retrieved = await adapter.getNode('restricted', limitedAuth);
            expect(retrieved).toBeNull();
        });

        it('should allow admin to retrieve any node', async () => {
            const restrictedNode = {
                id: 'admin-test',
                type: 'secret',
                properties: { data: 'classified' },
                permissions: ['restricted']
            };

            const adminAuth: AuthContext = {
                userPermissions: ['restricted'],
                isAdmin: false
            };

            await adapter.createNode(restrictedNode, adminAuth);

            const fullAdminAuth: AuthContext = {
                userPermissions: [],
                isAdmin: true
            };

            const retrieved = await adapter.getNode('admin-test', fullAdminAuth);
            expect(retrieved).not.toBeNull();
        });
    });

    describe('Node Type Retrieval', () => {
        it('should get node type from ID', async () => {
            const nodeData = {
                id: 'type-test',
                type: 'user',
                properties: { name: 'Frank' },
                permissions: ['read']
            };

            await adapter.createNode(nodeData, authContext);
            const type = await adapter.getNodeTypeFromId('type-test');

            expect(type).toBe('user');
        });

        it('should return null for non-existent node type', async () => {
            const type = await adapter.getNodeTypeFromId('non-existent');
            expect(type).toBeNull();
        });
    });

    describe('Node Querying', () => {
        beforeEach(async () => {
            // Create test nodes
            await adapter.createNode({
                id: 'user-1',
                type: 'user',
                properties: { name: 'Alice', age: 30, city: 'NYC' },
                permissions: ['read']
            }, authContext);

            await adapter.createNode({
                id: 'user-2',
                type: 'user',
                properties: { name: 'Bob', age: 25, city: 'LA' },
                permissions: ['read']
            }, authContext);

            await adapter.createNode({
                id: 'post-1',
                type: 'post',
                properties: { title: 'Hello World' },
                permissions: ['read']
            }, authContext);
        });

        it('should query nodes by type', async () => {
            const users = await adapter.queryNodes({ type: 'user' }, authContext);

            expect(users.length).toBe(2);
            expect(users.every(u => u.type === 'user')).toBe(true);
        });

        it('should query nodes by property', async () => {
            const alice = await adapter.queryNodes({
                type: 'user',
                'properties.name': 'Alice'
            }, authContext);

            expect(alice.length).toBe(1);
            expect(alice[0].properties.name).toBe('Alice');
        });

        it('should query nodes by multiple properties', async () => {
            const result = await adapter.queryNodes({
                type: 'user',
                'properties.age': 30,
                'properties.city': 'NYC'
            }, authContext);

            expect(result.length).toBe(1);
            expect(result[0].properties.name).toBe('Alice');
        });

        it('should return empty array when no matches', async () => {
            const result = await adapter.queryNodes({
                type: 'user',
                'properties.name': 'NonExistent'
            }, authContext);

            expect(result).toEqual([]);
        });

        it('should respect permissions in queries', async () => {
            await adapter.createNode({
                id: 'secret-1',
                type: 'secret',
                properties: { data: 'classified' },
                permissions: ['admin']
            }, { userPermissions: ['admin'], isAdmin: false });

            const limitedAuth: AuthContext = {
                userPermissions: ['read'],
                isAdmin: false
            };

            const results = await adapter.queryNodes({ type: 'secret' }, limitedAuth);
            expect(results.length).toBe(0);
        });
    });

    describe('Advanced Querying', () => {
        beforeEach(async () => {
            await adapter.createNode({
                id: 'user-1',
                type: 'user',
                properties: { name: 'Alice', age: 30 },
                permissions: ['read']
            }, authContext);

            await adapter.createNode({
                id: 'user-2',
                type: 'user',
                properties: { name: 'Bob', age: 25 },
                permissions: ['read']
            }, authContext);

            await adapter.createNode({
                id: 'user-3',
                type: 'user',
                properties: { name: 'Charlie', age: 35 },
                permissions: ['read']
            }, authContext);
        });

        it('should support sorting', async () => {
            const options: QueryOptions = {
                sort: [{ field: 'properties.age', direction: 'asc' }]
            };

            const result = await adapter.queryNodesAdvanced(options, authContext);

            expect(result.items.length).toBe(3);
            expect(result.items[0].properties.age).toBe(25);
            expect(result.items[1].properties.age).toBe(30);
            expect(result.items[2].properties.age).toBe(35);
        });

        it('should support descending sort', async () => {
            const options: QueryOptions = {
                sort: [{ field: 'properties.age', direction: 'desc' }]
            };

            const result = await adapter.queryNodesAdvanced(options, authContext);

            expect(result.items[0].properties.age).toBe(35);
            expect(result.items[1].properties.age).toBe(30);
            expect(result.items[2].properties.age).toBe(25);
        });

        it('should support pagination', async () => {
            const options: QueryOptions = {
                pagination: {
                    offset: 0,
                    limit: 2
                }
            };

            const result = await adapter.queryNodesAdvanced(options, authContext);

            expect(result.items.length).toBe(2);
            expect(result.total).toBe(3);
            expect(result.hasMore).toBe(true);
        });

        it('should handle pagination with offset', async () => {
            const options: QueryOptions = {
                pagination: {
                    offset: 2,
                    limit: 2
                }
            };

            const result = await adapter.queryNodesAdvanced(options, authContext);

            expect(result.items.length).toBe(1);
            expect(result.total).toBe(3);
            expect(result.hasMore).toBe(false);
        });

        it('should support filtering with eq operator', async () => {
            const options: QueryOptions = {
                filter: {
                    field: 'properties.age',
                    operator: 'eq',
                    value: 30
                }
            };

            const result = await adapter.queryNodesAdvanced(options, authContext);

            expect(result.items.length).toBeGreaterThan(0);
            expect(result.items.every(item => item.properties.age === 30)).toBe(true);
        });
    });

    describe('Relationship Creation', () => {
        beforeEach(async () => {
            await adapter.createNode({
                id: 'user-1',
                type: 'user',
                properties: { name: 'Alice' },
                permissions: ['read']
            }, authContext);

            await adapter.createNode({
                id: 'user-2',
                type: 'user',
                properties: { name: 'Bob' },
                permissions: ['read']
            }, authContext);
        });

        it('should create a relationship', async () => {
            const relationship: Relationship = {
                from: 'user-1',
                to: 'user-2',
                type: 'FOLLOWS',
                permissions: ['read']
            };

            await expect(adapter.createRelationship(relationship, authContext))
                .resolves.not.toThrow();
        });

        it('should validate relationship structure', async () => {
            const invalidRel = {
                // Missing from
                to: 'user-2',
                type: 'FOLLOWS',
                permissions: ['read']
            };

            await expect(adapter.createRelationship(invalidRel as Relationship, authContext))
                .rejects.toThrow(); // Validation will fail for missing 'from'
        });

        it('should reject relationships to non-existent nodes', async () => {
            const relationship: Relationship = {
                from: 'user-1',
                to: 'non-existent',
                type: 'FOLLOWS',
                permissions: ['read']
            };

            await expect(adapter.createRelationship(relationship, authContext))
                .rejects.toThrow();
        });

        it('should respect permissions when creating relationships', async () => {
            await adapter.createNode({
                id: 'restricted-user',
                type: 'user',
                properties: { name: 'Restricted' },
                permissions: ['admin']
            }, { userPermissions: ['admin'], isAdmin: false });

            const relationship: Relationship = {
                from: 'user-1',
                to: 'restricted-user',
                type: 'FOLLOWS',
                permissions: ['read']
            };

            const limitedAuth: AuthContext = {
                userPermissions: ['read'],
                isAdmin: false
            };

            await expect(adapter.createRelationship(relationship, limitedAuth))
                .rejects.toThrow();
        });

        it('should persist relationship to filesystem', async () => {
            const relationship: Relationship = {
                from: 'user-1',
                to: 'user-2',
                type: 'FOLLOWS',
                permissions: ['read']
            };

            await adapter.createRelationship(relationship, authContext);

            // Check if file exists
            const files = await fs.readdir(path.join(testDir, 'relationships', 'FOLLOWS'), { recursive: true });
            const relFile = files.find(f => f.toString().includes('user-1__user-2.json'));
            expect(relFile).toBeDefined();
        });
    });

    describe('Related Nodes Querying', () => {
        beforeEach(async () => {
            // Create nodes
            await adapter.createNode({
                id: 'user-1',
                type: 'user',
                properties: { name: 'Alice' },
                permissions: ['read']
            }, authContext);

            await adapter.createNode({
                id: 'user-2',
                type: 'user',
                properties: { name: 'Bob' },
                permissions: ['read']
            }, authContext);

            await adapter.createNode({
                id: 'user-3',
                type: 'user',
                properties: { name: 'Charlie' },
                permissions: ['read']
            }, authContext);

            // Create relationships
            await adapter.createRelationship({
                from: 'user-1',
                to: 'user-2',
                type: 'FOLLOWS',
                permissions: ['read']
            }, authContext);

            await adapter.createRelationship({
                from: 'user-1',
                to: 'user-3',
                type: 'FOLLOWS',
                permissions: ['read']
            }, authContext);

            await adapter.createRelationship({
                from: 'user-2',
                to: 'user-1',
                type: 'FOLLOWS',
                permissions: ['read']
            }, authContext);
        });

        it('should query outgoing relationships', async () => {
            const following = await adapter.queryRelatedNodes(
                'user-1',
                'FOLLOWS',
                authContext,
                { direction: 'OUT', skipCache: true }
            );

            expect(following.length).toBe(2);
            expect(following.some(n => n.id === 'user-2')).toBe(true);
            expect(following.some(n => n.id === 'user-3')).toBe(true);
        });

        it('should query incoming relationships', async () => {
            const followers = await adapter.queryRelatedNodes(
                'user-1',
                'FOLLOWS',
                authContext,
                { direction: 'IN', skipCache: true }
            );

            expect(followers.length).toBe(1);
            expect(followers[0].id).toBe('user-2');
        });

        it('should use cache for related nodes', async () => {
            // First query
            const first = await adapter.queryRelatedNodes(
                'user-1',
                'FOLLOWS',
                authContext,
                { direction: 'OUT' }
            );

            // Second query should use cache
            const second = await adapter.queryRelatedNodes(
                'user-1',
                'FOLLOWS',
                authContext,
                { direction: 'OUT' }
            );

            expect(first).toEqual(second);
        });

        it('should skip cache when requested', async () => {
            const result = await adapter.queryRelatedNodes(
                'user-1',
                'FOLLOWS',
                authContext,
                { direction: 'OUT', skipCache: true }
            );

            expect(result.length).toBe(2);
        });

        it('should respect permissions in related nodes query', async () => {
            await adapter.createNode({
                id: 'secret-user',
                type: 'user',
                properties: { name: 'Secret' },
                permissions: ['admin']
            }, { userPermissions: ['admin'], isAdmin: false });

            await adapter.createRelationship({
                from: 'user-1',
                to: 'secret-user',
                type: 'FOLLOWS',
                permissions: ['read']
            }, { userPermissions: ['admin', 'read'], isAdmin: false });

            const limitedAuth: AuthContext = {
                userPermissions: ['read'],
                isAdmin: false
            };

            const following = await adapter.queryRelatedNodes(
                'user-1',
                'FOLLOWS',
                limitedAuth,
                { direction: 'OUT', skipCache: true }
            );

            // Should not include secret-user
            expect(following.every(n => n.id !== 'secret-user')).toBe(true);
        });
    });

    describe('Batch Operations', () => {
        it('should support batch mode', async () => {
            adapter.startBatch();

            await adapter.createNode({
                id: 'batch-1',
                type: 'user',
                properties: { name: 'Batch1' },
                permissions: ['read']
            }, authContext);

            await adapter.commitBatch();

            const node = await adapter.getNode('batch-1', authContext);
            expect(node).not.toBeNull();
        });
    });

    describe('Cleanup', () => {
        it('should clean up all data', async () => {
            await adapter.createNode({
                id: 'cleanup-test',
                type: 'user',
                properties: { name: 'Cleanup' },
                permissions: ['read']
            }, authContext);

            await adapter.cleanup();

            const node = await adapter.getNode('cleanup-test', authContext);
            expect(node).toBeNull();
        });
    });
});

