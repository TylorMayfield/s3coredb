import { Node, Relationship } from './types';
import { logger } from './logger';

export class CacheManager {
    private nodeCache: Map<string, { node: Node; timestamp: number }> = new Map();
    private relationshipCache: Map<string, { relationship: Relationship; timestamp: number }> = new Map();
    private propertyIndexes: Map<string, Map<string, Set<string>>> = new Map(); // type -> property -> nodeIds
    private typeIndex: Map<string, Set<string>> = new Map(); // type -> nodeIds
    private relationshipTypeIndex: Map<string, Set<string>> = new Map(); // type -> relationshipIds
    private ttl: number;
    private maxSize: number;

    constructor(options: { ttl?: number; maxSize?: number } = {}) {
        this.ttl = options.ttl || 5 * 60 * 1000; // 5 minutes default TTL
        this.maxSize = options.maxSize || 10000; // Max 10000 entries default
    }

    cacheNode(node: Node): void {
        if (this.nodeCache.size >= this.maxSize) {
            this.evictOldest(this.nodeCache);
        }

        this.nodeCache.set(node.id, { node, timestamp: Date.now() });
        this.indexNode(node);
        logger.debug('Cached node', { id: node.id, type: node.type });
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