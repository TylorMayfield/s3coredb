import { Node, Relationship, StorageAdapter, AuthContext, QueryOptions, QueryResult } from './types';
import { logger } from './logger';
import { CacheManager } from './cache-manager';

export abstract class BaseStorageAdapter implements StorageAdapter {
    protected cache: CacheManager;

    constructor(cacheOptions?: { ttl?: number; maxSize?: number }) {
        this.cache = new CacheManager(cacheOptions);
    }

    configureCacheOptions(options: { ttl?: number; maxSize?: number }): void {
        this.cache = new CacheManager(options);
    }

    abstract createNode(node: Node, auth: AuthContext): Promise<Node>;
    abstract getNode(id: string, auth: AuthContext): Promise<Node | null>;
    abstract getNodeTypeFromId(id: string): Promise<string | null>;
    abstract queryNodes(query: any, auth: AuthContext): Promise<Node[]>;
    abstract createRelationship(relationship: Relationship, auth: AuthContext): Promise<void>;
    abstract queryRelatedNodes(
        from: string,
        type: string,
        auth: AuthContext,
        options?: { direction?: "IN" | "OUT" }
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
        // First check cache indexes for fast filtering
        if (query.type && !this.cache.queryNodesByType(query.type).has(node.id)) {
            return false;
        }

        // Check property indexes
        for (const [key, value] of Object.entries(query)) {
            if (key === 'type') continue;
            if (key.startsWith('properties.')) {
                const propertyName = key.substring('properties.'.length);
                if (!this.cache.queryNodesByProperty(node.type, propertyName, value).has(node.id)) {
                    return false;
                }
            }
        }

        // Fallback to full property matching for complex queries
        for (const [key, value] of Object.entries(query)) {
            if (key === 'type') {
                if (node.type !== value) return false;
            } else if (key.startsWith('properties.')) {
                const propertyValue = this.getNestedValue(node, key);
                if (Array.isArray(value)) {
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
        if (!node.type || typeof node.type !== 'string') {
            throw new Error('Node must have a valid type string');
        }
        if (!node.permissions || !Array.isArray(node.permissions)) {
            throw new Error('Node must have a permissions array');
        }
        if (!node.properties || typeof node.properties !== 'object') {
            throw new Error('Node must have a properties object');
        }
        // Add node to cache after validation
        this.cache.cacheNode(node);
    }

    protected validateRelationship(relationship: Relationship): void {
        if (!relationship.from || typeof relationship.from !== 'string') {
            throw new Error('Relationship must have a valid from ID');
        }
        if (!relationship.to || typeof relationship.to !== 'string') {
            throw new Error('Relationship must have a valid to ID');
        }
        if (!relationship.type || typeof relationship.type !== 'string') {
            throw new Error('Relationship must have a valid type string');
        }
        // Add relationship to cache after validation
        this.cache.cacheRelationship(relationship);
    }

    protected clearCache(): void {
        this.cache.clear();
    }
}