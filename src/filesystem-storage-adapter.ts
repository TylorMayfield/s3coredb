import { Node, Relationship, StorageAdapter, AuthContext, QueryOptions, QueryResult } from './types';
import { S3NodeOperations } from './s3-node-operations';
import { logger } from './logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BaseStorageAdapter } from "./base-storage-adapter";
import { glob } from 'glob';
import { promisify } from 'util';

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
                const pattern = path.join(this.nodesDir, type, '**', `${id}.json`);
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

    async queryNodes(query: any, auth: AuthContext): Promise<Node[]> {
        await this.initialized;
        logger.info(`Querying nodes with query: ${JSON.stringify(query)}`);
        const results = new Map<string, Node>();
        const result: Node[] = [];
        const nodeTypes = await this.getNodeTypes();

        // Use type index if available
        if (query.type) {
            const cachedTypeNodes = this.cache.queryNodesByType(query.type);
            if (cachedTypeNodes.size > 0) {
                for (const nodeId of cachedTypeNodes) {
                    const node = await this.getNode(nodeId, auth);
                    if (node && this.matchesQuery(node, query)) {
                        results.set(node.id, node);
                    }
                }
                return Array.from(results.values());
            }
        }

        // Use compound index if available
        if (query.type && query['properties.city'] && query['properties.age']) {
            const nodes = this.cache.queryByCompoundIndex(
                query.type,
                ['city', 'age'],
                [query['properties.city'], query['properties.age']]
            );
            if (nodes.size > 0) {
                for (const nodeId of nodes) {
                    const node = await this.getNode(nodeId, auth);
                    if (node) result.push(node);
                }
                return result;
            }
        }

        // Use range index for age queries
        if (query.type && query['properties.age']) {
            const nodes = this.cache.queryByRange(
                query.type,
                'age',
                query['properties.age'],
                query['properties.age']
            );
            if (nodes.size > 0) {
                for (const nodeId of nodes) {
                    const node = await this.getNode(nodeId, auth);
                    if (node) result.push(node);
                }
                return result;
            }
        }

        // Fallback to filesystem search
        const typeDirectories = await fs.readdir(this.nodesDir);
        
        // If query has a type, only search in that type's directory
        const dirsToSearch = query.type 
            ? [query.type].filter(type => typeDirectories.includes(type))
            : typeDirectories;

        for (const typeDir of dirsToSearch) {
            const typePath = path.join(this.nodesDir, typeDir);
            const files = await fs.readdir(typePath);
            
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const data = await fs.readFile(path.join(typePath, file), 'utf8');
                    const node = JSON.parse(data) as Node;
                    if (this.matchesQuery(node, query) && this.canAccessNode(node, auth)) {
                        this.cache.cacheNode(node);
                        results.set(node.id, node);
                    }
                }
            }
        }

        return Array.from(results.values());
    }

    async queryNodesAdvanced(options: QueryOptions, auth: AuthContext): Promise<QueryResult> {
        await this.initialized;
        logger.info(`Advanced query with options: ${JSON.stringify(options)}`);
        
        const { filter, sort, pagination } = options;
        let nodes: Node[] = [];

        // Use indexes for filtering if possible
        if (filter?.filters) {
            const typeFilter = filter.filters.find(f => f.field === 'type');
            const ageFilter = filter.filters.find(f => f.field === 'properties.age');
            const cityFilter = filter.filters.find(f => f.field === 'properties.city');
            
            if (typeFilter?.value && ageFilter?.value) {
                // Try range index for age queries
                if (ageFilter.operator === 'gt' || ageFilter.operator === 'gte' ||
                    ageFilter.operator === 'lt' || ageFilter.operator === 'lte') {
                    const min = ageFilter.operator === 'gt' || ageFilter.operator === 'gte' ? ageFilter.value : undefined;
                    const max = ageFilter.operator === 'lt' || ageFilter.operator === 'lte' ? ageFilter.value : undefined;
                    const nodeIds = this.cache.queryByRange(typeFilter.value, 'age', min, max);
                    
                    for (const nodeId of nodeIds) {
                        const node = await this.getNode(nodeId, auth);
                        if (node) nodes.push(node);
                    }
                }
                // Try compound index for city + age queries
                else if (cityFilter?.value) {
                    const nodeIds = this.cache.queryByCompoundIndex(
                        typeFilter.value,
                        ['city', 'age'],
                        [cityFilter.value, ageFilter.value]
                    );
                    for (const nodeId of nodeIds) {
                        const node = await this.getNode(nodeId, auth);
                        if (node) nodes.push(node);
                    }
                }
            }
        }

        // Fallback to basic query if no index matches
        if (nodes.length === 0) {
            nodes = await this.queryNodes(this.convertFilterToQuery(filter), auth);
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

    async queryRelatedNodes(
        from: string,
        type: string,
        auth: AuthContext,
        options?: { direction?: "IN" | "OUT"; skipCache?: boolean }
    ): Promise<Node[]> {
        await this.initialized;
        // Use cache if available
        if (!options?.skipCache) {
            return this.queryRelatedNodesWithCache(from, type, auth, options);
        }

        logger.info(`Querying related nodes from ${from} of type ${type}`);
        const fromNode = await this.getNode(from, auth);
        if (!fromNode || !this.canAccessNode(fromNode, auth)) {
            return [];
        }

        const relatedNodes: Node[] = [];
        try {
            const pattern = path.join(this.relationshipsDir, type, '**', '*.json');
            const files = await glob(pattern);
            
            for (const file of files) {
                const relationshipData = await fs.readFile(file, 'utf8');
                const relationship = JSON.parse(relationshipData) as Relationship;
                
                if (this.matchesRelationshipQuery(relationship, from, type, options?.direction)) {
                    const targetId = options?.direction === "IN" ? relationship.from : relationship.to;
                    const node = await this.getNode(targetId, auth);
                    if (node && this.canAccessNode(node, auth)) {
                        relatedNodes.push(node);
                    }
                }
            }
        } catch (error) {
            logger.error('Error querying related nodes:', error);
        }
        return relatedNodes;
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