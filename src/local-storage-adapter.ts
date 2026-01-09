import { Node, AuthContext, StorageAdapter, Relationship, QueryOptions, QueryResult } from "./types";
import { logger } from './logger';
import { BaseStorageAdapter } from "./base-storage-adapter";
import { NodeNotFoundError, PermissionDeniedError, RelationshipNotFoundError, ConcurrentModificationError } from './errors';
import { validateQueryLimit } from './validator';

class LocalStorageAdapter extends BaseStorageAdapter implements StorageAdapter {
    private storage: Map<string, Map<string, Node>> = new Map(); // type -> (id -> Node)
    private relationships: Map<string, Map<string, Relationship[]>> = new Map(); // type -> (fromTo -> relationships[])

    constructor(numShards: number = 256, shardLevels: number = 2) {
        super(undefined, numShards, shardLevels);
    }

    async createNode(node: Node, auth: AuthContext): Promise<Node> {
        if (!node.id) {
            node.id = require('crypto').randomUUID();
        }
        this.validateNode(node);
        logger.info(`Creating node with id: ${node.id} of type: ${node.type}`);
        
        if (!this.storage.has(node.type)) {
            this.storage.set(node.type, new Map());
        }
        this.storage.get(node.type)!.set(node.id, node);
        return node;
    }

    async getNode(id: string, auth: AuthContext): Promise<Node | null> {
        logger.info(`Fetching node with id: ${id}`);
        // Try cache first
        const cachedNode = await this.getCachedNode(id, auth);
        if (cachedNode) {
            return cachedNode;
        }

        // Search through all type maps for the node
        for (const typeMap of this.storage.values()) {
            const node = typeMap.get(id);
            if (node && this.canAccessNode(node, auth)) {
                this.cache.cacheNode(node);
                return node;
            }
        }
        return null;
    }

    async updateNode(id: string, updates: Partial<Node>, auth: AuthContext): Promise<Node> {
        logger.info(`Updating node with id: ${id}`);
        this.validateNodeForUpdate(updates);

        // Find node directly to distinguish between not found and permission denied
        let node: Node | undefined;
        for (const typeMap of this.storage.values()) {
            if (typeMap.has(id)) {
                node = typeMap.get(id);
                break;
            }
        }

        if (!node) {
            throw new NodeNotFoundError(id);
        }

        if (!this.canAccessNode(node, auth)) {
            throw new PermissionDeniedError(node.permissions, auth.userPermissions, `node ${id}`);
        }

        // Check for concurrent modification if version is provided
        if (updates.version !== undefined && node.version !== updates.version) {
            throw new ConcurrentModificationError(id, updates.version, node.version || 1);
        }

        // Apply updates
        const updatedNode: Node = {
            ...node,
            ...updates,
            id: node.id, // Preserve original ID
            type: node.type, // Preserve original type
            version: (node.version || 1) + 1 // Increment version
        };

        this.validateNode(updatedNode);

        // Update in storage
        if (this.storage.has(node.type)) {
            this.storage.get(node.type)!.set(id, updatedNode);
        }

        this.cache.cacheNode(updatedNode);
        return updatedNode;
    }

    async deleteNode(id: string, auth: AuthContext): Promise<void> {
        logger.info(`Deleting node with id: ${id}`);
        
        // Find node directly to distinguish between not found and permission denied
        let node: Node | undefined;
        for (const typeMap of this.storage.values()) {
            if (typeMap.has(id)) {
                node = typeMap.get(id);
                break;
            }
        }

        if (!node) {
            throw new NodeNotFoundError(id);
        }

        if (!this.canAccessNode(node, auth)) {
            throw new PermissionDeniedError(node.permissions, auth.userPermissions, `node ${id}`);
        }

        // Remove from storage
        if (this.storage.has(node.type)) {
            this.storage.get(node.type)!.delete(id);
        }

        // Clear from cache
        this.cache.removeNode(id);
    }

    async getNodeTypeFromId(id: string): Promise<string | null> {
        logger.info(`Fetching node type for id: ${id}`);
        const node = await this.getNode(id, { userPermissions: ['read'], isAdmin: true });
        return node ? node.type : null;
    }

    async queryNodes(query: any, auth: AuthContext, options?: { limit?: number; offset?: number }): Promise<Node[]> {
        logger.info(`Querying nodes with query: ${JSON.stringify(query)}`);
        const limit = validateQueryLimit(options?.limit);
        const offset = options?.offset || 0;
        const results: Node[] = [];

        // If type is specified, only search in that type's map
        if (query.type && this.storage.has(query.type)) {
            const typeMap = this.storage.get(query.type)!;
            for (const node of typeMap.values()) {
                if (this.matchesQuery(node, query) && this.canAccessNode(node, auth)) {
                    results.push(node);
                }
            }
        } else {
            // Search all types
            for (const typeMap of this.storage.values()) {
                for (const node of typeMap.values()) {
                    if (this.matchesQuery(node, query) && this.canAccessNode(node, auth)) {
                        results.push(node);
                    }
                }
            }
        }
        
        // Apply pagination
        return results.slice(offset, offset + limit);
    }

    async queryNodesAdvanced(options: QueryOptions, auth: AuthContext): Promise<QueryResult> {
        const { filter, sort, pagination } = options;
        let nodes: Node[] = [];

        // Filter nodes based on query criteria
        nodes = await this.queryNodes(this.convertFilterToQuery(filter), auth);

        // Apply sorting
        if (sort?.length) {
            nodes.sort((a, b) => {
                for (const sort of options.sort!) {
                    const aVal = this.getNestedValue(a, sort.field);
                    const bVal = this.getNestedValue(b, sort.field);
                    if (aVal !== bVal) {
                        return sort.direction === 'asc' ? 
                            (aVal < bVal ? -1 : 1) : 
                            (aVal < bVal ? 1 : -1);
                    }
                }
                return 0;
            });
        }

        // Apply pagination
        const total = nodes.length;
        if (pagination) {
            const { offset = 0, limit = 10 } = pagination;
            nodes = nodes.slice(offset, offset + limit);
        }

        return {
            items: nodes,
            total,
            hasMore: pagination ? (pagination.offset || 0) + nodes.length < total : false
        };
    }

    async createRelationship(relationship: Relationship, auth: AuthContext): Promise<void> {
        this.validateRelationship(relationship);
        logger.info(`Creating relationship from ${relationship.from} to ${relationship.to} of type ${relationship.type}`);
        
        const fromNode = await this.getNode(relationship.from, auth);
        const toNode = await this.getNode(relationship.to, auth);

        if (!fromNode || !toNode) {
            throw new Error("One or both nodes in the relationship do not exist");
        }

        if (!this.canAccessNode(fromNode, auth) || !this.canAccessNode(toNode, auth)) {
            throw new Error("Permission denied: Insufficient permissions to create relationship");
        }

        if (!this.relationships.has(relationship.type)) {
            this.relationships.set(relationship.type, new Map());
        }
        
        const { from, to, type } = relationship;
        const typeMap = this.relationships.get(type)!;
        const key = `${from}__${to}`;
        const relationships = Array.isArray(typeMap.get(key)) 
            ? (typeMap.get(key) as Relationship[])
            : [];
        relationships.push(relationship);
        typeMap.set(key, relationships);
    }

    async updateRelationship(from: string, to: string, type: string, updates: Partial<Relationship>, auth: AuthContext): Promise<void> {
        logger.info(`Updating relationship from ${from} to ${to} of type ${type}`);
        this.validateRelationshipForUpdate(updates);

        const fromNode = await this.getNode(from, auth);
        const toNode = await this.getNode(to, auth);

        if (!fromNode || !toNode) {
            throw new NodeNotFoundError(`${from} or ${to}`);
        }

        if (!this.canAccessNode(fromNode, auth) || !this.canAccessNode(toNode, auth)) {
            throw new PermissionDeniedError([], auth.userPermissions, `relationship ${from}->${to}`);
        }

        const typeMap = this.relationships.get(type);
        if (!typeMap) {
            throw new RelationshipNotFoundError(from, to, type);
        }

        const key = `${from}__${to}`;
        const rels = typeMap.get(key);
        if (!rels || rels.length === 0) {
            throw new RelationshipNotFoundError(from, to, type);
        }

        // Update the first matching relationship
        const relationship = rels[0];
        const updatedRel: Relationship = {
            ...relationship,
            ...updates,
            from: relationship.from, // Preserve
            to: relationship.to, // Preserve
            type: relationship.type, // Preserve
            version: (relationship.version || 1) + 1
        };

        rels[0] = updatedRel;
        this.cache.cacheRelationship(updatedRel);
    }

    async deleteRelationship(from: string, to: string, type: string, auth: AuthContext): Promise<void> {
        logger.info(`Deleting relationship from ${from} to ${to} of type ${type}`);

        const fromNode = await this.getNode(from, auth);
        const toNode = await this.getNode(to, auth);

        if (!fromNode || !toNode) {
            throw new NodeNotFoundError(`${from} or ${to}`);
        }

        if (!this.canAccessNode(fromNode, auth) || !this.canAccessNode(toNode, auth)) {
            throw new PermissionDeniedError([], auth.userPermissions, `relationship ${from}->${to}`);
        }

        const typeMap = this.relationships.get(type);
        if (!typeMap) {
            throw new RelationshipNotFoundError(from, to, type);
        }

        const key = `${from}__${to}`;
        const exists = typeMap.has(key);
        if (!exists) {
            throw new RelationshipNotFoundError(from, to, type);
        }

        typeMap.delete(key);
        this.cache.removeRelationship({ from, to, type } as Relationship);
    }

    async queryRelatedNodes(
        from: string,
        type: string,
        auth: AuthContext,
        options?: { direction?: "IN" | "OUT"; skipCache?: boolean; limit?: number }
    ): Promise<Node[]> {
        if (!options?.skipCache) {
            return this.queryRelatedNodesWithCache(from, type, auth, options);
        }

        const limit = validateQueryLimit(options?.limit);

        logger.info(`Querying related nodes from ${from} of type ${type}`);
        const fromNode = await this.getNode(from, auth);
        if (!fromNode || !this.canAccessNode(fromNode, auth)) {
            return [];
        }

        const relatedNodes: Node[] = [];
        const typeMap = this.relationships.get(type);
        if (!typeMap) return [];

        for (const [key, rels] of typeMap.entries()) {
            const [fromId, toId] = key.split('__');
            for (const relationship of rels) {
                if (this.matchesRelationshipQuery(relationship, from, type, options?.direction)) {
                    const targetId = options?.direction === "IN" ? fromId : toId;
                    const node = await this.getNode(targetId, auth);
                    if (node && this.canAccessNode(node, auth)) {
                        relatedNodes.push(node);
                    }
                }
            }
        }

        return relatedNodes.slice(0, limit);
    }

    private convertFilterToQuery(filter?: QueryOptions['filter']): any {
        if (!filter) return {};
        
        const query: any = {};

        // Handle direct field filter
        if (filter.field && filter.operator === 'eq') {
            query[filter.field] = filter.value;
        }

        // Handle nested filters
        if (filter.filters) {
            for (const f of filter.filters) {
                if (f.field && f.operator === 'eq') {
                    query[f.field] = f.value;
                }
            }
        }
        return query;
    }
}

export { LocalStorageAdapter };
