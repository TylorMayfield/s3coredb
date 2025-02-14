import { Node, AuthContext, StorageAdapter, Relationship } from "./types";
import { logger } from './logger';
import * as fs from 'fs/promises';
import * as path from 'path';

class FileSystemStorageAdapter implements StorageAdapter {
  private dataDir: string;
  private nodesDir: string;
  private relationshipsDir: string;
  private initialized: Promise<void>;

  constructor(baseDir: string = 'data') {
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

  async createNode(node: Node, auth: AuthContext): Promise<Node> {
    await this.initialized;
    this.validateNode(node);
    logger.info(`Creating node with id: ${node.id}`);
    const filePath = path.join(this.nodesDir, `${node.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(node, null, 2));
    return node;
  }

  async getNode(id: string, auth: AuthContext): Promise<Node | null> {
    await this.initialized;
    logger.info(`Fetching node with id: ${id}`);
    try {
      const filePath = path.join(this.nodesDir, `${id}.json`);
      const data = await fs.readFile(filePath, 'utf8');
      const node = JSON.parse(data) as Node;
      if (this.canAccessNode(node, auth)) {
        return node;
      }
      return null;
    } catch (error) {
      logger.info(`Node not found or inaccessible: ${id}`);
      return null;
    }
  }

  async getNodeTypeFromId(id: string): Promise<string | null> {
    await this.initialized;
    try {
      const node = await this.getNode(id, { userPermissions: ['read'], isAdmin: true });
      return node?.type || null;
    } catch {
      return null;
    }
  }

  async queryNodes(query: any, auth: AuthContext): Promise<Node[]> {
    await this.initialized;
    logger.info(`Querying nodes with query: ${JSON.stringify(query)}`);
    const results = new Map<string, Node>(); // Use Map to ensure uniqueness by ID
    
    try {
      const files = await fs.readdir(this.nodesDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const data = await fs.readFile(path.join(this.nodesDir, file), 'utf8');
          const node = JSON.parse(data) as Node;
          if (this.matchesQuery(node, query) && this.canAccessNode(node, auth)) {
            results.set(node.id, node); // Store by ID to prevent duplicates
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
    
    // Verify nodes exist and are accessible
    const fromNode = await this.getNode(relationship.from, auth);
    const toNode = await this.getNode(relationship.to, auth);

    if (!fromNode || !toNode) {
      throw new Error("One or both nodes in the relationship do not exist or are not accessible");
    }

    if (!this.canAccessNode(fromNode, auth) || !this.canAccessNode(toNode, auth)) {
      throw new Error("Permission denied: Insufficient permissions to create relationship");
    }

    // Use a safe filename format (replacing | with __ and avoiding special characters)
    const relId = `${relationship.from}__${relationship.to}__${relationship.type}`;
    const filePath = path.join(this.relationshipsDir, `${relId}.json`);
    
    // Write relationship to file
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
      const files = await fs.readdir(this.relationshipsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const relationshipData = await fs.readFile(path.join(this.relationshipsDir, file), 'utf8');
        const relationship = JSON.parse(relationshipData) as Relationship;

        const [fromId, toId, relType] = file.slice(0, -5).split('__'); // Remove .json and split
        if (relType === type) {
          if (!options?.direction || // No direction specified - match both
              (options.direction === "OUT" && fromId === from) || 
              (options.direction === "IN" && toId === from)) {
            const targetId = options?.direction === "IN" ? fromId : toId;
            const node = await this.getNode(targetId, auth);
            if (node && this.canAccessNode(node, auth)) {
              relatedNodes.push(node);
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error querying related nodes:', error);
    }

    return relatedNodes;
  }

  private matchesRelationshipQuery(
    relationship: Relationship,
    from: string,
    type: string,
    direction?: "IN" | "OUT"
  ): boolean {
    if (relationship.type !== type) return false;

    return !direction || // No direction specified - match both
      (direction === "OUT" && relationship.from === from) ||
      (direction === "IN" && relationship.to === from);
  }

  private matchesQuery(node: Node, query: any): boolean {
    for (const key in query) {
      if (key.includes('.')) {
        const queryValue = query[key];
        const nodeValue = this.getNestedValue(node, key);
        
        if (Array.isArray(nodeValue)) {
          if (Array.isArray(queryValue)) {
            if (!queryValue.some(v => nodeValue.includes(v))) {
              return false;
            }
          } else {
            if (!nodeValue.includes(queryValue)) {
              return false;
            }
          }
        } else if (queryValue !== nodeValue) {
          return false;
        }
      } else {
        if (query[key] !== node[key]) {
          return false;
        }
      }
    }
    return true;
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
  }

  private canAccessNode(node: Node, auth: AuthContext): boolean {
    if (auth.isAdmin) return true;
    return node.permissions.some(perm => auth.userPermissions.includes(perm));
  }

  // Add cleanup method for testing/development
  async cleanup(): Promise<void> {
    await this.initialized;
    try {
      // Clear nodes directory
      const nodeFiles = await fs.readdir(this.nodesDir);
      for (const file of nodeFiles) {
        await fs.unlink(path.join(this.nodesDir, file));
      }

      // Clear relationships directory
      const relFiles = await fs.readdir(this.relationshipsDir);
      for (const file of relFiles) {
        await fs.unlink(path.join(this.relationshipsDir, file));
      }

      logger.info('Cleaned up all data files');
    } catch (error) {
      logger.error('Error during cleanup:', error);
      throw error;
    }
  }

  // Add validation methods
  private validateNode(node: Node): void {
    if (!node.type || typeof node.type !== 'string') {
      throw new Error('Node must have a valid type string');
    }
    if (!node.permissions || !Array.isArray(node.permissions)) {
      throw new Error('Node must have a permissions array');
    }
    if (!node.properties || typeof node.properties !== 'object') {
      throw new Error('Node must have a properties object');
    }
  }

  private validateRelationship(relationship: Relationship): void {
    if (!relationship.from || typeof relationship.from !== 'string') {
      throw new Error('Relationship must have a valid from ID');
    }
    if (!relationship.to || typeof relationship.to !== 'string') {
      throw new Error('Relationship must have a valid to ID');
    }
    if (!relationship.type || typeof relationship.type !== 'string') {
      throw new Error('Relationship must have a valid type string');
    }
  }
}

export { FileSystemStorageAdapter };