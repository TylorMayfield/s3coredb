import { Node, Relationship, StorageAdapter, AuthContext, QueryOptions, QueryResult, CacheOptions } from './types';
import { logger } from './logger';
import { CacheManager } from './cache-manager';
import { ShardManager } from './shard-manager';
import { Validator, DEFAULT_QUERY_LIMIT, validateQueryLimit } from './validator';
import { PermissionDeniedError, NodeNotFoundError, ValidationError, ConcurrentModificationError } from './errors';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface DBCacheConfig {
    enabled: boolean;
    directory: string;
    persistenceInterval: number;
    maxCacheAge: number;
}

export abstract class BaseStorageAdapter implements StorageAdapter {
    protected cache: CacheManager;
    protected shardManager: ShardManager;
    protected dbCacheConfig: DBCacheConfig = {
        enabled: false,
        directory: '.db-cache',
        persistenceInterval: 300000, // 5 minutes
        maxCacheAge: 86400000 // 24 hours
    };
    private persistenceTimer: NodeJS.Timeout | null = null;

    constructor(cacheOptions?: CacheOptions, numShards: number = 256, shardLevels: number = 2) {
        this.cache = new CacheManager(cacheOptions);
        this.shardManager = new ShardManager(numShards, shardLevels);
        if (cacheOptions?.dbCache) {
            this.configureCacheOptions(cacheOptions);
        }
    }

    configureCacheOptions(options: CacheOptions): void {
        this.cache = new CacheManager(options);
        if (options.dbCache) {
            this.dbCacheConfig = { ...this.dbCacheConfig, ...options.dbCache };
            if (this.dbCacheConfig.enabled) {
                this.initializeDatabaseCache();
            }
        }
    }

    private async initializeDatabaseCache(): Promise<void> {
        try {
            await fs.mkdir(this.dbCacheConfig.directory, { recursive: true });
            await this.loadDatabaseCache();
            this.startPersistenceTimer();
            logger.info('Database cache initialized', { directory: this.dbCacheConfig.directory });
        } catch (error) {
            logger.error('Failed to initialize database cache', { error });
        }
    }

    private async loadDatabaseCache(): Promise<void> {
        try {
            const cacheFiles = await fs.readdir(this.dbCacheConfig.directory);
            
            for (const file of cacheFiles) {
                if (file.endsWith('.cache.json')) {
                    const filePath = path.join(this.dbCacheConfig.directory, file);
                    const stats = await fs.stat(filePath);
                    
                    if (Date.now() - stats.mtime.getTime() > this.dbCacheConfig.maxCacheAge) {
                        await fs.unlink(filePath);
                        continue;
                    }
                    
                    const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
                    this.restoreCacheData(data, file);
                }
            }
        } catch (error) {
            logger.warn('Error loading database cache', { error });
        }
    }

    private startPersistenceTimer(): void {
        if (this.persistenceTimer) {
            clearInterval(this.persistenceTimer);
        }
        
        this.persistenceTimer = setInterval(
            () => this.persistDatabaseCache(),
            this.dbCacheConfig.persistenceInterval
        );
    }

    private async persistDatabaseCache(): Promise<void> {
        if (!this.dbCacheConfig.enabled) return;

        try {
            const indexData = {
                typeIndex: this.serializeIndex(this.cache.getTypeIndex()),
                propertyIndexes: this.serializePropertyIndexes(),
                relationshipTypeIndex: this.serializeIndex(this.cache.getRelationshipTypeIndex()),
                timestamp: Date.now()
            };

            await fs.writeFile(
                path.join(this.dbCacheConfig.directory, 'indexes.cache.json'),
                JSON.stringify(indexData),
                'utf-8'
            );

            // Get all nodes from the type index for initial caching
            const typeIndex = this.cache.getTypeIndex();
            const allNodeIds = new Set<string>();
            for (const nodeIds of typeIndex.values()) {
                for (const id of nodeIds) {
                    allNodeIds.add(id);
                }
            }

            // Include both frequently accessed and recently added nodes
            const nodeStats = this.cache.getIndexStats();
            const frequentNodes = Array.from(nodeStats.entries())
                .filter(([_, stats]) => stats.hits > 5) // Lower threshold for initial caching
                .map(([key]) => key);
            
            frequentNodes.forEach(id => allNodeIds.add(id));

            const nodeCacheData = {
                nodes: Array.from(allNodeIds)
                    .map(id => this.cache.getNode(id))
                    .filter(Boolean),
                timestamp: Date.now()
            };

            await fs.writeFile(
                path.join(this.dbCacheConfig.directory, 'nodes.cache.json'),
                JSON.stringify(nodeCacheData),
                'utf-8'
            );

            logger.debug('Database cache persisted successfully', {
                indexCount: Object.keys(indexData.typeIndex).length,
                nodeCount: nodeCacheData.nodes.length
            });
        } catch (error) {
            logger.error('Failed to persist database cache', { error });
        }
    }

    private serializeIndex(index: Map<string, Set<string>>): Record<string, string[]> {
        const serialized: Record<string, string[]> = {};
        for (const [key, value] of index.entries()) {
            serialized[key] = Array.from(value);
        }
        return serialized;
    }

    private serializePropertyIndexes(): Record<string, Record<string, string[]>> {
        const serialized: Record<string, Record<string, string[]>> = {};
        for (const [key, valueMap] of this.cache.getPropertyIndexes().entries()) {
            serialized[key] = {};
            for (const [propValue, nodeSet] of valueMap.entries()) {
                serialized[key][propValue] = Array.from(nodeSet);
            }
        }
        return serialized;
    }

    private restoreCacheData(data: any, filename: string): void {
        try {
            if (filename === 'indexes.cache.json') {
                this.restoreIndexes(data);
            } else if (filename === 'nodes.cache.json') {
                this.restoreNodes(data);
            }
        } catch (error) {
            logger.error('Error restoring cache data', { filename, error });
        }
    }

    private restoreIndexes(data: any): void {
        const typeIndex = this.cache.getTypeIndex();
        const propertyIndexes = this.cache.getPropertyIndexes();

        // Restore type index
        for (const [type, nodeIds] of Object.entries(data.typeIndex)) {
            if (!typeIndex.has(type)) {
                typeIndex.set(type, new Set());
            }
            for (const id of nodeIds as string[]) {
                typeIndex.get(type)!.add(id);
            }
        }

        // Restore property indexes
        for (const [indexKey, values] of Object.entries(data.propertyIndexes)) {
            if (!propertyIndexes.has(indexKey)) {
                propertyIndexes.set(indexKey, new Map());
            }
            const propertyIndex = propertyIndexes.get(indexKey)!;
            for (const [value, nodeIds] of Object.entries(values as Record<string, string[]>)) {
                if (!propertyIndex.has(value)) {
                    propertyIndex.set(value, new Set());
                }
                for (const id of nodeIds) {
                    propertyIndex.get(value)!.add(id);
                }
            }
        }
    }

    private restoreNodes(data: any): void {
        for (const node of data.nodes) {
            this.cache.cacheNode(node);
        }
    }

    protected getShardPath(id: string): string {
        return this.shardManager.getShardPath(id);
    }

    protected getShardPathForType(type: string, id: string): string {
        return this.shardManager.getShardPathForType(type, id);
    }

    protected getShardPathForRelationship(type: string, fromId: string, toId: string): string {
        return this.shardManager.getShardPathForRelationship(type, fromId, toId);
    }

    abstract createNode(node: Node, auth: AuthContext): Promise<Node>;
    abstract getNode(id: string, auth: AuthContext): Promise<Node | null>;
    abstract updateNode(id: string, updates: Partial<Node>, auth: AuthContext): Promise<Node>;
    abstract deleteNode(id: string, auth: AuthContext): Promise<void>;
    abstract getNodeTypeFromId(id: string): Promise<string | null>;
    abstract queryNodes(query: any, auth: AuthContext, options?: { limit?: number; offset?: number }): Promise<Node[]>;
    abstract createRelationship(relationship: Relationship, auth: AuthContext): Promise<void>;
    abstract updateRelationship(from: string, to: string, type: string, updates: Partial<Relationship>, auth: AuthContext): Promise<void>;
    abstract deleteRelationship(from: string, to: string, type: string, auth: AuthContext): Promise<void>;
    abstract queryRelatedNodes(
        from: string,
        type: string,
        auth: AuthContext,
        options?: { direction?: "IN" | "OUT"; skipCache?: boolean; limit?: number }
    ): Promise<Node[]>;
    abstract queryNodesAdvanced(options: QueryOptions, auth: AuthContext): Promise<QueryResult>;

    protected async getCachedNode(id: string, auth: AuthContext): Promise<Node | null> {
        const cached = this.cache.getNode(id);
        if (cached && this.canAccessNode(cached, auth)) {
            logger.debug('Cache hit for node', { id });
            return cached;
        }
        return null;
    }

    protected async getCachedRelationship(from: string, to: string, type: string): Promise<Relationship | null> {
        return this.cache.getRelationship(from, to, type);
    }

    protected matchesQuery(node: Node, query: any): boolean {
        // Always do full property matching to ensure accuracy
        // (Cache indexes are optimization hints, not required)
        for (const [key, value] of Object.entries(query)) {
            if (key === 'type') {
                if (node.type !== value) return false;
            } else if (key.startsWith('properties.')) {
                const propertyValue = this.getNestedValue(node, key);
                if (Array.isArray(value)) {
                    // For array queries, check if all query values are in the node's property array
                    if (!Array.isArray(propertyValue) || !value.every(v => propertyValue.includes(v))) {
                        return false;
                    }
                } else if (propertyValue !== value) {
                    return false;
                }
            }
        }
        return true;
    }

    protected getNestedValue(obj: any, path: string): any {
        return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
    }

    protected canAccessNode(node: Node, auth: AuthContext): boolean {
        if (auth.isAdmin) return true;
        return node.permissions.some(perm => auth.userPermissions.includes(perm));
    }

    protected matchesRelationshipQuery(
        relationship: Relationship,
        from: string,
        type: string,
        direction?: "IN" | "OUT"
    ): boolean {
        if (relationship.type !== type) return false;
        return !direction || 
            (direction === "OUT" && relationship.from === from) ||
            (direction === "IN" && relationship.to === from);
    }

    protected validateNode(node: Node): void {
        Validator.validateNode(node);
        // Add node to cache after validation
        this.cache.cacheNode(node);
    }

    protected validateRelationship(relationship: Relationship): void {
        Validator.validateRelationship(relationship);
        // Add relationship to cache after validation
        this.cache.cacheRelationship(relationship);
    }

    protected validateNodeForUpdate(updates: Partial<Node>): void {
        if (Object.keys(updates).length === 0) {
            throw new ValidationError('updates', 'Update object cannot be empty');
        }

        // Validate each field if present
        Validator.validateNode(updates);

        // Don't allow updating id or version manually
        if ('id' in updates) {
            throw new ValidationError('id', 'Cannot update node ID');
        }
    }

    protected validateRelationshipForUpdate(updates: Partial<Relationship>): void {
        if (Object.keys(updates).length === 0) {
            throw new ValidationError('updates', 'Update object cannot be empty');
        }

        Validator.validateRelationship(updates);

        // Don't allow updating from/to/type
        if ('from' in updates || 'to' in updates || 'type' in updates) {
            throw new ValidationError('updates', 'Cannot update relationship from, to, or type');
        }
    }

    protected clearCache(): void {
        this.cache.clear();
    }

    protected async queryRelatedNodesWithCache(
        from: string,
        type: string,
        auth: AuthContext,
        options?: { direction?: "IN" | "OUT"; skipCache?: boolean }
    ): Promise<Node[]> {
        // Skip cache if explicitly requested
        if (options?.skipCache) {
            return this.queryRelatedNodes(from, type, auth, { direction: options.direction });
        }

        // Check traversal cache first
        const cachedNodeIds = this.cache.getTraversalResult(from, type, options?.direction);
        if (cachedNodeIds) {
            const nodes = await Promise.all(
                Array.from(cachedNodeIds)
                    .map(id => this.getNode(id, auth))
            );
            return nodes.filter((node): node is Node => node !== null);
        }

        // If not in cache, perform the traversal with skipCache to prevent recursion
        const nodes = await this.queryRelatedNodes(from, type, auth, { 
            direction: options?.direction,
            skipCache: true 
        });
        
        // Cache the result for future use
        this.cache.cacheTraversalResult(
            from,
            type,
            options?.direction,
            nodes.map(n => n.id)
        );

        return nodes;
    }
}