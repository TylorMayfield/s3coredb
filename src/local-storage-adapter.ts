import { Node, AuthContext, StorageAdapter } from "./types";
import { logger } from './logger';

class LocalStorageAdapter implements StorageAdapter {
  private storage: Map<string, Node> = new Map();
  private relationships: Map<string, any[]> = new Map();

  async createNode(node: Node, auth: AuthContext): Promise<Node> {
    logger.info(`Creating node with id: ${node.id}`);
    this.storage.set(node.id, node);
    return node;
  }

  async getNode(id: string, auth: AuthContext): Promise<Node | null> {
    logger.info(`Fetching node with id: ${id}`);
    return this.storage.get(id) || null;
  }

  async getNodeTypeFromId(id: string): Promise<string | null> {
    logger.info(`Fetching node type for id: ${id}`);
    const node = this.storage.get(id);
    return node ? node.type : null;
  }

  async queryNodes(query: any, auth: AuthContext): Promise<Node[]> {
    logger.info(`Querying nodes with query: ${JSON.stringify(query)}`);
    const results: Node[] = [];
    for (const node of this.storage.values()) {
      if (this.matchesQuery(node, query) && this.canAccessNode(node, auth)) {
        results.push(node);
      }
    }
    return results;
  }

  async createRelationship(relationship: any, auth: AuthContext): Promise<void> {
    logger.info(`Creating relationship from ${relationship.from} to ${relationship.to} of type ${relationship.type}`);
    const { from, to, type } = relationship;
    const fromNode = this.storage.get(from);
    const toNode = this.storage.get(to);

    if (!fromNode || !toNode) {
      logger.error("One or both nodes in the relationship do not exist.");
      throw new Error("One or both nodes in the relationship do not exist.");
    }

    if (!this.canAccessNode(fromNode, auth) || !this.canAccessNode(toNode, auth)) {
      logger.error("Permission denied: Insufficient permissions to create relationship");
      throw new Error("Permission denied: Insufficient permissions to create relationship");
    }

    // Store relationships with a delimiter that won't appear in UUIDs
    const key = `${from}|${to}|${type}`;
    const relationships: any[] = Array.isArray(this.relationships.get(key)) ? (this.relationships.get(key) as any[]) : [];
    relationships.push(relationship);
    this.relationships.set(key, relationships);
  }

  async queryRelatedNodes(from: string, type: string, auth: AuthContext, options?: { direction?: "IN" | "OUT" }): Promise<Node[]> {
    logger.info(`Querying related nodes from ${from} of type ${type}`);
    const fromNode = this.storage.get(from);
    if (!fromNode) {
      return [];
    }

    if (!this.canAccessNode(fromNode, auth)) {
      return [];
    }

    const relatedNodes: Node[] = [];
    for (const [key, rels] of this.relationships.entries()) {
      logger.info(`Checking relationship key: ${key} with direction: ${options?.direction}`);
      const [fromId, toId, relType] = key.split('|');
      if (relType === type) {
        if (!options?.direction || // No direction specified - match both
            (options.direction === "OUT" && fromId === from) || 
            (options.direction === "IN" && toId === from)) {
          const targetId = (options?.direction === "IN") ? fromId : toId;
          const node = this.storage.get(targetId);
          if (node && this.canAccessNode(node, auth)) {
            relatedNodes.push(node);
          }
        }
      }
    }

    return relatedNodes;
  }

  private matchesQuery(node: Node, query: any): boolean {
    for (const key in query) {
      if (key.includes('.')) {
        // Handle nested properties
        const queryValue = query[key];
        const nodeValue = this.getNestedValue(node, key);
        if (queryValue !== nodeValue) {
          return false;
        }
      } else {
        // Handle top-level properties
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
}

export { LocalStorageAdapter };
