import { S3StorageAdapter } from '../s3-storage-adapter';
import { Node, AuthContext, Relationship, S3CoreDBConfig } from '../types';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

const s3Mock = mockClient(S3Client);

describe('S3StorageAdapter', () => {
    let adapter: S3StorageAdapter;
    const authContext: AuthContext = {
        userPermissions: ['create', 'read', 'write', 'delete'],
        isAdmin: false
    };

    const config: S3CoreDBConfig = {
        bucket: 'test-bucket',
        region: 'us-east-1',
        endpoint: 'http://localhost:4566',
        accessKeyId: 'test',
        secretAccessKey: 'test'
    };

    beforeEach(() => {
        s3Mock.reset();
        adapter = new S3StorageAdapter(config);
    });

    const createMockBody = (str: string) => {
        const stream = new Readable();
        stream.push(str);
        stream.push(null);
        return Object.assign(stream, {
            transformToString: async () => str
        });
    };

    describe('Node Operations', () => {
        it('should create a node', async () => {
            const node: Node = {
                id: 'test-node',
                type: 'user',
                properties: { name: 'Test' },
                permissions: ['read']
            };

            s3Mock.on(PutObjectCommand).resolves({});

            const result = await adapter.createNode(node, authContext);
            expect(result).toEqual(node);
            expect(s3Mock.calls().length).toBe(1);
        });

        it('should get a node', async () => {
            const node: Node = {
                id: 'test-node',
                type: 'user',
                properties: { name: 'Test' },
                permissions: ['read']
            };

            // Mock listNodeTypes -> returns 'user'
            s3Mock.on(ListObjectsV2Command, {
                Prefix: 'nodes/',
                Delimiter: '/'
            }).resolves({
                CommonPrefixes: [{ Prefix: 'nodes/user/' }]
            });

            s3Mock.on(GetObjectCommand).resolves({
                Body: createMockBody(JSON.stringify(node)) as any
            });

            const result = await adapter.getNode('test-node', authContext);
            expect(result).toEqual(node);
        });

        it('should return null if node not found', async () => {
            s3Mock.on(ListObjectsV2Command, {
                Prefix: 'nodes/',
                Delimiter: '/'
            }).resolves({
                CommonPrefixes: [{ Prefix: 'nodes/user/' }]
            });

            const noSuchKeyError: any = new Error('NoSuchKey');
            noSuchKeyError.name = 'NoSuchKey';
            s3Mock.on(GetObjectCommand).rejects(noSuchKeyError);

            const result = await adapter.getNode('non-existent', authContext);
            expect(result).toBeNull();
        });
    });

    describe('Relationship Operations', () => {
        it('should create a relationship', async () => {
            const relationship: Relationship = {
                from: 'node1',
                to: 'node2',
                type: 'FOLLOWS',
                permissions: ['read']
            };

            const node1: Node = { id: 'node1', type: 'user', properties: {}, permissions: ['read'] };
            const node2: Node = { id: 'node2', type: 'user', properties: {}, permissions: ['read'] };

            s3Mock.on(ListObjectsV2Command, {
                Prefix: 'nodes/',
                Delimiter: '/'
            }).resolves({
                CommonPrefixes: [{ Prefix: 'nodes/user/' }]
            });

            s3Mock.on(GetObjectCommand).callsFake((input) => {
                if (input.Key?.includes('node1.json')) {
                    return Promise.resolve({ Body: createMockBody(JSON.stringify(node1)) });
                }
                if (input.Key?.includes('node2.json')) {
                    return Promise.resolve({ Body: createMockBody(JSON.stringify(node2)) });
                }
                return Promise.reject({ name: 'NoSuchKey' });
            });

            s3Mock.on(PutObjectCommand).resolves({});

            await adapter.createRelationship(relationship, authContext);

            const putCalls = s3Mock.calls().filter(c => c.args[0] instanceof PutObjectCommand);
            expect(putCalls.length).toBe(1);
        });
    });
});
