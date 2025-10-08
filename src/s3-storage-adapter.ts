import { Node, AuthContext, StorageAdapter, Relationship, S3CoreDBConfig, QueryOptions, QueryResult } from "./types";
import { BaseStorageAdapter } from "./base-storage-adapter";
import { S3NodeOperations } from "./s3-node-operations";
import { S3RelationshipOperations } from "./s3-relationship-operations";
import { logger } from './logger';
import { NodeNotFoundError, PermissionDeniedError, ConcurrentModificationError } from './errors';
import { validateQueryLimit } from './validator';

export class S3StorageAdapter extends BaseStorageAdapter implements StorageAdapter {
    private nodeOperations: S3NodeOperations;
    private relationshipOperations: S3RelationshipOperations;
    private config: S3CoreDBConfig;

    constructor(config: S3CoreDBConfig, numShards: number = 256, shardLevels: number = 2) {
        super(undefined, numShards, shardLevels);
        this.config = config;
        this.nodeOperations = new S3NodeOperations(config);
        this.relationshipOperations = new S3RelationshipOperations(config);
        logger.info('S3StorageAdapter initialized', { 
            endpoint: config.endpoint, 
            bucket: config.bucket 
        });
    }

    async createNode(node: Node, auth: AuthContext): Promise<Node> {
        this.validateNode(node);
        const shardPath = this.getShardPathForType(node.type, node.id);
        return this.nodeOperations.createNode(node, auth, shardPath);
    }

    async getNode(id: string, auth: AuthContext): Promise<Node | null> {
        // Try cache first
        const cachedNode = await this.getCachedNode(id, auth);
        if (cachedNode) {
            return cachedNode;
        }
        
        const node = await this.nodeOperations.getNode(id, auth);
        if (node && this.canAccessNode(node, auth)) {
            this.cache.cacheNode(node);
            return node;
        }
        return null;
    }

    async updateNode(id: string, updates: Partial<Node>, auth: AuthContext): Promise<Node> {
        this.validateNodeForUpdate(updates);

        const node = await this.getNode(id, auth);
        if (!node) {
            throw new NodeNotFoundError(id);
        }

        if (!this.canAccessNode(node, auth)) {
            throw new PermissionDeniedError(node.permissions, auth.userPermissions, `node ${id}`);
        }

        if (updates.version !== undefined && node.version !== updates.version) {
            throw new ConcurrentModificationError(id, updates.version, node.version || 1);
        }

        const updatedNode: Node = {
            ...node,
            ...updates,
            id: node.id,
            type: node.type,
            version: (node.version || 1) + 1
        };

        this.validateNode(updatedNode);

        // Delete old node and create updated one
        await this.nodeOperations.deleteNode(node);
        const shardPath = this.getShardPathForType(updatedNode.type, updatedNode.id);
        await this.nodeOperations.createNode(updatedNode, auth, shardPath);

        this.cache.cacheNode(updatedNode);
        return updatedNode;
    }

    async deleteNode(id: string, auth: AuthContext): Promise<void> {
        const node = await this.getNode(id, auth);
        if (!node) {
            throw new NodeNotFoundError(id);
        }

        if (!this.canAccessNode(node, auth)) {
            throw new PermissionDeniedError(node.permissions, auth.userPermissions, `node ${id}`);
        }

        await this.nodeOperations.deleteNode(node);
    }

    async getNodeTypeFromId(id: string): Promise<string | null> {
        return this.nodeOperations.getNodeTypeFromId(id);
    }

    async queryNodes(query: any, auth: AuthContext, options?: { limit?: number; offset?: number }): Promise<Node[]> {
        const limit = validateQueryLimit(options?.limit);
        const offset = options?.offset || 0;
        const nodes = await this.nodeOperations.queryNodes(query);
        const filtered = nodes.filter(node => this.canAccessNode(node, auth));
        return filtered.slice(offset, offset + limit);
    }

    async queryNodesAdvanced(options: QueryOptions, auth: AuthContext): Promise<QueryResult> {
        const allNodes = await this.queryNodes({}, auth);
        let filteredNodes = [...allNodes];

        // Apply filters
        if (options.filter) {
            filteredNodes = filteredNodes.filter(node => {
                const filter = options.filter!;
                if ('logic' in filter && filter.filters) {
                    if (filter.logic === 'and') {
                        return filter.filters.every((f: any) => this.matchesFilterCondition(node, f));
                    } else if (filter.logic === 'or') {
                        return filter.filters.some((f: any) => this.matchesFilterCondition(node, f));
                    }
                }
                return this.matchesFilterCondition(node, filter);
            });
        }

        // Apply sorting
        if (options.sort?.length) {
            filteredNodes.sort((a, b) => {
                for (const { field, direction } of options.sort!) {
                    const aVal = this.getNestedValue(a, field);
                    const bVal = this.getNestedValue(b, field);
                    if (aVal !== bVal) {
                        return direction === 'asc' ? 
                            (aVal < bVal ? -1 : 1) : 
                            (aVal < bVal ? 1 : -1);
                    }
                }
                return 0;
            });
        }

        // Calculate aggregations if requested
        let aggregations: Record<string, any> | undefined;
        if (options.aggregations?.length) {
            aggregations = {};
            for (const agg of options.aggregations) {
                if (!agg.alias) continue;
                const values = filteredNodes.map(node => this.getNestedValue(node, agg.field)).filter(val => val != null);
                if (values.length === 0) continue;

                switch (agg.operator) {
                    case 'avg':
                        if (values.every(v => typeof v === 'number')) {
                            aggregations[agg.alias] = values.reduce((sum, val) => sum + (val as number), 0) / values.length;
                        }
                        break;
                    case 'sum':
                        if (values.every(v => typeof v === 'number')) {
                            aggregations[agg.alias] = values.reduce((sum, val) => sum + (val as number), 0);
                        }
                        break;
                    case 'min':
                        if (values.every(v => typeof v === 'number')) {
                            aggregations[agg.alias] = Math.min(...values as number[]);
                        }
                        break;
                    case 'max':
                        if (values.every(v => typeof v === 'number')) {
                            aggregations[agg.alias] = Math.max(...values as number[]);
                        }
                        break;
                    case 'count':
                        aggregations[agg.alias] = values.length;
                        break;
                }
            }
        }

        // Apply pagination
        const total = filteredNodes.length;
        if (options.pagination) {
            const { offset = 0, limit = 10 } = options.pagination;
            filteredNodes = filteredNodes.slice(offset, offset + limit);
        }

        return {
            items: filteredNodes,
            total,
            hasMore: options.pagination ? 
                (options.pagination.offset || 0) + filteredNodes.length < total : false,
            aggregations
        };
    }

    private matchesFilterCondition(node: Node, filter: any): boolean {
        if (!filter.field) return true;
        const value = this.getNestedValue(node, filter.field);
        if (value === undefined) return false;

        switch (filter.operator) {
            case 'eq':
                return value === filter.value;
            case 'gt':
                return typeof value === 'number' && value > filter.value;
            case 'lt':
                return typeof value === 'number' && value < filter.value;
            case 'gte':
                return typeof value === 'number' && value >= filter.value;
            case 'lte':
                return typeof value === 'number' && value <= filter.value;
            case 'contains':
                if (Array.isArray(value)) {
                    return value.includes(filter.value);
                }
                return typeof value === 'string' && value.includes(filter.value);
            default:
                return false;
        }
    }

    async createRelationship(relationship: Relationship, auth: AuthContext): Promise<void> {
        this.validateRelationship(relationship);
        const shardPath = this.getShardPathForRelationship(
            relationship.type,
            relationship.from,
            relationship.to
        );
        return this.relationshipOperations.createRelationship(relationship, auth, shardPath);
    }

    async updateRelationship(from: string, to: string, type: string, updates: Partial<Relationship>, auth: AuthContext): Promise<void> {
        this.validateRelationshipForUpdate(updates);

        // Get existing relationship by deleting and recreating with updates
        // This is a limitation of the S3-based approach
        const relationships = await this.relationshipOperations.listRelationshipsOfType(type);
        const existing = relationships.find(r => r.from === from && r.to === to);

        if (!existing) {
            throw new NodeNotFoundError(`Relationship ${from}->${to} of type ${type}`);
        }

        const updatedRel: Relationship = {
            ...existing,
            ...updates,
            from: existing.from,
            to: existing.to,
            type: existing.type,
            version: (existing.version || 1) + 1
        };

        // Delete and recreate
        await this.relationshipOperations.deleteRelationship(existing);
        const shardPath = this.getShardPathForRelationship(type, from, to);
        await this.relationshipOperations.createRelationship(updatedRel, auth, shardPath);
        
        this.cache.cacheRelationship(updatedRel);
    }

    async deleteRelationship(from: string, to: string, type: string, auth: AuthContext): Promise<void> {
        const relationships = await this.relationshipOperations.listRelationshipsOfType(type);
        const existing = relationships.find(r => r.from === from && r.to === to);

        if (!existing) {
            throw new NodeNotFoundError(`Relationship ${from}->${to} of type ${type}`);
        }

        await this.relationshipOperations.deleteRelationship(existing);
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
        const nodes = await this.relationshipOperations.queryRelatedNodes(from, type, auth, options);
        return nodes.slice(0, limit);
    }

    async cleanup(): Promise<void> {
        try {
            // Clean up nodes
            const nodeTypes = await this.nodeOperations.listNodeTypes();
            for (const type of nodeTypes) {
                const nodes = await this.nodeOperations.listNodesOfType(type);
                for (const node of nodes) {
                    await this.nodeOperations.deleteNode(node);
                }
            }

            // Clean up relationships
            const relationshipTypes = await this.relationshipOperations.listRelationshipTypes();
            for (const type of relationshipTypes) {
                const relationships = await this.relationshipOperations.listRelationshipsOfType(type);
                for (const rel of relationships) {
                    await this.relationshipOperations.deleteRelationship(rel);
                }
            }

            logger.info('Cleaned up all data');
        } catch (error) {
            logger.error('Error during cleanup:', error);
            throw error;
        }
    }
}