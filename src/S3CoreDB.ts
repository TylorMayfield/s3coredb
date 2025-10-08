import crypto from "crypto";
import { Node, S3CoreDBConfig, StorageAdapter, Relationship, AuthContext, QueryOptions, QueryResult } from "./types";
import { logger } from './logger';
import { Validator, validateQueryLimit } from './validator';
import { PermissionDeniedError, NodeNotFoundError } from './errors';

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
    
    // Validate input
    Validator.validateNode({ type: data.type, properties: data.properties, permissions: data.permissions } as Node, true);
    
    // Only users with admin access or at least one matching permission can create nodes
    if (!this.canCreateWithPermissions(data.permissions, authContext)) {
      logger.error('Permission denied for node creation', { 
        type: data.type,
        userPermissions: authContext.userPermissions,
        requiredPermissions: data.permissions
      });
      throw new PermissionDeniedError(data.permissions, authContext.userPermissions, 'node creation');
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

  async updateNode(id: string, updates: Partial<Node>, auth?: AuthContext): Promise<Node> {
    const authContext = this.getAuthContext(auth);
    logger.info('Updating node', { id, updates: Object.keys(updates) });
    return this.storage.updateNode(id, updates, authContext);
  }

  async deleteNode(id: string, auth?: AuthContext): Promise<void> {
    const authContext = this.getAuthContext(auth);
    logger.info('Deleting node', { id });
    return this.storage.deleteNode(id, authContext);
  }

  async getNodeTypeFromId(id: string): Promise<string | null> {
    logger.debug('Getting node type', { id });
    return this.storage.getNodeTypeFromId(id);
  }

  async queryNodes(query: any, auth?: AuthContext, options?: { limit?: number; offset?: number }): Promise<Node[]> {
    const authContext = this.getAuthContext(auth);
    logger.info('Querying nodes', { query, limit: options?.limit });
    return this.storage.queryNodes(query, authContext, options);
  }

  async queryNodesAdvanced(options: QueryOptions, auth: AuthContext = this.defaultAuthContext): Promise<QueryResult> {
    return this.storage.queryNodesAdvanced(options, auth);
  }

  async createRelationship(relationship: Relationship, auth?: AuthContext): Promise<void> {
    const authContext = this.getAuthContext(auth);
    
    // Validate relationship
    Validator.validateRelationship(relationship);
    
    // Check permissions on both source and target nodes
    const [fromNode, toNode] = await Promise.all([
      this.getNode(relationship.from, authContext),
      this.getNode(relationship.to, authContext)
    ]);

    if (!fromNode || !toNode) {
      throw new NodeNotFoundError(`${relationship.from} or ${relationship.to}`);
    }

    if (!this.canAccessNode(fromNode, authContext) || !this.canAccessNode(toNode, authContext)) {
      logger.error('Permission denied for relationship creation', { 
        from: relationship.from,
        to: relationship.to,
        type: relationship.type
      });
      throw new PermissionDeniedError(
        [...fromNode.permissions, ...toNode.permissions],
        authContext.userPermissions,
        `relationship ${relationship.from}->${relationship.to}`
      );
    }

    logger.info('Creating relationship', { 
      from: relationship.from, 
      to: relationship.to, 
      type: relationship.type 
    });
    return this.storage.createRelationship(relationship, authContext);
  }

  async updateRelationship(from: string, to: string, type: string, updates: Partial<Relationship>, auth?: AuthContext): Promise<void> {
    const authContext = this.getAuthContext(auth);
    logger.info('Updating relationship', { from, to, type, updates: Object.keys(updates) });
    return this.storage.updateRelationship(from, to, type, updates, authContext);
  }

  async deleteRelationship(from: string, to: string, type: string, auth?: AuthContext): Promise<void> {
    const authContext = this.getAuthContext(auth);
    logger.info('Deleting relationship', { from, to, type });
    return this.storage.deleteRelationship(from, to, type, authContext);
  }

  async queryRelatedNodes(
    from: string,
    type: string,
    auth?: AuthContext,
    options?: { direction?: "IN" | "OUT"; limit?: number }
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
