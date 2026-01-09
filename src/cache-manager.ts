import { Node, Relationship, CompoundIndexConfig, RangeIndexConfig } from './types';
import { logger } from './logger';
import * as fs from 'fs/promises';
import * as path from 'path';

interface RangeEntry {
    min: number;
    max: number;
    nodeIds: Set<string>;
}

interface DBCacheConfig {
    enabled: boolean;
    directory: string;
    persistenceInterval: number;
    maxCacheAge: number;
}

export class CacheManager {
    private nodeCache: Map<string, { node: Node; timestamp: number }> = new Map();
    private relationshipCache: Map<string, { relationship: Relationship; timestamp: number }> = new Map();
    private traversalCache: Map<string, { nodeIds: Set<string>; timestamp: number }> = new Map(); // sourceId:type:direction -> Set<targetIds>
    private propertyIndexes: Map<string, Map<string, Set<string>>> = new Map(); // type -> property -> nodeIds
    private typeIndex: Map<string, Set<string>> = new Map(); // type -> nodeIds
    private relationshipTypeIndex: Map<string, Set<string>> = new Map(); // type -> relationshipIds
    private ttl: number;
    private maxSize: number;
    private compoundIndexes: Map<string, Map<string, Set<string>>> = new Map(); // indexKey -> valueKey -> nodeIds
    private rangeIndexes: Map<string, RangeEntry[]> = new Map(); // type:property -> ranges
    private prefixIndexes: Map<string, Map<string, Set<string>>> = new Map(); // type:property -> prefix -> nodeIds
    private indexStats: Map<string, { hits: number; misses: number }> = new Map();
    private batchMode = false;
    private batchQueue: Array<() => void> = [];
    private traversalStats: Map<string, { hits: number; misses: number; avgResponseTime: number }> = new Map();
    private dbCacheConfig: DBCacheConfig = {
        enabled: false,
        directory: '',
        persistenceInterval: 60000,
        maxCacheAge: 3600000
    };
    private adjacencyLists: Map<string, Map<string, Set<string>>> = new Map(); // nodeId -> (type -> Set<targetIds>)
    private reverseAdjacencyLists: Map<string, Map<string, Set<string>>> = new Map(); // nodeId -> (type -> Set<sourceIds>)

    constructor(options: { 
        ttl?: number; 
        maxSize?: number; 
        indexes?: { 
            compound?: CompoundIndexConfig[]; 
            range?: RangeIndexConfig[] 
        };
        dbCache?: DBCacheConfig;
    } = {}) {
        this.ttl = options.ttl || 5 * 60 * 1000; // 5 minutes default TTL
        this.maxSize = options.maxSize || 10000; // Max 10000 entries default
        
        if (options.dbCache) {
            this.dbCacheConfig = { ...this.dbCacheConfig, ...options.dbCache };
        }
        
        // Initialize configured indexes
        if (options.indexes) {
            this.initializeConfiguredIndexes(options.indexes);
        }
    }

    private initializeConfiguredIndexes(config: { compound?: CompoundIndexConfig[]; range?: RangeIndexConfig[] }): void {
        if (config.compound) {
            for (const idx of config.compound) {
                const indexKey = this.getCompoundIndexKey(idx.type, idx.properties);
                this.compoundIndexes.set(indexKey, new Map());
            }
        }
        if (config.range) {
            for (const idx of config.range) {
                const indexKey = `${idx.type}:${idx.property}`;
                this.rangeIndexes.set(indexKey, []);
            }
        }
    }

    startBatch(): void {
        this.batchMode = true;
        this.batchQueue = [];
    }

    async commitBatch(): Promise<void> {
        const operations = this.batchQueue;
        this.batchQueue = [];
        this.batchMode = false;
        
        for (const op of operations) {
            op();
        }
    }

    private queueOrExecute(operation: () => void): void {
        if (this.batchMode) {
            this.batchQueue.push(operation);
        } else {
            operation();
        }
    }

    cacheNode(node: Node): void {
        this.queueOrExecute(() => {
            if (this.nodeCache.size >= this.maxSize) {
                this.evictOldest(this.nodeCache);
            }

            this.nodeCache.set(node.id, { node, timestamp: Date.now() });
            this.indexNode(node);
            this.updateCompoundIndexes(node);
            this.updateRangeIndexes(node);
            this.updatePrefixIndexes(node);
            logger.debug('Cached node', { id: node.id, type: node.type });
        });
    }

    getNode(id: string): Node | null {
        const cached = this.nodeCache.get(id);
        if (!cached) return null;

        if (Date.now() - cached.timestamp > this.ttl) {
            this.nodeCache.delete(id);
            this.removeNodeFromIndexes(cached.node);
            return null;
        }

        return cached.node;
    }

    removeNode(id: string): void {
        const cached = this.nodeCache.get(id);
        if (cached) {
            this.nodeCache.delete(id);
            this.removeNodeFromIndexes(cached.node);
        }
    }

    removeRelationship(from: string, to: string, type: string): void {
        const relId = this.getRelationshipId({ from, to, type } as Relationship);
        const cached = this.relationshipCache.get(relId);

        if (cached) {
            this.relationshipCache.delete(relId);
            this.removeRelationshipFromIndexes(cached.relationship);

            // Remove from adjacency lists
            this.adjacencyLists.get(from)?.get(type)?.delete(to);
            this.reverseAdjacencyLists.get(to)?.get(type)?.delete(from);

            logger.debug('Removed relationship from cache', { id: relId });
        }
    }

    cacheRelationship(relationship: Relationship): void {
        this.queueOrExecute(() => {
            if (this.relationshipCache.size >= this.maxSize) {
                this.evictOldest(this.relationshipCache);
            }

            const relId = this.getRelationshipId(relationship);
            this.relationshipCache.set(relId, { relationship, timestamp: Date.now() });
            this.indexRelationship(relationship);
            
            // Update adjacency lists
            if (!this.adjacencyLists.has(relationship.from)) {
                this.adjacencyLists.set(relationship.from, new Map());
            }
            if (!this.adjacencyLists.get(relationship.from)!.has(relationship.type)) {
                this.adjacencyLists.get(relationship.from)!.set(relationship.type, new Set());
            }
            this.adjacencyLists.get(relationship.from)!.get(relationship.type)!.add(relationship.to);

            // Update reverse adjacency lists
            if (!this.reverseAdjacencyLists.has(relationship.to)) {
                this.reverseAdjacencyLists.set(relationship.to, new Map());
            }
            if (!this.reverseAdjacencyLists.get(relationship.to)!.has(relationship.type)) {
                this.reverseAdjacencyLists.get(relationship.to)!.set(relationship.type, new Set());
            }
            this.reverseAdjacencyLists.get(relationship.to)!.get(relationship.type)!.add(relationship.from);
            
            logger.debug('Cached relationship and updated adjacency lists', { 
                id: relId, 
                type: relationship.type,
                from: relationship.from,
                to: relationship.to
            });
        });
    }

    getRelationship(from: string, to: string, type: string): Relationship | null {
        const relId = this.getRelationshipId({ from, to, type } as Relationship);
        const cached = this.relationshipCache.get(relId);
        if (!cached) return null;

        if (Date.now() - cached.timestamp > this.ttl) {
            this.relationshipCache.delete(relId);
            this.removeRelationshipFromIndexes(cached.relationship);
            return null;
        }

        return cached.relationship;
    }

    // Add new method for traversal caching
    cacheTraversalResult(sourceId: string, type: string, direction: "IN" | "OUT" | undefined, targetIds: string[]): void {
        const cacheKey = this.getTraversalCacheKey(sourceId, type, direction);
        this.traversalCache.set(cacheKey, {
            nodeIds: new Set(targetIds),
            timestamp: Date.now()
        });
        logger.debug('Cached traversal result', { sourceId, type, direction, targetCount: targetIds.length });
    }

    getTraversalResult(sourceId: string, type: string, direction: "IN" | "OUT" | undefined): Set<string> | null {
        const cacheKey = this.getTraversalCacheKey(sourceId, type, direction);
        const cached = this.traversalCache.get(cacheKey);

        if (!cached) {
            // Try to build from adjacency lists
            const result = new Set<string>();
            
            if (!direction || direction === "OUT") {
                const outgoing = this.adjacencyLists.get(sourceId)?.get(type);
                if (outgoing) {
                    for (const targetId of outgoing) {
                        result.add(targetId);
                    }
                }
            }
            
            if (!direction || direction === "IN") {
                const incoming = this.reverseAdjacencyLists.get(sourceId)?.get(type);
                if (incoming) {
                    for (const sourceId of incoming) {
                        result.add(sourceId);
                    }
                }
            }

            if (result.size > 0) {
                this.traversalCache.set(cacheKey, {
                    nodeIds: result,
                    timestamp: Date.now()
                });
                this.recordTraversalHit(cacheKey);
                return result;
            }

            this.recordTraversalMiss(cacheKey);
            return null;
        }

        if (Date.now() - cached.timestamp > this.ttl) {
            this.traversalCache.delete(cacheKey);
            this.recordTraversalMiss(cacheKey);
            return null;
        }

        this.recordTraversalHit(cacheKey);
        return cached.nodeIds;
    }

    private getTraversalCacheKey(sourceId: string, type: string, direction: "IN" | "OUT" | undefined): string {
        return `${sourceId}:${type}:${direction || 'both'}`;
    }

    private recordTraversalHit(cacheKey: string): void {
        const stats = this.traversalStats.get(cacheKey) || { hits: 0, misses: 0, avgResponseTime: 0 };
        stats.hits++;
        this.traversalStats.set(cacheKey, stats);
    }

    private recordTraversalMiss(cacheKey: string): void {
        const stats = this.traversalStats.get(cacheKey) || { hits: 0, misses: 0, avgResponseTime: 0 };
        stats.misses++;
        this.traversalStats.set(cacheKey, stats);
    }

    recordTraversalResponseTime(cacheKey: string, responseTime: number): void {
        const stats = this.traversalStats.get(cacheKey) || { hits: 0, misses: 0, avgResponseTime: 0 };
        const totalResponses = stats.hits + stats.misses;
        stats.avgResponseTime = (stats.avgResponseTime * totalResponses + responseTime) / (totalResponses + 1);
        this.traversalStats.set(cacheKey, stats);
    }

    getTraversalStats(): Map<string, { hits: number; misses: number; avgResponseTime: number }> {
        return new Map(this.traversalStats);
    }

    // Index operations
    private indexNode(node: Node): void {
        // Add to type index
        if (!this.typeIndex.has(node.type)) {
            this.typeIndex.set(node.type, new Set());
        }
        this.typeIndex.get(node.type)!.add(node.id);

        // Add to property indexes
        if (node.properties && typeof node.properties === 'object') {
            for (const [key, value] of Object.entries(node.properties)) {
                const indexKey = `${node.type}:${key}`;
                if (!this.propertyIndexes.has(indexKey)) {
                    this.propertyIndexes.set(indexKey, new Map());
                }
                const propertyIndex = this.propertyIndexes.get(indexKey)!;
                
                // Handle different property types
                const valueString = JSON.stringify(value);
                if (!propertyIndex.has(valueString)) {
                    propertyIndex.set(valueString, new Set());
                }
                propertyIndex.get(valueString)!.add(node.id);
            }
        }
    }

    private indexRelationship(relationship: Relationship): void {
        if (!this.relationshipTypeIndex.has(relationship.type)) {
            this.relationshipTypeIndex.set(relationship.type, new Set());
        }
        const relId = this.getRelationshipId(relationship);
        this.relationshipTypeIndex.get(relationship.type)!.add(relId);
    }

    private updateCompoundIndexes(node: Node): void {
        for (const [indexKey, valueMap] of this.compoundIndexes.entries()) {
            const [type, ...properties] = indexKey.split(':');
            if (node.type === type) {
                const values = properties.map(p => node.properties[p]);
                const valueKey = JSON.stringify(values);
                if (!valueMap.has(valueKey)) {
                    valueMap.set(valueKey, new Set());
                }
                valueMap.get(valueKey)!.add(node.id);
            }
        }
    }

    private updateRangeIndexes(node: Node): void {
        for (const [indexKey, ranges] of this.rangeIndexes.entries()) {
            const [type, property] = indexKey.split(':');
            if (node.type === type && typeof node.properties[property] === 'number') {
                const value = node.properties[property] as number;
                let added = false;
                
                // Find or create appropriate range
                for (const range of ranges) {
                    if (value >= range.min && value <= range.max) {
                        range.nodeIds.add(node.id);
                        added = true;
                        break;
                    }
                }
                
                if (!added) {
                    // Create new range if needed
                    const rangeSize = this.calculateRangeSize(indexKey);
                    const min = Math.floor(value / rangeSize) * rangeSize;
                    ranges.push({
                        min,
                        max: min + rangeSize,
                        nodeIds: new Set([node.id])
                    });
                }
            }
        }
    }

    private updatePrefixIndexes(node: Node): void {
        if (!node.properties || typeof node.properties !== 'object') return;
        
        for (const [key, value] of Object.entries(node.properties)) {
            if (typeof value === 'string') {
                const indexKey = `${node.type}:${key}`;
                if (!this.prefixIndexes.has(indexKey)) {
                    this.prefixIndexes.set(indexKey, new Map());
                }
                
                const prefixIndex = this.prefixIndexes.get(indexKey)!;
                for (let i = 1; i <= value.length; i++) {
                    const prefix = value.substring(0, i);
                    if (!prefixIndex.has(prefix)) {
                        prefixIndex.set(prefix, new Set());
                    }
                    prefixIndex.get(prefix)!.add(node.id);
                }
            }
        }
    }

    // Query methods using indexes
    queryNodesByType(type: string): Set<string> {
        return this.typeIndex.get(type) || new Set();
    }

    queryNodesByProperty(type: string, property: string, value: any): Set<string> {
        const indexKey = `${type}:${property}`;
        const propertyIndex = this.propertyIndexes.get(indexKey);
        if (!propertyIndex) return new Set();

        const valueString = JSON.stringify(value);
        return propertyIndex.get(valueString) || new Set();
    }

    queryRelationshipsByType(type: string): Set<string> {
        return this.relationshipTypeIndex.get(type) || new Set();
    }

    queryByCompoundIndex(type: string, properties: string[], values: any[]): Set<string> {
        const indexKey = this.getCompoundIndexKey(type, properties);
        this.recordIndexAccess(indexKey);
        
        const valueMap = this.compoundIndexes.get(indexKey);
        if (!valueMap) return new Set();
        
        const valueKey = JSON.stringify(values);
        return valueMap.get(valueKey) || new Set();
    }

    queryByRange(type: string, property: string, min?: number, max?: number): Set<string> {
        const indexKey = `${type}:${property}`;
        this.recordIndexAccess(indexKey);
        
        const ranges = this.rangeIndexes.get(indexKey);
        if (!ranges) return new Set();
        
        const result = new Set<string>();
        for (const range of ranges) {
            if ((!min || range.max >= min) && (!max || range.min <= max)) {
                for (const nodeId of range.nodeIds) {
                    result.add(nodeId);
                }
            }
        }
        return result;
    }

    queryByPrefix(type: string, property: string, prefix: string): Set<string> {
        const indexKey = `${type}:${property}`;
        this.recordIndexAccess(indexKey);
        
        const prefixIndex = this.prefixIndexes.get(indexKey);
        if (!prefixIndex) return new Set();
        
        return prefixIndex.get(prefix) || new Set();
    }

    private getCompoundIndexKey(type: string, properties: string[]): string {
        return `${type}:${properties.join(':')}`;
    }

    private calculateRangeSize(indexKey: string): number {
        // Dynamic range size based on data distribution
        const ranges = this.rangeIndexes.get(indexKey) || [];
        if (ranges.length === 0) return 100; // Default range size
        
        // Calculate average range size based on existing ranges
        const total = ranges.reduce((sum, range) => sum + (range.max - range.min), 0);
        return Math.max(1, Math.floor(total / ranges.length));
    }

    private recordIndexAccess(indexKey: string): void {
        if (!this.indexStats.has(indexKey)) {
            this.indexStats.set(indexKey, { hits: 0, misses: 0 });
        }
        this.indexStats.get(indexKey)!.hits++;
    }

    getIndexStats(): Map<string, { hits: number; misses: number }> {
        return new Map(this.indexStats);
    }

    // Public methods to access indexes
    public getTypeIndex(): Map<string, Set<string>> {
        return this.typeIndex;
    }

    public getPropertyIndexes(): Map<string, Map<string, Set<string>>> {
        return this.propertyIndexes;
    }

    public getRelationshipTypeIndex(): Map<string, Set<string>> {
        return this.relationshipTypeIndex;
    }

    // Helper methods
    private evictOldest<T>(cache: Map<string, { timestamp: number } & T>): void {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;

        for (const [key, value] of cache.entries()) {
            if (value.timestamp < oldestTime) {
                oldestTime = value.timestamp;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            cache.delete(oldestKey);
        }
    }

    private getRelationshipId(relationship: Relationship): string {
        return `${relationship.from}:${relationship.to}:${relationship.type}`;
    }

    private removeNodeFromIndexes(node: Node): void {
        // Remove from type index
        this.typeIndex.get(node.type)?.delete(node.id);

        // Remove from property indexes
        for (const [key] of Object.entries(node.properties)) {
            const indexKey = `${node.type}:${key}`;
            const propertyIndex = this.propertyIndexes.get(indexKey);
            if (propertyIndex) {
                for (const nodeSet of propertyIndex.values()) {
                    nodeSet.delete(node.id);
                }
            }
        }
    }

    private removeRelationshipFromIndexes(relationship: Relationship): void {
        const relId = this.getRelationshipId(relationship);
        this.relationshipTypeIndex.get(relationship.type)?.delete(relId);
    }

    clear(): void {
        this.nodeCache.clear();
        this.relationshipCache.clear();
        this.propertyIndexes.clear();
        this.typeIndex.clear();
        this.relationshipTypeIndex.clear();
        this.traversalCache.clear(); // Clear traversal cache as well
        this.adjacencyLists.clear();
        this.reverseAdjacencyLists.clear();
    }

    private async persistDatabaseCache(): Promise<void> {
        if (!this.dbCacheConfig.enabled) return;

        try {
            // Save indexes
            const indexData = {
                typeIndex: this.serializeIndex(this.typeIndex),
                propertyIndexes: this.serializePropertyIndexes(),
                relationshipTypeIndex: this.serializeIndex(this.relationshipTypeIndex),
                adjacencyLists: this.serializeAdjacencyLists(),
                reverseAdjacencyLists: this.serializeReverseAdjacencyLists(),
                timestamp: Date.now()
            };

            await fs.writeFile(
                path.join(this.dbCacheConfig.directory, 'indexes.cache.json'),
                JSON.stringify(indexData),
                'utf-8'
            );

            // Save frequently accessed nodes
            const nodeStats = this.getIndexStats();
            const frequentNodes = Array.from(nodeStats.entries())
                .filter(([_, stats]) => stats.hits > 5)
                .map(([key]) => key);

            const nodeCacheData = {
                nodes: frequentNodes.map(id => this.getNode(id)).filter(Boolean),
                timestamp: Date.now()
            };

            await fs.writeFile(
                path.join(this.dbCacheConfig.directory, 'nodes.cache.json'),
                JSON.stringify(nodeCacheData),
                'utf-8'
            );

            // Save traversal cache results
            const traversalCacheData = {
                paths: Array.from(this.traversalCache.entries()).map(([key, value]) => ({
                    key,
                    nodeIds: Array.from(value.nodeIds),
                    timestamp: value.timestamp,
                    accessCount: (this.indexStats.get(key)?.hits || 0)
                })).filter(entry => this.indexStats.get(entry.key)?.hits || 0 > 2), // Only cache frequently accessed paths
                timestamp: Date.now()
            };

            await fs.writeFile(
                path.join(this.dbCacheConfig.directory, 'traversal.cache.json'),
                JSON.stringify(traversalCacheData),
                'utf-8'
            );

            logger.debug('Database cache persisted successfully', {
                indexCount: Object.keys(indexData.typeIndex).length,
                nodeCount: nodeCacheData.nodes.length,
                traversalPathCount: traversalCacheData.paths.length
            });
        } catch (error) {
            logger.error('Failed to persist database cache', { error });
        }
    }

    private restoreCacheData(data: any, filename: string): void {
        try {
            if (filename === 'indexes.cache.json') {
                this.restoreIndexes(data);
            } else if (filename === 'nodes.cache.json') {
                this.restoreNodes(data);
            } else if (filename === 'traversal.cache.json') {
                this.restoreTraversalCache(data);
            }
        } catch (error) {
            logger.error('Error restoring cache data', { filename, error });
        }
    }

    private restoreTraversalCache(data: any): void {
        if (!data.paths) return;

        for (const path of data.paths) {
            this.traversalCache.set(path.key, {
                nodeIds: new Set(path.nodeIds),
                timestamp: path.timestamp
            });
            // Restore access stats
            if (path.accessCount) {
                this.indexStats.set(path.key, {
                    hits: path.accessCount,
                    misses: 0
                });
            }
        }
        logger.debug('Restored traversal cache', { pathCount: data.paths.length });
    }

    private restoreIndexes(data: any): void {
        if (!data.typeIndex || !data.propertyIndexes || !data.relationshipTypeIndex) return;

        // Restore type index
        for (const [type, nodeIds] of Object.entries(data.typeIndex)) {
            this.typeIndex.set(type, new Set(nodeIds as string[]));
        }

        // Restore property indexes
        for (const [indexKey, valueMap] of Object.entries(data.propertyIndexes)) {
            const propertyIndex = new Map<string, Set<string>>();
            for (const [valueKey, nodeIds] of Object.entries(valueMap as Record<string, string[]>)) {
                propertyIndex.set(valueKey, new Set(nodeIds));
            }
            this.propertyIndexes.set(indexKey, propertyIndex);
        }

        // Restore relationship type index
        for (const [type, relIds] of Object.entries(data.relationshipTypeIndex)) {
            this.relationshipTypeIndex.set(type, new Set(relIds as string[]));
        }

        // Restore adjacency lists
        if (data.adjacencyLists) {
            for (const [nodeId, typeMap] of Object.entries(data.adjacencyLists)) {
                const nodeAdjList = new Map();
                for (const [type, targetIds] of Object.entries(typeMap as Record<string, string[]>)) {
                    nodeAdjList.set(type, new Set(targetIds));
                }
                this.adjacencyLists.set(nodeId, nodeAdjList);
            }
        }

        // Restore reverse adjacency lists
        if (data.reverseAdjacencyLists) {
            for (const [nodeId, typeMap] of Object.entries(data.reverseAdjacencyLists)) {
                const nodeAdjList = new Map();
                for (const [type, sourceIds] of Object.entries(typeMap as Record<string, string[]>)) {
                    nodeAdjList.set(type, new Set(sourceIds));
                }
                this.reverseAdjacencyLists.set(nodeId, nodeAdjList);
            }
        }

        logger.debug('Restored indexes and adjacency lists from cache', {
            typeCount: Object.keys(data.typeIndex).length,
            propertyIndexCount: Object.keys(data.propertyIndexes).length,
            relationshipTypeCount: Object.keys(data.relationshipTypeIndex).length,
            adjacencyListCount: Object.keys(data.adjacencyLists || {}).length,
            reverseAdjacencyListCount: Object.keys(data.reverseAdjacencyLists || {}).length
        });
    }

    private restoreNodes(data: any): void {
        if (!data.nodes) return;

        for (const node of data.nodes) {
            this.cacheNode(node);
        }
        logger.debug('Restored nodes from cache', { nodeCount: data.nodes.length });
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
        for (const [key, valueMap] of this.propertyIndexes.entries()) {
            serialized[key] = {};
            for (const [valueKey, nodeIds] of valueMap.entries()) {
                serialized[key][valueKey] = Array.from(nodeIds);
            }
        }
        return serialized;
    }

    private serializeAdjacencyLists(): Record<string, Record<string, string[]>> {
        const serialized: Record<string, Record<string, string[]>> = {};
        for (const [nodeId, typeMap] of this.adjacencyLists.entries()) {
            serialized[nodeId] = {};
            for (const [type, targetIds] of typeMap.entries()) {
                serialized[nodeId][type] = Array.from(targetIds);
            }
        }
        return serialized;
    }

    private serializeReverseAdjacencyLists(): Record<string, Record<string, string[]>> {
        const serialized: Record<string, Record<string, string[]>> = {};
        for (const [nodeId, typeMap] of this.reverseAdjacencyLists.entries()) {
            serialized[nodeId] = {};
            for (const [type, sourceIds] of typeMap.entries()) {
                serialized[nodeId][type] = Array.from(sourceIds);
            }
        }
        return serialized;
    }
}