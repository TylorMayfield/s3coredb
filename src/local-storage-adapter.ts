import { Node, AuthContext, StorageAdapter, Relationship, QueryOptions, QueryResult } from "./types";
import { logger } from './logger';
import { BaseStorageAdapter } from "./base-storage-adapter";

class LocalStorageAdapter extends BaseStorageAdapter implements StorageAdapter {
    private storage: Map<string, Map<string, Node>> = new Map(); // type -> (id -> Node)
    private relationships: Map<string, Map<string, Relationship[]>> = new Map(); // type -> (fromTo -> relationships[])

    async createNode(node: Node, auth: AuthContext): Promise<Node> {
        logger.info(`Creating node with id: ${node.id} of type: ${node.type}`);
        if (!this.storage.has(node.type)) {
            this.storage.set(node.type, new Map());
        }
        this.storage.get(node.type)!.set(node.id, node);
        return node;
    }

    async getNode(id: string, auth: AuthContext): Promise<Node | null> {
        logger.info(`Fetching node with id: ${id}`);
        // Search through all type maps for the node
        for (const typeMap of this.storage.values()) {
            const node = typeMap.get(id);
            if (node && this.canAccessNode(node, auth)) {
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

    async createRelationship(relationship: Relationship, auth: AuthContext): Promise<void> {
        logger.info(`Creating relationship from ${relationship.from} to ${relationship.to} of type ${relationship.type}`);
        const { from, to, type } = relationship;
        const fromNode = await this.getNode(from, auth);
        const toNode = await this.getNode(to, auth);

        if (!fromNode || !toNode) {
            logger.error("One or both nodes in the relationship do not exist.");
            throw new Error("One or both nodes in the relationship do not exist.");
        }

        if (!this.canAccessNode(fromNode, auth) || !this.canAccessNode(toNode, auth)) {
            logger.error("Permission denied: Insufficient permissions to create relationship");
            throw new Error("Permission denied: Insufficient permissions to create relationship");
        }

        if (!this.relationships.has(type)) {
            this.relationships.set(type, new Map());
        }

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
        options?: { direction?: "IN" | "OUT" }
    ): Promise<Node[]> {
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

    async queryNodesAdvanced(options: QueryOptions, auth: AuthContext): Promise<QueryResult> {
        const allNodes = await this.queryNodes({}, auth);
        
        // Filter nodes based on query criteria
        const filteredNodes = allNodes.filter(node => {
            if (options.filter) {
                if (options.filter.field === 'type' && options.filter.value !== node.type) {
                    return false;
                }
                // Add more filter conditions as needed
            }
            return true;
        });

        // Apply sorting if specified
        if (options.sort?.length) {
            filteredNodes.sort((a, b) => {
                for (const sort of options.sort!) {
                    const aVal = a.properties[sort.field];
                    const bVal = b.properties[sort.field];
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
        const start = options.pagination?.offset || 0;
        const end = options.pagination ? start + options.pagination.limit : undefined;
        const paginatedNodes = filteredNodes.slice(start, end);

        return {
            items: paginatedNodes,
            total: filteredNodes.length,
            hasMore: end ? end < filteredNodes.length : false
        };
    }
}

export { LocalStorageAdapter };
