import { Node, Relationship, StorageAdapter, AuthContext, QueryOptions, QueryResult } from './types';
import { S3NodeOperations } from './s3-node-operations';
import { logger } from './logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BaseStorageAdapter } from "./base-storage-adapter";
import { glob } from 'glob';
import { promisify } from 'util';
import { NodeNotFoundError, PermissionDeniedError, RelationshipNotFoundError, ConcurrentModificationError } from './errors';
import { validateQueryLimit } from './validator';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);
const rm = promisify(fs.rm);

class FileSystemStorageAdapter extends BaseStorageAdapter implements StorageAdapter {
    private dataDir: string;
    private nodesDir: string;
    private relationshipsDir: string;
    private initialized: Promise<void>;
    private basePath: string;
    private batchMode = false;

    constructor(baseDir: string = 'db-data', numShards: number = 256, shardLevels: number = 2) {
        super(undefined, numShards, shardLevels);
        this.dataDir = path.resolve(process.cwd(), baseDir);
        this.nodesDir = path.join(this.dataDir, 'nodes');
        this.relationshipsDir = path.join(this.dataDir, 'relationships');
        this.initialized = this.initializeDirectories();
        this.basePath = path.resolve(baseDir);
    }

    private async initializeDirectories() {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
            await fs.mkdir(this.nodesDir, { recursive: true });
            await fs.mkdir(this.relationshipsDir, { recursive: true });
            logger.info(`Initialized data directories at ${this.dataDir}`);
        } catch (error) {
            logger.error('Failed to initialize data directories:', error);
            throw error;
        }
    }

    private getNodePath(node: Node): string {
        const shardPath = this.getShardPathForType(node.type, node.id);
        return path.join(this.nodesDir, shardPath, `${node.id}.json`);
    }

    private async ensureShardDirectory(type: string, id: string, isRelationship: boolean = false): Promise<void> {
        const baseDir = isRelationship ? this.relationshipsDir : this.nodesDir;
        const shardPath = isRelationship 
            ? this.getShardPathForRelationship(type, id, id) // For relationships, id is the combinedId
            : this.getShardPathForType(type, id);
        const fullPath = path.join(baseDir, shardPath);
        await fs.mkdir(fullPath, { recursive: true });
    }

    private getRelationshipPath(relationship: Relationship): string {
        const shardPath = this.getShardPathForRelationship(
            relationship.type,
            relationship.from,
            relationship.to
        );
        return path.join(this.relationshipsDir, shardPath, `${relationship.from}__${relationship.to}.json`);
    }

    startBatch(): void {
        this.batchMode = true;
        this.cache.startBatch();
    }

    async commitBatch(): Promise<void> {
        this.batchMode = false;
        await this.cache.commitBatch();
    }

    async createNode(node: Node, auth: AuthContext): Promise<Node> {
        await this.initialized;
        if (!node.id) {
            node.id = this.generateId();
        }
        this.validateNode(node);
        logger.info(`Creating node with id: ${node.id} of type: ${node.type}`);
        
        await this.ensureShardDirectory(node.type, node.id);
        const filePath = this.getNodePath(node);
        await fs.writeFile(filePath, JSON.stringify(node, null, 2));
        return node;
    }

    async updateNode(id: string, updates: Partial<Node>, auth: AuthContext): Promise<Node> {
        await this.initialized;
        logger.info(`Updating node with id: ${id}`);
        this.validateNodeForUpdate(updates);

        const node = await this.getNode(id, auth);
        if (!node) {
            throw new NodeNotFoundError(id);
        }

        if (!this.canAccessNode(node, auth)) {
            throw new PermissionDeniedError(node.permissions, auth.userPermissions, `node ${id}`);
        }

        // Check for concurrent modification
        if (updates.version !== undefined && node.version !== updates.version) {
            throw new ConcurrentModificationError(id, updates.version, node.version || 1);
        }

        // Apply updates
        const updatedNode: Node = {
            ...node,
            ...updates,
            id: node.id,
            type: node.type,
            version: (node.version || 1) + 1
        };

        this.validateNode(updatedNode);

        // Write to filesystem
        const filePath = this.getNodePath(updatedNode);
        await fs.writeFile(filePath, JSON.stringify(updatedNode, null, 2));

        this.cache.cacheNode(updatedNode);
        return updatedNode;
    }

    async deleteNode(id: string, auth: AuthContext): Promise<void> {
        await this.initialized;
        logger.info(`Deleting node with id: ${id}`);

        const node = await this.getNode(id, auth);
        if (!node) {
            throw new NodeNotFoundError(id);
        }

        if (!this.canAccessNode(node, auth)) {
            throw new PermissionDeniedError(node.permissions, auth.userPermissions, `node ${id}`);
        }

        // Delete from filesystem
        const filePath = this.getNodePath(node);
        await fs.unlink(filePath);
        
        // Clear from cache
        this.cache.removeNode(id);
    }

    async getNode(id: string, auth: AuthContext): Promise<Node | null> {
        await this.initialized;
        logger.info(`Fetching node with id: ${id}`);
        
        // Try cache first
        const cachedNode = await this.getCachedNode(id, auth);
        if (cachedNode) {
            return cachedNode;
        }
        
        try {
            // Search in all type directories since we don't know the type
            const nodeTypes = await fs.readdir(this.nodesDir);
            
            for (const type of nodeTypes) {
                // Convert to forward slashes for glob (works on all platforms)
                const pattern = path.join(this.nodesDir, type, '**', `${id}.json`).replace(/\\/g, '/');
                const matches = await glob(pattern);
                
                if (matches.length > 0) {
                    const data = await fs.readFile(matches[0], 'utf8');
                    const node = JSON.parse(data) as Node;
                    if (this.canAccessNode(node, auth)) {
                        this.cache.cacheNode(node);
                        return node;
                    }
                }
            }
            return null;
        } catch (error) {
            logger.info(`Node not found or inaccessible: ${id}`);
            return null;
        }
    }

    async getNodeTypeFromId(id: string): Promise<string | null> {
        await this.initialized;
        const node = await this.getNode(id, { userPermissions: ['read'], isAdmin: true });
        return node?.type || null;
    }

    async queryNodes(query: any, auth: AuthContext, options?: { limit?: number; offset?: number }): Promise<Node[]> {
        await this.initialized;
        logger.info(`Querying nodes with query: ${JSON.stringify(query)}`);
        const limit = validateQueryLimit(options?.limit);
        const offset = options?.offset || 0;
        const results = new Map<string, Node>();

        // Try cache first
        if (query.type) {
            const cachedTypeNodes = this.cache.queryNodesByType(query.type);
            if (cachedTypeNodes.size > 0) {
                for (const nodeId of cachedTypeNodes) {
                    const node = await this.getNode(nodeId, auth);
                    if (node && this.matchesQuery(node, query)) {
                        results.set(node.id, node);
                    }
                }
            }
        }

        // Filesystem search (using glob for recursive search through shards)
        try {
            const typeDirectories = await fs.readdir(this.nodesDir);
            
            // If query has a type, only search in that type's directory
            const dirsToSearch = query.type 
                ? [query.type].filter(type => typeDirectories.includes(type))
                : typeDirectories;

            for (const typeDir of dirsToSearch) {
                // Use glob to search recursively through shard directories
                // Convert to forward slashes for glob (works on all platforms)
                const pattern = path.join(this.nodesDir, typeDir, '**', '*.json').replace(/\\/g, '/');
                const files = await glob(pattern);
                
                for (const file of files) {
                    const data = await fs.readFile(file, 'utf8');
                    const node = JSON.parse(data) as Node;
                    if (this.matchesQuery(node, query) && this.canAccessNode(node, auth)) {
                        this.cache.cacheNode(node);
                        results.set(node.id, node);
                    }
                }
            }
        } catch (error) {
            logger.error('Error querying nodes:', error);
        }

        // Apply pagination
        const allResults = Array.from(results.values());
        return allResults.slice(offset, offset + limit);
    }

    async queryNodesAdvanced(options: QueryOptions, auth: AuthContext): Promise<QueryResult> {
        await this.initialized;
        logger.info(`Advanced query with options: ${JSON.stringify(options)}`);
        
        const { filter, sort, pagination } = options;
        
        // Convert filter to basic query or query all nodes if no filter
        const basicQuery = this.convertFilterToQuery(filter);
        
        // If no type specified in filter, we need to query all nodes
        let nodes: Node[] = [];
        if (Object.keys(basicQuery).length === 0) {
            // Query all nodes from all types
            const types = await this.getNodeTypes();
            for (const type of types) {
                const typeNodes = await this.queryNodes({ type }, auth);
                nodes.push(...typeNodes);
            }
        } else {
            // Query with the basic query
            nodes = await this.queryNodes(basicQuery, auth);
        }
        
        // Apply additional filter conditions if specified
        if (filter?.field || filter?.filters) {
            nodes = nodes.filter(node => this.matchesFilterCondition(node, filter));
        }

        // Apply sorting
        if (sort) {
            nodes.sort((a, b) => {
                for (const { field, direction } of sort) {
                    const aValue = this.getNestedValue(a, field);
                    const bValue = this.getNestedValue(b, field);
                    if (aValue !== bValue) {
                        return direction === 'asc' ? 
                            (aValue < bValue ? -1 : 1) :
                            (aValue < bValue ? 1 : -1);
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

    private getPropertyValue(node: Node, field: string | undefined): any {
        if (!field) return undefined;
        if (field === 'type') return node.type;
        const parts = field.split('.');
        if (parts[0] === 'properties') {
            let current = node.properties;
            for (let i = 1; i < parts.length; i++) {
                if (current == null || typeof current !== 'object') return undefined;
                current = current[parts[i]];
            }
            return current;
        }
        return undefined;
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

        const value = this.getPropertyValue(node, filter.field);
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
        await this.initialized;
        this.validateRelationship(relationship);
        logger.info(`Creating relationship from ${relationship.from} to ${relationship.to} of type ${relationship.type}`);
        
        const fromNode = await this.getNode(relationship.from, auth);
        const toNode = await this.getNode(relationship.to, auth);

        if (!fromNode || !toNode) {
            throw new Error("One or both nodes in the relationship do not exist or are not accessible");
        }

        if (!this.canAccessNode(fromNode, auth) || !this.canAccessNode(toNode, auth)) {
            throw new Error("Permission denied: Insufficient permissions to create relationship");
        }

        const filePath = this.getRelationshipPath(relationship);
        const dirPath = path.dirname(filePath);
        
        // Ensure all parent directories exist
        await fs.mkdir(dirPath, { recursive: true });
        
        await fs.writeFile(filePath, JSON.stringify(relationship, null, 2));
    }

    async updateRelationship(from: string, to: string, type: string, updates: Partial<Relationship>, auth: AuthContext): Promise<void> {
        await this.initialized;
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

        // Read existing relationship
        const existingRel = { from, to, type } as Relationship;
        const filePath = this.getRelationshipPath(existingRel);
        
        try {
            const data = await fs.readFile(filePath, 'utf8');
            const relationship = JSON.parse(data) as Relationship;

            // Apply updates
            const updatedRel: Relationship = {
                ...relationship,
                ...updates,
                from: relationship.from,
                to: relationship.to,
                type: relationship.type,
                version: (relationship.version || 1) + 1
            };

            await fs.writeFile(filePath, JSON.stringify(updatedRel, null, 2));
            this.cache.cacheRelationship(updatedRel);
        } catch (error) {
            throw new RelationshipNotFoundError(from, to, type);
        }
    }

    async deleteRelationship(from: string, to: string, type: string, auth: AuthContext): Promise<void> {
        await this.initialized;
        logger.info(`Deleting relationship from ${from} to ${to} of type ${type}`);

        const fromNode = await this.getNode(from, auth);
        const toNode = await this.getNode(to, auth);

        if (!fromNode || !toNode) {
            throw new NodeNotFoundError(`${from} or ${to}`);
        }

        if (!this.canAccessNode(fromNode, auth) || !this.canAccessNode(toNode, auth)) {
            throw new PermissionDeniedError([], auth.userPermissions, `relationship ${from}->${to}`);
        }

        const relationship = { from, to, type } as Relationship;
        const filePath = this.getRelationshipPath(relationship);
        
        try {
            await fs.unlink(filePath);
            this.cache.removeRelationship(relationship);
        } catch (error) {
            throw new RelationshipNotFoundError(from, to, type);
        }
    }

    async queryRelatedNodes(
        from: string,
        type: string,
        auth: AuthContext,
        options?: { direction?: "IN" | "OUT"; skipCache?: boolean; limit?: number }
    ): Promise<Node[]> {
        await this.initialized;
        // Use cache if available
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
        try {
            // Use forward slashes for glob pattern (works on all platforms)
            const pattern = path.join(this.relationshipsDir, type, '**', '*.json').replace(/\\/g, '/');
            const files = await glob(pattern);
            
            for (const file of files) {
                const relationshipData = await fs.readFile(file, 'utf8');
                const relationship = JSON.parse(relationshipData) as Relationship;
                
                if (this.matchesRelationshipQuery(relationship, from, type, options?.direction)) {
                    const targetId = options?.direction === "IN" ? relationship.from : relationship.to;
                    const node = await this.getNode(targetId, auth);
                    if (node && this.canAccessNode(node, auth)) {
                        relatedNodes.push(node);
                        if (relatedNodes.length >= limit) {
                            break; // Stop when limit reached
                        }
                    }
                }
            }
        } catch (error) {
            logger.error('Error querying related nodes:', error);
        }
        return relatedNodes.slice(0, limit);
    }

    private async isDirectory(path: string): Promise<boolean> {
        try {
            const stats = await fs.stat(path);
            return stats.isDirectory();
        } catch (error) {
            return false;
        }
    }

    async cleanup(): Promise<void> {
        await this.initialized;
        try {
            // Clean up nodes directory recursively
            await fs.rm(this.nodesDir, { recursive: true, force: true });
            await fs.rm(this.relationshipsDir, { recursive: true, force: true });
            
            // Clear the cache
            this.clearCache();
            
            // Recreate the directories
            await this.initializeDirectories();
            logger.info('Cleaned up all data files');
        } catch (error) {
            logger.error('Error during cleanup:', error);
            throw error;
        }
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

    private generateId(): string {
        return require('crypto').randomUUID();
    }

    private async getNodeTypes(): Promise<string[]> {
        await this.initialized;
        const entries = await fs.readdir(this.nodesDir, { withFileTypes: true });
        return entries
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name);
    }
}

export { FileSystemStorageAdapter };