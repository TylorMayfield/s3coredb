import { Node, AuthContext, StorageAdapter, Relationship, QueryOptions, QueryResult } from "./types";
import { logger } from './logger';
import { BaseStorageAdapter } from "./base-storage-adapter";

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

    async getNodeTypeFromId(id: string): Promise<string | null> {
        logger.info(`Fetching node type for id: ${id}`);
        const node = await this.getNode(id, { userPermissions: ['read'], isAdmin: true });
        return node ? node.type : null;
    }

    async queryNodes(query: any, auth: AuthContext): Promise<Node[]> {
        logger.info(`Querying nodes with query: ${JSON.stringify(query)}`);
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
        return results;
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

    async queryRelatedNodes(
        from: string,
        type: string,
        auth: AuthContext,
        options?: { direction?: "IN" | "OUT"; skipCache?: boolean }
    ): Promise<Node[]> {
        if (!options?.skipCache) {
            return this.queryRelatedNodesWithCache(from, type, auth, options);
        }

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

        return relatedNodes;
    }

    private convertFilterToQuery(filter?: QueryOptions['filter']): any {
        if (!filter) return {};
        
        const query: any = {};
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
