import crypto from "crypto";
import { Node, S3CoreDBConfig, StorageAdapter, Relationship, AuthContext, QueryOptions, QueryResult } from "./types";
import { logger } from './logger';

class S3CoreDB {
  private storage: StorageAdapter;
  private defaultAuthContext: AuthContext = { userPermissions: [] };

  constructor(config: S3CoreDBConfig, adapter?: StorageAdapter) {
    if (!adapter) {
      logger.error('Storage adapter not provided');
      throw new Error("Storage adapter is required");
    }
    this.storage = adapter;
    logger.info('S3CoreDB initialized', { endpoint: config.endpoint, bucket: config.bucket });
  }

  setDefaultAuthContext(auth: AuthContext) {
    this.defaultAuthContext = auth;
    logger.info('Default auth context updated', { permissions: auth.userPermissions });
  }

  private getAuthContext(auth?: AuthContext): AuthContext {
    return auth || this.defaultAuthContext;
  }

  async createNode(
    data: { type: string; properties: any; permissions: string[] },
    auth?: AuthContext
  ): Promise<Node> {
    const authContext = this.getAuthContext(auth);
    
    // Only users with admin access or at least one matching permission can create nodes
    if (!this.canCreateWithPermissions(data.permissions, authContext)) {
      logger.error('Permission denied for node creation', { 
        type: data.type,
        userPermissions: authContext.userPermissions,
        requiredPermissions: data.permissions
      });
      throw new Error("Permission denied: Insufficient permissions to create node");
    }

    const id = crypto.randomUUID();
    const node: Node = { id, ...data, version: 1 };
    logger.info('Creating node', { type: data.type, id, permissions: data.permissions });
    return this.storage.createNode(node, authContext);
  }

  async getNode(id: string, auth?: AuthContext): Promise<Node | null> {
    const authContext = this.getAuthContext(auth);
    logger.debug('Getting node', { id });
    return this.storage.getNode(id, authContext);
  }

  async getNodeTypeFromId(id: string): Promise<string | null> {
    logger.debug('Getting node type', { id });
    return this.storage.getNodeTypeFromId(id);
  }

  async queryNodes(query: any, auth?: AuthContext): Promise<Node[]> {
    const authContext = this.getAuthContext(auth);
    logger.info('Querying nodes', { query });
    return this.storage.queryNodes(query, authContext);
  }

  async queryNodesAdvanced(options: QueryOptions, auth: AuthContext = this.defaultAuthContext): Promise<QueryResult> {
    return this.storage.queryNodesAdvanced(options, auth);
  }

  async createRelationship(relationship: Relationship, auth?: AuthContext): Promise<void> {
    const authContext = this.getAuthContext(auth);
    
    // Check permissions on both source and target nodes
    const [fromNode, toNode] = await Promise.all([
      this.getNode(relationship.from, authContext),
      this.getNode(relationship.to, authContext)
    ]);

    if (!fromNode || !toNode) {
      throw new Error("One or both nodes in the relationship do not exist");
    }

    if (!this.canAccessNode(fromNode, authContext) || !this.canAccessNode(toNode, authContext)) {
      logger.error('Permission denied for relationship creation', { 
        from: relationship.from,
        to: relationship.to,
        type: relationship.type
      });
      throw new Error("Permission denied: Insufficient permissions to create relationship");
    }

    logger.info('Creating relationship', { 
      from: relationship.from, 
      to: relationship.to, 
      type: relationship.type 
    });
    return this.storage.createRelationship(relationship, authContext);
  }

  async queryRelatedNodes(
    from: string,
    type: string,
    auth?: AuthContext,
    options?: { direction?: "IN" | "OUT" }
  ): Promise<Node[]> {
    const authContext = this.getAuthContext(auth);
    logger.info('Querying related nodes', { from, type, options });
    return this.storage.queryRelatedNodes(from, type, authContext, options);
  }

  private canCreateWithPermissions(requiredPermissions: string[], auth: AuthContext): boolean {
    if (auth.isAdmin) return true;
    return requiredPermissions.some(perm => auth.userPermissions.includes(perm));
  }

  private canAccessNode(node: Node, auth: AuthContext): boolean {
    if (auth.isAdmin) return true;
    return node.permissions.some(perm => auth.userPermissions.includes(perm));
  }
}

export { S3CoreDB };
