import { Node, AuthContext, StorageAdapter, Relationship } from "./types";
import { logger } from './logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BaseStorageAdapter } from "./base-storage-adapter";

class FileSystemStorageAdapter extends BaseStorageAdapter implements StorageAdapter {
    private dataDir: string;
    private nodesDir: string;
    private relationshipsDir: string;
    private initialized: Promise<void>;

    constructor(baseDir: string = 'db-data') {
        super();
        this.dataDir = path.resolve(process.cwd(), baseDir);
        this.nodesDir = path.join(this.dataDir, 'nodes');
        this.relationshipsDir = path.join(this.dataDir, 'relationships');
        this.initialized = this.initializeDirectories();
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
        const typeDir = path.join(this.nodesDir, node.type);
        return path.join(typeDir, `${node.id}.json`);
    }

    private async ensureTypeDirectory(type: string): Promise<void> {
        const typeDir = path.join(this.nodesDir, type);
        await fs.mkdir(typeDir, { recursive: true });
    }

    private getRelationshipPath(relationship: Relationship): string {
        const typeDir = path.join(this.relationshipsDir, relationship.type);
        const relId = `${relationship.from}__${relationship.to}`;
        return path.join(typeDir, `${relId}.json`);
    }

    private async ensureRelationshipTypeDirectory(type: string): Promise<void> {
        const typeDir = path.join(this.relationshipsDir, type);
        await fs.mkdir(typeDir, { recursive: true });
    }

    async createNode(node: Node, auth: AuthContext): Promise<Node> {
        await this.initialized;
        this.validateNode(node);
        logger.info(`Creating node with id: ${node.id} of type: ${node.type}`);
        
        await this.ensureTypeDirectory(node.type);
        const filePath = this.getNodePath(node);
        await fs.writeFile(filePath, JSON.stringify(node, null, 2));
        return node;
    }

    async getNode(id: string, auth: AuthContext): Promise<Node | null> {
        await this.initialized;
        logger.info(`Fetching node with id: ${id}`);
        
        try {
            // Since we don't know the type, we need to search in all type directories
            const typeDirectories = await fs.readdir(this.nodesDir);
            
            for (const typeDir of typeDirectories) {
                const possiblePath = path.join(this.nodesDir, typeDir, `${id}.json`);
                try {
                    const data = await fs.readFile(possiblePath, 'utf8');
                    const node = JSON.parse(data) as Node;
                    if (this.canAccessNode(node, auth)) {
                        return node;
                    }
                } catch (error) {
                    continue; // Node not found in this type directory
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

        try {
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
                            results.set(node.id, node);
                        }
                    }
                }
            }
        } catch (error) {
            logger.error('Error querying nodes:', error);
        }

        return Array.from(results.values());
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

        await this.ensureRelationshipTypeDirectory(relationship.type);
        const filePath = this.getRelationshipPath(relationship);
        await fs.writeFile(filePath, JSON.stringify(relationship, null, 2));
    }

    async queryRelatedNodes(
        from: string,
        type: string,
        auth: AuthContext,
        options?: { direction?: "IN" | "OUT" }
    ): Promise<Node[]> {
        await this.initialized;
        logger.info(`Querying related nodes from ${from} of type ${type}`);

        const fromNode = await this.getNode(from, auth);
        if (!fromNode || !this.canAccessNode(fromNode, auth)) {
            return [];
        }

        const relatedNodes: Node[] = [];
        try {
            const typeDir = path.join(this.relationshipsDir, type);
            const files = await fs.readdir(typeDir).catch(() => []);

            for (const file of files) {
                if (!file.endsWith('.json')) continue;

                const relationshipData = await fs.readFile(path.join(typeDir, file), 'utf8');
                const relationship = JSON.parse(relationshipData) as Relationship;

                const [fromId, toId] = file.slice(0, -5).split('__');
                
                if (this.matchesRelationshipQuery(relationship, from, type, options?.direction)) {
                    const targetId = options?.direction === "IN" ? fromId : toId;
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
            // Clean up nodes directory
            const nodeEntries = await fs.readdir(this.nodesDir);
            for (const entry of nodeEntries) {
                const fullPath = path.join(this.nodesDir, entry);
                if (await this.isDirectory(fullPath)) {
                    // Handle type-based subdirectories
                    const files = await fs.readdir(fullPath);
                    for (const file of files) {
                        await fs.unlink(path.join(fullPath, file));
                    }
                    await fs.rmdir(fullPath);
                } else {
                    // Handle files directly in nodes directory (old structure)
                    await fs.unlink(fullPath);
                }
            }

            // Clean up relationships directory
            const relTypeEntries = await fs.readdir(this.relationshipsDir);
            for (const entry of relTypeEntries) {
                const fullPath = path.join(this.relationshipsDir, entry);
                if (await this.isDirectory(fullPath)) {
                    const files = await fs.readdir(fullPath);
                    for (const file of files) {
                        await fs.unlink(path.join(fullPath, file));
                    }
                    await fs.rmdir(fullPath);
                } else {
                    await fs.unlink(fullPath);
                }
            }

            logger.info('Cleaned up all data files');
        } catch (error) {
            logger.error('Error during cleanup:', error);
            throw error;
        }
    }
}

export { FileSystemStorageAdapter };