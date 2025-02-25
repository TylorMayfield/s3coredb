import { Node, AuthContext, StorageAdapter, Relationship, S3CoreDBConfig, QueryOptions, QueryResult } from "./types";
import { BaseStorageAdapter } from "./base-storage-adapter";
import { S3NodeOperations } from "./s3-node-operations";
import { S3RelationshipOperations } from "./s3-relationship-operations";
import { logger } from './logger';

export class S3StorageAdapter extends BaseStorageAdapter implements StorageAdapter {
    private nodeOperations: S3NodeOperations;
    private relationshipOperations: S3RelationshipOperations;

    constructor(config: S3CoreDBConfig) {
        super();
        this.nodeOperations = new S3NodeOperations(config);
        this.relationshipOperations = new S3RelationshipOperations(config);
        logger.info('S3StorageAdapter initialized', { 
            endpoint: config.endpoint, 
            bucket: config.bucket 
        });
    }

    async createNode(node: Node, auth: AuthContext): Promise<Node> {
        this.validateNode(node);
        return this.nodeOperations.createNode(node, auth);
    }

    async getNode(id: string, auth: AuthContext): Promise<Node | null> {
        return this.nodeOperations.getNode(id, auth);
    }

    async getNodeTypeFromId(id: string): Promise<string | null> {
        return this.nodeOperations.getNodeTypeFromId(id);
    }

    async queryNodes(query: any, auth: AuthContext): Promise<Node[]> {
        return this.nodeOperations.queryNodes(query, auth);
    }

    async queryNodesAdvanced(options: QueryOptions, auth: AuthContext): Promise<QueryResult> {
        // Get all nodes first using existing query functionality
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
        const start = options.pagination?.offset || 0;
        const end = options.pagination ? start + options.pagination.limit : undefined;
        const paginatedNodes = filteredNodes.slice(start, end);

        return {
            items: paginatedNodes,
            total: filteredNodes.length,
            hasMore: end ? end < filteredNodes.length : false,
            aggregations
        };
    }

    private matchesFilterCondition(node: Node, filter: any): boolean {
        if (!filter || !filter.field) {
            // Handle nested filter groups
            if (filter.logic && filter.filters) {
                if (filter.logic === 'and') {
                    return filter.filters.every((f: any) => this.matchesFilterCondition(node, f));
                } else if (filter.logic === 'or') {
                    return filter.filters.some((f: any) => this.matchesFilterCondition(node, f));
                }
            }
            return false;
        }

        const value = this.getNestedValue(node, filter.field);
        if (value == null) return false;

        switch (filter.operator) {
            case 'eq':
                return value === filter.value;
            case 'gt':
                return typeof value === 'number' && value > filter.value;
            case 'lt':
                return typeof value === 'number' && value < filter.value;
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
        return this.relationshipOperations.createRelationship(relationship, auth);
    }

    async queryRelatedNodes(
        from: string,
        type: string,
        auth: AuthContext,
        options?: { direction?: "IN" | "OUT" }
    ): Promise<Node[]> {
        return this.relationshipOperations.queryRelatedNodes(from, type, auth, options);
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