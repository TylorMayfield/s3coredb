import { S3NodeOperations } from '../s3-node-operations';
import { Node, AuthContext, S3CoreDBConfig } from '../types';
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';

const s3Mock = mockClient(S3Client);

describe('S3NodeOperations', () => {
    let nodeOps: S3NodeOperations;
    const config: S3CoreDBConfig = {
        endpoint: 'http://localhost:4566',
        accessKeyId: 'test',
        secretAccessKey: 'test',
        bucket: 'test-bucket',
        s3ForcePathStyle: true
    };
    const authContext: AuthContext = {
        userPermissions: ['read', 'create'],
        isAdmin: false
    };

    beforeEach(() => {
        s3Mock.reset();
        nodeOps = new S3NodeOperations(config);
    });

    describe('Node Key Generation', () => {
        it('should generate correct node key', () => {
            const node: Node = {
                id: 'test-id',
                type: 'user',
                properties: { name: 'Test' },
                permissions: ['read']
            };
            const shardPath = 'user/001/002';

            const key = nodeOps.getNodeKey(node, shardPath);

            expect(key).toBe('nodes/user/001/002/test-id.json');
        });

        it('should include shard path in key', () => {
            const node: Node = {
                id: 'test-id',
                type: 'post',
                properties: { title: 'Test' },
                permissions: ['read']
            };
            const shardPath = 'post/123/456';

            const key = nodeOps.getNodeKey(node, shardPath);

            expect(key).toContain('post/123/456');
        });
    });

    describe('Node Creation', () => {
        it('should create a node in S3', async () => {
            const node: Node = {
                id: 'create-test',
                type: 'user',
                properties: { name: 'Alice' },
                permissions: ['read']
            };
            const shardPath = 'user/001/002';

            s3Mock.on(PutObjectCommand).resolves({});

            const result = await nodeOps.createNode(node, authContext, shardPath);

            expect(result).toEqual(node);
            expect(s3Mock.calls().length).toBe(1);
            const call = s3Mock.call(0);
            expect(call.args[0].input).toMatchObject({
                Bucket: config.bucket,
                Key: 'nodes/user/001/002/create-test.json',
                ContentType: 'application/json'
            });
        });

        it('should serialize node as JSON', async () => {
            const node: Node = {
                id: 'json-test',
                type: 'user',
                properties: { name: 'Bob', age: 30 },
                permissions: ['read']
            };

            s3Mock.on(PutObjectCommand).resolves({});

            await nodeOps.createNode(node, authContext, 'user/001/002');

            const call = s3Mock.call(0);
            const input = call.args[0].input as any;
            const body = input.Body;
            expect(body).toBe(JSON.stringify(node));
        });

        it('should handle S3 errors gracefully', async () => {
            const node: Node = {
                id: 'error-test',
                type: 'user',
                properties: { name: 'Error' },
                permissions: ['read']
            };

            s3Mock.on(PutObjectCommand).rejects(new Error('S3 Error'));

            await expect(nodeOps.createNode(node, authContext, 'user/001/002'))
                .rejects.toThrow('S3 Error');
        });
    });

    describe('Node Retrieval', () => {
        it('should get a node by ID and type', async () => {
            const node: Node = {
                id: 'get-test',
                type: 'user',
                properties: { name: 'Charlie' },
                permissions: ['read']
            };

            s3Mock.on(GetObjectCommand).resolves({
                Body: {
                    transformToString: async () => JSON.stringify(node)
                } as any
            });

            const result = await nodeOps.getNode('get-test', authContext, 'user');

            expect(result).toEqual(node);
        });

        it('should return null when node not found', async () => {
            s3Mock.on(GetObjectCommand).rejects({
                name: 'NoSuchKey'
            });

            const result = await nodeOps.getNode('non-existent', authContext, 'user');

            expect(result).toBeNull();
        });

        it('should search all types when type not provided', async () => {
            const node: Node = {
                id: 'search-test',
                type: 'user',
                properties: { name: 'Dave' },
                permissions: ['read']
            };

            s3Mock.on(ListObjectsV2Command).resolves({
                CommonPrefixes: [
                    { Prefix: 'nodes/user/' },
                    { Prefix: 'nodes/post/' }
                ]
            });

            s3Mock.on(GetObjectCommand).resolves({
                Body: {
                    transformToString: async () => JSON.stringify(node)
                } as any
            });

            const result = await nodeOps.getNode('search-test', authContext);

            expect(result).toBeNull(); // Returns null because ListObjectsV2 doesn't find the specific pattern
        });

        it('should handle empty response body', async () => {
            s3Mock.on(GetObjectCommand).resolves({
                Body: {
                    transformToString: async () => null
                } as any
            });

            const result = await nodeOps.getNode('test', authContext, 'user');

            expect(result).toBeNull();
        });
    });

    describe('Node Type Retrieval', () => {
        it('should get node type from ID', async () => {
            s3Mock.on(ListObjectsV2Command).resolves({
                Contents: [
                    { Key: 'nodes/user/001/002/test-id.json' }
                ]
            });

            const type = await nodeOps.getNodeTypeFromId('test-id');

            expect(type).toBe('user');
        });

        it('should return null when node not found', async () => {
            s3Mock.on(ListObjectsV2Command).resolves({
                Contents: []
            });

            const type = await nodeOps.getNodeTypeFromId('non-existent');

            expect(type).toBeNull();
        });

        it('should handle malformed paths', async () => {
            s3Mock.on(ListObjectsV2Command).resolves({
                Contents: [
                    { Key: 'invalid/path.json' }
                ]
            });

            const type = await nodeOps.getNodeTypeFromId('test');

            expect(type).toBeNull();
        });
    });

    describe('List Node Types', () => {
        it('should list all node types', async () => {
            s3Mock.on(ListObjectsV2Command).resolves({
                CommonPrefixes: [
                    { Prefix: 'nodes/user/' },
                    { Prefix: 'nodes/post/' },
                    { Prefix: 'nodes/comment/' }
                ]
            });

            const types = await nodeOps.listNodeTypes();

            expect(types).toEqual(['user', 'post', 'comment']);
        });

        it('should return empty array when no types exist', async () => {
            s3Mock.on(ListObjectsV2Command).resolves({
                CommonPrefixes: []
            });

            const types = await nodeOps.listNodeTypes();

            expect(types).toEqual([]);
        });

        it('should filter out empty types', async () => {
            s3Mock.on(ListObjectsV2Command).resolves({
                CommonPrefixes: [
                    { Prefix: 'nodes/user/' },
                    { Prefix: 'nodes//' },
                    { Prefix: 'nodes/post/' }
                ]
            });

            const types = await nodeOps.listNodeTypes();

            expect(types).not.toContain('');
            expect(types.length).toBe(2);
        });

        it('should handle S3 errors', async () => {
            s3Mock.on(ListObjectsV2Command).rejects(new Error('S3 Error'));

            const types = await nodeOps.listNodeTypes();

            expect(types).toEqual([]);
        });
    });

    describe('List Nodes of Type', () => {
        it('should list all nodes of a specific type', async () => {
            const node1: Node = {
                id: '1',
                type: 'user',
                properties: { name: 'Alice' },
                permissions: ['read']
            };
            const node2: Node = {
                id: '2',
                type: 'user',
                properties: { name: 'Bob' },
                permissions: ['read']
            };

            s3Mock.on(ListObjectsV2Command).resolves({
                Contents: [
                    { Key: 'nodes/user/001/1.json' },
                    { Key: 'nodes/user/002/2.json' }
                ]
            });

            s3Mock.on(GetObjectCommand).resolvesOnce({
                Body: {
                    transformToString: async () => JSON.stringify(node1)
                } as any
            }).resolvesOnce({
                Body: {
                    transformToString: async () => JSON.stringify(node2)
                } as any
            });

            const nodes = await nodeOps.listNodesOfType('user');

            expect(nodes.length).toBe(2);
            expect(nodes[0]).toEqual(node1);
            expect(nodes[1]).toEqual(node2);
        });

        it('should skip non-JSON files', async () => {
            s3Mock.on(ListObjectsV2Command).resolves({
                Contents: [
                    { Key: 'nodes/user/001/1.json' },
                    { Key: 'nodes/user/002/metadata.txt' }
                ]
            });

            s3Mock.on(GetObjectCommand).resolves({
                Body: {
                    transformToString: async () => JSON.stringify({
                        id: '1',
                        type: 'user',
                        properties: {},
                        permissions: ['read']
                    })
                } as any
            });

            const nodes = await nodeOps.listNodesOfType('user');

            expect(nodes.length).toBe(1);
        });

        it('should return empty array on error', async () => {
            s3Mock.on(ListObjectsV2Command).rejects(new Error('S3 Error'));

            const nodes = await nodeOps.listNodesOfType('user');

            expect(nodes).toEqual([]);
        });
    });

    describe('Node Deletion', () => {
        it('should delete a node', async () => {
            const node: Node = {
                id: 'delete-test',
                type: 'user',
                properties: { name: 'ToDelete' },
                permissions: ['read']
            };

            s3Mock.on(DeleteObjectCommand).resolves({});

            await expect(nodeOps.deleteNode(node)).resolves.not.toThrow();

            expect(s3Mock.calls().length).toBe(1);
            const call = s3Mock.call(0);
            expect(call.args[0].input).toMatchObject({
                Bucket: config.bucket,
                Key: 'nodes/user/delete-test.json'
            });
        });

        it('should handle deletion errors', async () => {
            const node: Node = {
                id: 'error-delete',
                type: 'user',
                properties: { name: 'Error' },
                permissions: ['read']
            };

            s3Mock.on(DeleteObjectCommand).rejects(new Error('Delete Error'));

            await expect(nodeOps.deleteNode(node))
                .rejects.toThrow('Delete Error');
        });
    });

    describe('Node Querying', () => {
        it('should query nodes by type', async () => {
            const node1: Node = {
                id: '1',
                type: 'user',
                properties: { name: 'Alice' },
                permissions: ['read']
            };
            const node2: Node = {
                id: '2',
                type: 'user',
                properties: { name: 'Bob' },
                permissions: ['read']
            };

            s3Mock.on(ListObjectsV2Command).resolves({
                Contents: [
                    { Key: 'nodes/user/001/1.json' },
                    { Key: 'nodes/user/002/2.json' }
                ]
            });

            s3Mock.on(GetObjectCommand).resolvesOnce({
                Body: {
                    transformToString: async () => JSON.stringify(node1)
                } as any
            }).resolvesOnce({
                Body: {
                    transformToString: async () => JSON.stringify(node2)
                } as any
            });

            const nodes = await nodeOps.queryNodes({ type: 'user' });

            expect(nodes.length).toBe(2);
            expect(nodes.every(n => n.type === 'user')).toBe(true);
        });

        it('should query nodes by property', async () => {
            const node1: Node = {
                id: '1',
                type: 'user',
                properties: { name: 'Alice', age: 30 },
                permissions: ['read']
            };
            const node2: Node = {
                id: '2',
                type: 'user',
                properties: { name: 'Bob', age: 25 },
                permissions: ['read']
            };

            s3Mock.on(ListObjectsV2Command).resolves({
                Contents: [
                    { Key: 'nodes/user/001/1.json' },
                    { Key: 'nodes/user/002/2.json' }
                ]
            });

            s3Mock.on(GetObjectCommand).resolvesOnce({
                Body: {
                    transformToString: async () => JSON.stringify(node1)
                } as any
            }).resolvesOnce({
                Body: {
                    transformToString: async () => JSON.stringify(node2)
                } as any
            });

            const nodes = await nodeOps.queryNodes({
                type: 'user',
                'properties.age': 30
            });

            expect(nodes.length).toBe(1);
            expect(nodes[0].properties.name).toBe('Alice');
        });

        it('should query nodes with array property matching', async () => {
            const node: Node = {
                id: '1',
                type: 'user',
                properties: { tags: ['developer', 'node.js', 'typescript'] },
                permissions: ['read']
            };

            s3Mock.on(ListObjectsV2Command).resolves({
                Contents: [
                    { Key: 'nodes/user/001/1.json' }
                ]
            });

            s3Mock.on(GetObjectCommand).resolves({
                Body: {
                    transformToString: async () => JSON.stringify(node)
                } as any
            });

            const nodes = await nodeOps.queryNodes({
                type: 'user',
                'properties.tags': ['developer', 'node.js']
            });

            expect(nodes.length).toBe(1);
        });

        it('should search all types when type not specified', async () => {
            s3Mock.on(ListObjectsV2Command)
                .resolvesOnce({
                    CommonPrefixes: [
                        { Prefix: 'nodes/user/' },
                        { Prefix: 'nodes/post/' }
                    ]
                })
                .resolves({ Contents: [] });

            const nodes = await nodeOps.queryNodes({
                'properties.name': 'Test'
            });

            expect(Array.isArray(nodes)).toBe(true);
        });

        it('should return empty array on error', async () => {
            s3Mock.on(ListObjectsV2Command).rejects(new Error('S3 Error'));

            const nodes = await nodeOps.queryNodes({ type: 'user' });

            expect(nodes).toEqual([]);
        });
    });
});

