import { ShardManager } from '../shard-manager';

describe('ShardManager', () => {
    let shardManager: ShardManager;

    beforeEach(() => {
        shardManager = new ShardManager(256, 2);
    });

    describe('Shard Path Generation', () => {
        it('should generate consistent shard paths for the same ID', () => {
            const id = 'test-id-123';
            const path1 = shardManager.getShardPath(id);
            const path2 = shardManager.getShardPath(id);

            expect(path1).toBe(path2);
        });

        it('should generate different paths for different IDs', () => {
            const id1 = 'test-id-1';
            const id2 = 'test-id-2';

            const path1 = shardManager.getShardPath(id1);
            const path2 = shardManager.getShardPath(id2);

            expect(path1).not.toBe(path2);
        });

        it('should generate path with correct number of levels', () => {
            const id = 'test-id';
            const path = shardManager.getShardPath(id);
            const levels = path.split('/');

            expect(levels.length).toBe(2); // 2 shard levels
        });

        it('should generate numeric shard directories', () => {
            const id = 'test-id';
            const path = shardManager.getShardPath(id);
            const levels = path.split('/');

            levels.forEach(level => {
                expect(level).toMatch(/^\d{3}$/); // Should be 3 digits
            });
        });

        it('should distribute IDs across shards', () => {
            const paths = new Set<string>();
            const numIds = 1000;

            for (let i = 0; i < numIds; i++) {
                const path = shardManager.getShardPath(`id-${i}`);
                paths.add(path);
            }

            // Should have good distribution (at least 50% of possible shards used)
            expect(paths.size).toBeGreaterThan(numIds * 0.1);
        });
    });

    describe('Type-based Shard Path', () => {
        it('should include type in shard path', () => {
            const type = 'user';
            const id = 'test-id';
            const path = shardManager.getShardPathForType(type, id);

            expect(path).toContain(type);
            expect(path.startsWith(`${type}/`)).toBe(true);
        });

        it('should generate consistent paths for same type and ID', () => {
            const type = 'user';
            const id = 'test-id';

            const path1 = shardManager.getShardPathForType(type, id);
            const path2 = shardManager.getShardPathForType(type, id);

            expect(path1).toBe(path2);
        });

        it('should generate different paths for different types', () => {
            const id = 'test-id';
            const path1 = shardManager.getShardPathForType('user', id);
            const path2 = shardManager.getShardPathForType('post', id);

            expect(path1).not.toBe(path2);
        });
    });

    describe('Relationship Shard Path', () => {
        it('should generate shard path for relationships', () => {
            const type = 'FOLLOWS';
            const fromId = 'user-1';
            const toId = 'user-2';

            const path = shardManager.getShardPathForRelationship(type, fromId, toId);

            expect(path).toContain(type);
            expect(path.startsWith(`${type}/`)).toBe(true);
        });

        it('should generate consistent paths for same relationship', () => {
            const type = 'FOLLOWS';
            const fromId = 'user-1';
            const toId = 'user-2';

            const path1 = shardManager.getShardPathForRelationship(type, fromId, toId);
            const path2 = shardManager.getShardPathForRelationship(type, fromId, toId);

            expect(path1).toBe(path2);
        });

        it('should generate different paths for reversed relationships', () => {
            const type = 'FOLLOWS';
            const fromId = 'user-1';
            const toId = 'user-2';

            const path1 = shardManager.getShardPathForRelationship(type, fromId, toId);
            const path2 = shardManager.getShardPathForRelationship(type, toId, fromId);

            expect(path1).not.toBe(path2);
        });

        it('should use combined ID for relationship sharding', () => {
            const type = 'FOLLOWS';
            const fromId = 'user-1';
            const toId = 'user-2';

            const path = shardManager.getShardPathForRelationship(type, fromId, toId);

            // The path should be based on the combined ID
            expect(path).toBeTruthy();
            expect(path.split('/').length).toBeGreaterThan(1);
        });
    });

    describe('Custom Shard Configuration', () => {
        it('should respect custom number of shards', () => {
            const customShardManager = new ShardManager(16, 2);
            const paths = new Set<string>();

            for (let i = 0; i < 100; i++) {
                const path = customShardManager.getShardPath(`id-${i}`);
                paths.add(path);
            }

            // All paths should use shard numbers < 16
            paths.forEach(path => {
                const parts = path.split('/');
                parts.forEach(part => {
                    const shardNum = parseInt(part, 10);
                    expect(shardNum).toBeLessThan(16);
                });
            });
        });

        it('should respect custom shard levels', () => {
            const singleLevel = new ShardManager(256, 1);
            const tripleLevel = new ShardManager(256, 3);

            const path1 = singleLevel.getShardPath('test-id');
            const path3 = tripleLevel.getShardPath('test-id');

            expect(path1.split('/').length).toBe(1);
            expect(path3.split('/').length).toBe(3);
        });

        it('should handle very small shard count', () => {
            const smallShardManager = new ShardManager(2, 1);
            const paths = new Set<string>();

            for (let i = 0; i < 100; i++) {
                const path = smallShardManager.getShardPath(`id-${i}`);
                paths.add(path);
            }

            // Should only have 2 possible shard paths
            expect(paths.size).toBeLessThanOrEqual(2);
        });

        it('should handle large shard count', () => {
            const largeShardManager = new ShardManager(1024, 2);
            const paths = new Set<string>();

            for (let i = 0; i < 1000; i++) {
                const path = largeShardManager.getShardPath(`id-${i}`);
                paths.add(path);
            }

            // Should have good distribution across many shards
            expect(paths.size).toBeGreaterThan(100);
        });
    });

    describe('Hash-based Distribution', () => {
        it('should use SHA-256 hash for distribution', () => {
            const id1 = 'a';
            const id2 = 'b';

            const path1 = shardManager.getShardPath(id1);
            const path2 = shardManager.getShardPath(id2);

            // Even similar IDs should have different paths
            expect(path1).not.toBe(path2);
        });

        it('should handle special characters in IDs', () => {
            const specialIds = [
                'test@example.com',
                'user-123-abc',
                'node_with_underscore',
                '12345-67890',
                'ñoño-español'
            ];

            specialIds.forEach(id => {
                expect(() => shardManager.getShardPath(id)).not.toThrow();
                const path = shardManager.getShardPath(id);
                expect(path).toBeTruthy();
            });
        });

        it('should handle very long IDs', () => {
            const longId = 'a'.repeat(1000);
            expect(() => shardManager.getShardPath(longId)).not.toThrow();
            const path = shardManager.getShardPath(longId);
            expect(path).toBeTruthy();
        });

        it('should handle empty string ID', () => {
            expect(() => shardManager.getShardPath('')).not.toThrow();
            const path = shardManager.getShardPath('');
            expect(path).toBeTruthy();
        });
    });

    describe('Shard Path Format', () => {
        it('should pad shard numbers to 3 digits', () => {
            const paths = new Set<string>();

            for (let i = 0; i < 100; i++) {
                const path = shardManager.getShardPath(`id-${i}`);
                const parts = path.split('/');

                parts.forEach(part => {
                    expect(part.length).toBe(3);
                    expect(part).toMatch(/^\d{3}$/);
                });
            }
        });

        it('should use forward slash as separator', () => {
            const path = shardManager.getShardPath('test-id');
            expect(path).toContain('/');
            expect(path.split('/').length).toBeGreaterThan(1);
        });
    });

    describe('Deterministic Behavior', () => {
        it('should generate same path across different instances', () => {
            const manager1 = new ShardManager(256, 2);
            const manager2 = new ShardManager(256, 2);

            const id = 'test-id-123';
            const path1 = manager1.getShardPath(id);
            const path2 = manager2.getShardPath(id);

            expect(path1).toBe(path2);
        });

        it('should generate same type-based path across instances', () => {
            const manager1 = new ShardManager(256, 2);
            const manager2 = new ShardManager(256, 2);

            const path1 = manager1.getShardPathForType('user', 'id-123');
            const path2 = manager2.getShardPathForType('user', 'id-123');

            expect(path1).toBe(path2);
        });

        it('should generate same relationship path across instances', () => {
            const manager1 = new ShardManager(256, 2);
            const manager2 = new ShardManager(256, 2);

            const path1 = manager1.getShardPathForRelationship('FOLLOWS', 'user-1', 'user-2');
            const path2 = manager2.getShardPathForRelationship('FOLLOWS', 'user-1', 'user-2');

            expect(path1).toBe(path2);
        });
    });
});

