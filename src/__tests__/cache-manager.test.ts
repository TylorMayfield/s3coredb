import { CacheManager } from '../cache-manager';
import { Node, Relationship } from '../types';

describe('CacheManager', () => {
    let cacheManager: CacheManager;

    beforeEach(() => {
        cacheManager = new CacheManager({
            ttl: 60000, // 1 minute
            maxSize: 100
        });
    });

    afterEach(() => {
        cacheManager.clear();
    });

    describe('Node Caching', () => {
        it('should cache and retrieve a node', () => {
            const node: Node = {
                id: '1',
                type: 'user',
                properties: { name: 'Alice' },
                permissions: ['read']
            };

            cacheManager.cacheNode(node);
            const cached = cacheManager.getNode('1');

            expect(cached).toEqual(node);
        });

        it('should return null for non-existent node', () => {
            const cached = cacheManager.getNode('non-existent');
            expect(cached).toBeNull();
        });

        it('should expire node after TTL', (done) => {
            const node: Node = {
                id: '1',
                type: 'user',
                properties: { name: 'Alice' },
                permissions: ['read']
            };

            const shortTTLCache = new CacheManager({ ttl: 100 }); // 100ms
            shortTTLCache.cacheNode(node);

            setTimeout(() => {
                const cached = shortTTLCache.getNode('1');
                expect(cached).toBeNull();
                done();
            }, 150);
        });

        it('should evict oldest node when maxSize is reached', () => {
            const smallCache = new CacheManager({ maxSize: 2 });

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
            const node3: Node = {
                id: '3',
                type: 'user',
                properties: { name: 'Charlie' },
                permissions: ['read']
            };

            smallCache.cacheNode(node1);
            smallCache.cacheNode(node2);
            smallCache.cacheNode(node3);

            // First node should be evicted
            expect(smallCache.getNode('1')).toBeNull();
            expect(smallCache.getNode('2')).not.toBeNull();
            expect(smallCache.getNode('3')).not.toBeNull();
        });
    });

    describe('Relationship Caching', () => {
        it('should cache and retrieve a relationship', () => {
            const relationship: Relationship = {
                from: '1',
                to: '2',
                type: 'FOLLOWS',
                permissions: ['read']
            };

            cacheManager.cacheRelationship(relationship);
            const cached = cacheManager.getRelationship('1', '2', 'FOLLOWS');

            expect(cached).toEqual(relationship);
        });

        it('should return null for non-existent relationship', () => {
            const cached = cacheManager.getRelationship('1', '2', 'FOLLOWS');
            expect(cached).toBeNull();
        });

        it('should expire relationship after TTL', (done) => {
            const relationship: Relationship = {
                from: '1',
                to: '2',
                type: 'FOLLOWS',
                permissions: ['read']
            };

            const shortTTLCache = new CacheManager({ ttl: 100 });
            shortTTLCache.cacheRelationship(relationship);

            setTimeout(() => {
                const cached = shortTTLCache.getRelationship('1', '2', 'FOLLOWS');
                expect(cached).toBeNull();
                done();
            }, 150);
        });
    });

    describe('Type Index', () => {
        it('should index nodes by type', () => {
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
            const node3: Node = {
                id: '3',
                type: 'post',
                properties: { title: 'Hello' },
                permissions: ['read']
            };

            cacheManager.cacheNode(node1);
            cacheManager.cacheNode(node2);
            cacheManager.cacheNode(node3);

            const userNodes = cacheManager.queryNodesByType('user');
            expect(userNodes.size).toBe(2);
            expect(userNodes.has('1')).toBe(true);
            expect(userNodes.has('2')).toBe(true);

            const postNodes = cacheManager.queryNodesByType('post');
            expect(postNodes.size).toBe(1);
            expect(postNodes.has('3')).toBe(true);
        });

        it('should return empty set for non-existent type', () => {
            const nodes = cacheManager.queryNodesByType('non-existent');
            expect(nodes.size).toBe(0);
        });
    });

    describe('Property Index', () => {
        it('should index nodes by property value', () => {
            const node1: Node = {
                id: '1',
                type: 'user',
                properties: { name: 'Alice', age: 30 },
                permissions: ['read']
            };
            const node2: Node = {
                id: '2',
                type: 'user',
                properties: { name: 'Bob', age: 30 },
                permissions: ['read']
            };
            const node3: Node = {
                id: '3',
                type: 'user',
                properties: { name: 'Charlie', age: 25 },
                permissions: ['read']
            };

            cacheManager.cacheNode(node1);
            cacheManager.cacheNode(node2);
            cacheManager.cacheNode(node3);

            const age30Nodes = cacheManager.queryNodesByProperty('user', 'age', 30);
            expect(age30Nodes.size).toBe(2);
            expect(age30Nodes.has('1')).toBe(true);
            expect(age30Nodes.has('2')).toBe(true);

            const age25Nodes = cacheManager.queryNodesByProperty('user', 'age', 25);
            expect(age25Nodes.size).toBe(1);
            expect(age25Nodes.has('3')).toBe(true);
        });

        it('should handle string property values', () => {
            const node1: Node = {
                id: '1',
                type: 'user',
                properties: { name: 'Alice' },
                permissions: ['read']
            };

            cacheManager.cacheNode(node1);

            const aliceNodes = cacheManager.queryNodesByProperty('user', 'name', 'Alice');
            expect(aliceNodes.size).toBe(1);
            expect(aliceNodes.has('1')).toBe(true);
        });

        it('should return empty set for non-existent property', () => {
            const nodes = cacheManager.queryNodesByProperty('user', 'non-existent', 'value');
            expect(nodes.size).toBe(0);
        });
    });

    describe('Relationship Type Index', () => {
        it('should index relationships by type', () => {
            const rel1: Relationship = {
                from: '1',
                to: '2',
                type: 'FOLLOWS',
                permissions: ['read']
            };
            const rel2: Relationship = {
                from: '2',
                to: '3',
                type: 'FOLLOWS',
                permissions: ['read']
            };
            const rel3: Relationship = {
                from: '1',
                to: '3',
                type: 'LIKES',
                permissions: ['read']
            };

            cacheManager.cacheRelationship(rel1);
            cacheManager.cacheRelationship(rel2);
            cacheManager.cacheRelationship(rel3);

            const followsRels = cacheManager.queryRelationshipsByType('FOLLOWS');
            expect(followsRels.size).toBe(2);

            const likesRels = cacheManager.queryRelationshipsByType('LIKES');
            expect(likesRels.size).toBe(1);
        });
    });

    describe('Compound Index', () => {
        it('should query by compound index', () => {
            const cache = new CacheManager({
                indexes: {
                    compound: [
                        { type: 'user', properties: ['city', 'age'] }
                    ]
                }
            });

            const node1: Node = {
                id: '1',
                type: 'user',
                properties: { name: 'Alice', city: 'NYC', age: 30 },
                permissions: ['read']
            };
            const node2: Node = {
                id: '2',
                type: 'user',
                properties: { name: 'Bob', city: 'NYC', age: 30 },
                permissions: ['read']
            };
            const node3: Node = {
                id: '3',
                type: 'user',
                properties: { name: 'Charlie', city: 'LA', age: 30 },
                permissions: ['read']
            };

            cache.cacheNode(node1);
            cache.cacheNode(node2);
            cache.cacheNode(node3);

            const nycAge30 = cache.queryByCompoundIndex('user', ['city', 'age'], ['NYC', 30]);
            expect(nycAge30.size).toBe(2);
            expect(nycAge30.has('1')).toBe(true);
            expect(nycAge30.has('2')).toBe(true);
        });
    });

    describe('Range Index', () => {
        it('should query by range index', () => {
            const cache = new CacheManager({
                indexes: {
                    range: [
                        { type: 'user', property: 'age' }
                    ]
                }
            });

            const node1: Node = {
                id: '1',
                type: 'user',
                properties: { name: 'Alice', age: 25 },
                permissions: ['read']
            };
            const node2: Node = {
                id: '2',
                type: 'user',
                properties: { name: 'Bob', age: 30 },
                permissions: ['read']
            };
            const node3: Node = {
                id: '3',
                type: 'user',
                properties: { name: 'Charlie', age: 35 },
                permissions: ['read']
            };

            cache.cacheNode(node1);
            cache.cacheNode(node2);
            cache.cacheNode(node3);

            const ageRange = cache.queryByRange('user', 'age', 25, 30);
            expect(ageRange.size).toBeGreaterThanOrEqual(2);
        });
    });

    describe('Prefix Index', () => {
        it('should query by prefix', () => {
            const node1: Node = {
                id: '1',
                type: 'user',
                properties: { name: 'Alice' },
                permissions: ['read']
            };
            const node2: Node = {
                id: '2',
                type: 'user',
                properties: { name: 'Alex' },
                permissions: ['read']
            };
            const node3: Node = {
                id: '3',
                type: 'user',
                properties: { name: 'Bob' },
                permissions: ['read']
            };

            cacheManager.cacheNode(node1);
            cacheManager.cacheNode(node2);
            cacheManager.cacheNode(node3);

            const alPrefix = cacheManager.queryByPrefix('user', 'name', 'Al');
            expect(alPrefix.size).toBe(2);
            expect(alPrefix.has('1')).toBe(true);
            expect(alPrefix.has('2')).toBe(true);
        });
    });

    describe('Traversal Cache', () => {
        it('should cache and retrieve traversal results', () => {
            cacheManager.cacheTraversalResult('1', 'FOLLOWS', 'OUT', ['2', '3']);

            const result = cacheManager.getTraversalResult('1', 'FOLLOWS', 'OUT');
            expect(result).not.toBeNull();
            expect(result?.size).toBe(2);
            expect(result?.has('2')).toBe(true);
            expect(result?.has('3')).toBe(true);
        });

        it('should return null for non-existent traversal', () => {
            const result = cacheManager.getTraversalResult('1', 'FOLLOWS', 'OUT');
            expect(result).toBeNull();
        });

        it('should use adjacency lists for traversal cache', () => {
            const rel1: Relationship = {
                from: '1',
                to: '2',
                type: 'FOLLOWS',
                permissions: ['read']
            };
            const rel2: Relationship = {
                from: '1',
                to: '3',
                type: 'FOLLOWS',
                permissions: ['read']
            };

            cacheManager.cacheRelationship(rel1);
            cacheManager.cacheRelationship(rel2);

            const result = cacheManager.getTraversalResult('1', 'FOLLOWS', 'OUT');
            expect(result).not.toBeNull();
            expect(result?.size).toBe(2);
            expect(result?.has('2')).toBe(true);
            expect(result?.has('3')).toBe(true);
        });

        it('should handle IN direction traversal', () => {
            const rel1: Relationship = {
                from: '2',
                to: '1',
                type: 'FOLLOWS',
                permissions: ['read']
            };
            const rel2: Relationship = {
                from: '3',
                to: '1',
                type: 'FOLLOWS',
                permissions: ['read']
            };

            cacheManager.cacheRelationship(rel1);
            cacheManager.cacheRelationship(rel2);

            const result = cacheManager.getTraversalResult('1', 'FOLLOWS', 'IN');
            expect(result).not.toBeNull();
            expect(result?.size).toBe(2);
            expect(result?.has('2')).toBe(true);
            expect(result?.has('3')).toBe(true);
        });
    });

    describe('Batch Operations', () => {
        it('should batch cache operations', async () => {
            cacheManager.startBatch();

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

            cacheManager.cacheNode(node1);
            cacheManager.cacheNode(node2);

            // Nodes should not be in cache yet
            expect(cacheManager.getNode('1')).toBeNull();
            expect(cacheManager.getNode('2')).toBeNull();

            await cacheManager.commitBatch();

            // Now nodes should be in cache
            expect(cacheManager.getNode('1')).not.toBeNull();
            expect(cacheManager.getNode('2')).not.toBeNull();
        });
    });

    describe('Cache Clearing', () => {
        it('should clear all caches', () => {
            const node: Node = {
                id: '1',
                type: 'user',
                properties: { name: 'Alice' },
                permissions: ['read']
            };
            const rel: Relationship = {
                from: '1',
                to: '2',
                type: 'FOLLOWS',
                permissions: ['read']
            };

            cacheManager.cacheNode(node);
            cacheManager.cacheRelationship(rel);

            cacheManager.clear();

            expect(cacheManager.getNode('1')).toBeNull();
            expect(cacheManager.getRelationship('1', '2', 'FOLLOWS')).toBeNull();
            expect(cacheManager.queryNodesByType('user').size).toBe(0);
        });
    });

    describe('Traversal Statistics', () => {
        it('should track traversal statistics', () => {
            cacheManager.cacheTraversalResult('1', 'FOLLOWS', 'OUT', ['2', '3']);

            // Hit the cache
            cacheManager.getTraversalResult('1', 'FOLLOWS', 'OUT');
            cacheManager.getTraversalResult('1', 'FOLLOWS', 'OUT');

            // Miss the cache
            cacheManager.getTraversalResult('2', 'FOLLOWS', 'OUT');

            const stats = cacheManager.getTraversalStats();
            expect(stats.size).toBeGreaterThan(0);
        });

        it('should record traversal response time', () => {
            const cacheKey = '1:FOLLOWS:OUT';
            cacheManager.recordTraversalResponseTime(cacheKey, 100);
            cacheManager.recordTraversalResponseTime(cacheKey, 200);

            const stats = cacheManager.getTraversalStats();
            const keyStat = stats.get(cacheKey);
            expect(keyStat).toBeDefined();
            expect(keyStat?.avgResponseTime).toBeGreaterThan(0);
        });
    });

    describe('Index Statistics', () => {
        it('should track index access statistics', () => {
            const cache = new CacheManager({
                indexes: {
                    compound: [
                        { type: 'user', properties: ['city', 'age'] }
                    ]
                }
            });

            const node: Node = {
                id: '1',
                type: 'user',
                properties: { city: 'NYC', age: 30 },
                permissions: ['read']
            };

            cache.cacheNode(node);

            // Access the compound index
            cache.queryByCompoundIndex('user', ['city', 'age'], ['NYC', 30]);

            const stats = cache.getIndexStats();
            expect(stats.size).toBeGreaterThan(0);
        });
    });
});

