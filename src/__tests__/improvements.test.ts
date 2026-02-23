/**
 * Tests for gap-filling improvements:
 * 1. Duplicate relationship prevention
 * 2. Complete filter operators in FileSystemStorageAdapter
 * 3. Bulk node/relationship creation in S3CoreDB
 * 4. Active cache TTL cleanup (CacheManager.evictExpired / destroy)
 */

import { FileSystemStorageAdapter } from '../filesystem-storage-adapter';
import { S3CoreDB } from '../S3CoreDB';
import { LocalStorageAdapter } from '../local-storage-adapter';
import { CacheManager } from '../cache-manager';
import { Node, AuthContext, Relationship, QueryOptions } from '../types';
import { DuplicateRelationshipError } from '../errors';
import * as fs from 'fs/promises';

const TEST_DIR = 'test-improvements-db';

/** Milliseconds to wait for FileSystemStorageAdapter directory initialization. */
const ADAPTER_INIT_DELAY_MS = 100;

const adminAuth: AuthContext = { userPermissions: ['read', 'create'], isAdmin: true };

// ---------------------------------------------------------------------------
// Duplicate relationship prevention
// ---------------------------------------------------------------------------
describe('Duplicate relationship prevention (FileSystemStorageAdapter)', () => {
    let adapter: FileSystemStorageAdapter;

    beforeEach(async () => {
        adapter = new FileSystemStorageAdapter(TEST_DIR, 256, 2);
        await new Promise(resolve => setTimeout(resolve, ADAPTER_INIT_DELAY_MS));

        await adapter.createNode({ id: 'a', type: 'user', properties: { name: 'A' }, permissions: ['read'] }, adminAuth);
        await adapter.createNode({ id: 'b', type: 'user', properties: { name: 'B' }, permissions: ['read'] }, adminAuth);
    });

    afterEach(async () => {
        try {
            await adapter.cleanup();
            await fs.rm(TEST_DIR, { recursive: true, force: true });
        } catch { /* ignore */ }
    });

    it('should allow creating a relationship once', async () => {
        const rel: Relationship = { from: 'a', to: 'b', type: 'FOLLOWS' };
        await expect(adapter.createRelationship(rel, adminAuth)).resolves.not.toThrow();
    });

    it('should throw DuplicateRelationshipError when creating the same relationship twice', async () => {
        const rel: Relationship = { from: 'a', to: 'b', type: 'FOLLOWS' };
        await adapter.createRelationship(rel, adminAuth);
        await expect(adapter.createRelationship(rel, adminAuth))
            .rejects.toBeInstanceOf(DuplicateRelationshipError);
    });

    it('should allow a different relationship type between the same nodes', async () => {
        const rel1: Relationship = { from: 'a', to: 'b', type: 'FOLLOWS' };
        const rel2: Relationship = { from: 'a', to: 'b', type: 'LIKES' };
        await adapter.createRelationship(rel1, adminAuth);
        await expect(adapter.createRelationship(rel2, adminAuth)).resolves.not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Complete filter operators
// ---------------------------------------------------------------------------
describe('Filter operators (FileSystemStorageAdapter.queryNodesAdvanced)', () => {
    let adapter: FileSystemStorageAdapter;

    beforeEach(async () => {
        adapter = new FileSystemStorageAdapter(TEST_DIR, 256, 2);
        await new Promise(resolve => setTimeout(resolve, ADAPTER_INIT_DELAY_MS));

        const users = [
            { id: 'u1', name: 'Alice', age: 30, city: 'NYC', tags: ['admin', 'user'] },
            { id: 'u2', name: 'Bob',   age: 25, city: 'LA',  tags: ['user'] },
            { id: 'u3', name: 'Carol', age: 35, city: 'NYC', tags: ['user'] },
        ];
        for (const u of users) {
            await adapter.createNode({
                id: u.id,
                type: 'user',
                properties: { name: u.name, age: u.age, city: u.city, tags: u.tags },
                permissions: ['read']
            }, adminAuth);
        }
    });

    afterEach(async () => {
        try {
            await adapter.cleanup();
            await fs.rm(TEST_DIR, { recursive: true, force: true });
        } catch { /* ignore */ }
    });

    const advancedQuery = (options: QueryOptions) => adapter.queryNodesAdvanced(options, adminAuth);

    it('neq - not equal', async () => {
        const res = await advancedQuery({ filter: { field: 'properties.city', operator: 'neq', value: 'NYC' } });
        expect(res.items.length).toBe(1);
        expect(res.items[0].properties.city).toBe('LA');
    });

    it('gte - greater than or equal', async () => {
        const res = await advancedQuery({ filter: { field: 'properties.age', operator: 'gte', value: 30 } });
        expect(res.items.length).toBe(2);
        expect(res.items.every(n => n.properties.age >= 30)).toBe(true);
    });

    it('lte - less than or equal', async () => {
        const res = await advancedQuery({ filter: { field: 'properties.age', operator: 'lte', value: 30 } });
        expect(res.items.length).toBe(2);
        expect(res.items.every(n => n.properties.age <= 30)).toBe(true);
    });

    it('in - value is in list', async () => {
        const res = await advancedQuery({ filter: { field: 'properties.city', operator: 'in', value: ['NYC', 'Chicago'] } });
        expect(res.items.length).toBe(2);
        expect(res.items.every(n => n.properties.city === 'NYC')).toBe(true);
    });

    it('nin - value is not in list', async () => {
        const res = await advancedQuery({ filter: { field: 'properties.city', operator: 'nin', value: ['NYC'] } });
        expect(res.items.length).toBe(1);
        expect(res.items[0].properties.city).toBe('LA');
    });

    it('startsWith - string starts with', async () => {
        const res = await advancedQuery({ filter: { field: 'properties.name', operator: 'startsWith', value: 'Al' } });
        expect(res.items.length).toBe(1);
        expect(res.items[0].properties.name).toBe('Alice');
    });

    it('endsWith - string ends with', async () => {
        const res = await advancedQuery({ filter: { field: 'properties.name', operator: 'endsWith', value: 'ol' } });
        expect(res.items.length).toBe(1);
        expect(res.items[0].properties.name).toBe('Carol');
    });

    it('contains - string contains substring', async () => {
        const res = await advancedQuery({ filter: { field: 'properties.name', operator: 'contains', value: 'ob' } });
        expect(res.items.length).toBe(1);
        expect(res.items[0].properties.name).toBe('Bob');
    });

    it('contains - array contains element', async () => {
        const res = await advancedQuery({ filter: { field: 'properties.tags', operator: 'contains', value: 'admin' } });
        expect(res.items.length).toBe(1);
        expect(res.items[0].properties.name).toBe('Alice');
    });

    it('not logic operator', async () => {
        const res = await advancedQuery({
            filter: {
                logic: 'not',
                filters: [{ field: 'properties.city', operator: 'eq', value: 'NYC' }]
            }
        });
        expect(res.items.length).toBe(1);
        expect(res.items[0].properties.city).toBe('LA');
    });

    it('and logic operator', async () => {
        const res = await advancedQuery({
            filter: {
                logic: 'and',
                filters: [
                    { field: 'properties.city', operator: 'eq', value: 'NYC' },
                    { field: 'properties.age', operator: 'gt', value: 30 }
                ]
            }
        });
        expect(res.items.length).toBe(1);
        expect(res.items[0].properties.name).toBe('Carol');
    });

    it('or logic operator', async () => {
        const res = await advancedQuery({
            filter: {
                logic: 'or',
                filters: [
                    { field: 'properties.city', operator: 'eq', value: 'LA' },
                    { field: 'properties.age', operator: 'gt', value: 34 }
                ]
            }
        });
        expect(res.items.length).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------
describe('Bulk operations (S3CoreDB)', () => {
    let db: S3CoreDB;

    beforeEach(() => {
        const adapter = new LocalStorageAdapter();
        db = new S3CoreDB(
            { endpoint: 'http://localhost:4566', accessKeyId: 'test', secretAccessKey: 'test', bucket: 'test' },
            adapter
        );
        db.setDefaultAuthContext(adminAuth);
    });

    describe('createNodesBulk', () => {
        it('should create multiple nodes in one call', async () => {
            const nodeDefs = [
                { type: 'user', properties: { name: 'Alice' }, permissions: ['read'] },
                { type: 'user', properties: { name: 'Bob' },   permissions: ['read'] },
                { type: 'user', properties: { name: 'Carol' }, permissions: ['read'] },
            ];

            const nodes = await db.createNodesBulk(nodeDefs);

            expect(nodes).toHaveLength(3);
            expect(nodes.every(n => n.id && n.type === 'user')).toBe(true);
            expect(nodes.map(n => n.properties.name).sort()).toEqual(['Alice', 'Bob', 'Carol']);
        });

        it('should assign unique IDs to each bulk-created node', async () => {
            const nodeDefs = [
                { type: 'item', properties: { v: 1 }, permissions: ['read'] },
                { type: 'item', properties: { v: 2 }, permissions: ['read'] },
            ];
            const nodes = await db.createNodesBulk(nodeDefs);
            const ids = new Set(nodes.map(n => n.id));
            expect(ids.size).toBe(2);
        });

        it('should propagate validation errors', async () => {
            const nodeDefs = [
                { type: 'user', properties: { name: 'Valid' }, permissions: ['read'] },
                { type: '../invalid-type', properties: { name: 'Bad' }, permissions: ['read'] },
            ];
            await expect(db.createNodesBulk(nodeDefs)).rejects.toThrow();
        });
    });

    describe('createRelationshipsBulk', () => {
        it('should create multiple relationships in one call', async () => {
            const [a, b, c] = await db.createNodesBulk([
                { type: 'user', properties: { name: 'A' }, permissions: ['read'] },
                { type: 'user', properties: { name: 'B' }, permissions: ['read'] },
                { type: 'user', properties: { name: 'C' }, permissions: ['read'] },
            ]);

            const rels: Relationship[] = [
                { from: a.id, to: b.id, type: 'FOLLOWS' },
                { from: a.id, to: c.id, type: 'FOLLOWS' },
            ];

            await expect(db.createRelationshipsBulk(rels)).resolves.not.toThrow();

            const related = await db.queryRelatedNodes(a.id, 'FOLLOWS', adminAuth, { direction: 'OUT' });
            expect(related.length).toBe(2);
        });

        it('should propagate errors when a relationship is invalid', async () => {
            const rels: Relationship[] = [
                { from: 'non-existent-a', to: 'non-existent-b', type: 'FOLLOWS' },
            ];
            await expect(db.createRelationshipsBulk(rels)).rejects.toThrow();
        });
    });
});

// ---------------------------------------------------------------------------
// CacheManager: evictExpired and destroy
// ---------------------------------------------------------------------------
describe('CacheManager active TTL cleanup', () => {
    it('evictExpired removes entries whose TTL has passed', () => {
        const ttlMs = 100;
        const cache = new CacheManager({ ttl: ttlMs });

        const node: Node = { id: 'n1', type: 'user', properties: { name: 'Alice' }, permissions: ['read'] };
        cache.cacheNode(node);
        expect(cache.getNode('n1')).not.toBeNull();

        // Manually backdate the timestamp by using a fresh evictExpired call after waiting
        // We advance "virtual time" by manipulating Date.now - simplest approach: wait > ttl
        return new Promise<void>(resolve => {
            setTimeout(() => {
                cache.evictExpired();
                expect(cache.getNode('n1')).toBeNull();
                cache.destroy();
                resolve();
            }, ttlMs + 50);
        });
    });

    it('destroy stops the internal cleanup timer', () => {
        const cache = new CacheManager({ ttl: 5000 });
        expect(() => cache.destroy()).not.toThrow();
        // Calling destroy twice should be safe
        expect(() => cache.destroy()).not.toThrow();
    });
});
