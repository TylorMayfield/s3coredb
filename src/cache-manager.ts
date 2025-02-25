import { Node, Relationship, CompoundIndexConfig, RangeIndexConfig } from './types';
import { logger } from './logger';

interface RangeEntry {
    min: number;
    max: number;
    nodeIds: Set<string>;
}

export class CacheManager {
    private nodeCache: Map<string, { node: Node; timestamp: number }> = new Map();
    private relationshipCache: Map<string, { relationship: Relationship; timestamp: number }> = new Map();
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

    constructor(options: { ttl?: number; maxSize?: number; indexes?: { compound?: CompoundIndexConfig[]; range?: RangeIndexConfig[] } } = {}) {
        this.ttl = options.ttl || 5 * 60 * 1000; // 5 minutes default TTL
        this.maxSize = options.maxSize || 10000; // Max 10000 entries default
        
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

    cacheRelationship(relationship: Relationship): void {
        if (this.relationshipCache.size >= this.maxSize) {
            this.evictOldest(this.relationshipCache);
        }

        const relId = this.getRelationshipId(relationship);
        this.relationshipCache.set(relId, { relationship, timestamp: Date.now() });
        this.indexRelationship(relationship);
        logger.debug('Cached relationship', { id: relId, type: relationship.type });
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

    // Index operations
    private indexNode(node: Node): void {
        // Add to type index
        if (!this.typeIndex.has(node.type)) {
            this.typeIndex.set(node.type, new Set());
        }
        this.typeIndex.get(node.type)!.add(node.id);

        // Add to property indexes
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
    }
}