interface S3CoreDBConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  bucket: string;
  s3ForcePathStyle?: boolean;
}

interface Relationship {
  from: string;
  to: string;
  type: string;
  version?: number;
  permissions?: string[];
  properties?: { [key: string]: any };
}

interface Node {
  id: string;
  type: string;
  properties: any;
  version?: number;
  permissions: string[];
  [key: string]: any;
}

interface AuthContext {
  userPermissions: string[];
  isAdmin?: boolean;
}

interface StorageAdapter {
  /**
   * Create a new node in the storage
   */
  createNode(node: Node, auth: AuthContext): Promise<Node>;

  /**
   * Get a node by its ID
   */
  getNode(id: string, auth: AuthContext): Promise<Node | null>;

  /**
   * Update a node's properties
   */
  updateNode(id: string, updates: Partial<Node>, auth: AuthContext): Promise<Node>;

  /**
   * Delete a node by its ID
   */
  deleteNode(id: string, auth: AuthContext): Promise<void>;

  /**
   * Get a node's type from its ID
   */
  getNodeTypeFromId(id: string): Promise<string | null>;

  /**
   * Query nodes based on their properties
   */
  queryNodes(query: any, auth: AuthContext, options?: { limit?: number; offset?: number }): Promise<Node[]>;

  /**
   * Create a relationship between two nodes
   */
  createRelationship(relationship: Relationship, auth: AuthContext): Promise<void>;

  /**
   * Update a relationship's properties
   */
  updateRelationship(from: string, to: string, type: string, updates: Partial<Relationship>, auth: AuthContext): Promise<void>;

  /**
   * Delete a relationship
   */
  deleteRelationship(from: string, to: string, type: string, auth: AuthContext): Promise<void>;

  /**
   * Query nodes related to a given node
   * @param from - The ID of the node to start from
   * @param type - The type of relationship to look for
   * @param auth - Authentication context
   * @param options - Query options
   * @param options.direction - Direction of the relationship:
   *   - "IN": Find nodes that have relationships pointing TO the 'from' node
   *   - "OUT": Find nodes that the 'from' node points TO
   *   - undefined: Find relationships in both directions
   * 
   * Example:
   * If User1 FOLLOWS User2:
   * - queryRelatedNodes(user2.id, "FOLLOWS", auth, { direction: "IN" }) returns [User1]
   * - queryRelatedNodes(user1.id, "FOLLOWS", auth, { direction: "OUT" }) returns [User2]
   */
  queryRelatedNodes(
    from: string,
    type: string,
    auth: AuthContext,
    options?: { 
      direction?: "IN" | "OUT";
      skipCache?: boolean;
      limit?: number;
    }
  ): Promise<Node[]>;

  /**
   * Advanced query with filtering, aggregation, and pagination
   */
  queryNodesAdvanced(options: QueryOptions, auth: AuthContext): Promise<QueryResult>;
}

export type ComparisonOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'contains' | 'startsWith' | 'endsWith';
export type LogicalOperator = 'and' | 'or' | 'not';
export type AggregationOperator = 'count' | 'sum' | 'avg' | 'min' | 'max';

export interface QueryFilter {
  field?: string;
  operator?: ComparisonOperator;
  value?: any;
  logic?: LogicalOperator;
  filters?: QueryFilter[];
}

export interface Aggregation {
  field: string;
  operator: AggregationOperator;
  alias?: string;
}

export interface QueryOptions {
  filter?: QueryFilter;
  aggregations?: Aggregation[];
  groupBy?: string[];
  sort?: { field: string; direction: 'asc' | 'desc' }[];
  pagination?: {
    limit: number;
    offset: number;
  };
}

export interface QueryResult<T = Node> {
  items: T[];
  total: number;
  aggregations?: Record<string, any>;
  hasMore?: boolean;
}

export interface CompoundIndexConfig {
  type: string;
  properties: string[];
}

export interface RangeIndexConfig {
  type: string;
  property: string;
}

export interface StorageAdapterOptions {
  ttl?: number;
  maxSize?: number;
  indexes?: {
    compound?: CompoundIndexConfig[];
    range?: RangeIndexConfig[];
  };
}

export interface CacheOptions {
  ttl?: number;
  maxSize?: number;
  indexes?: {
    compound?: Array<{
      type: string;
      properties: string[];
    }>;
    range?: Array<{
      type: string;
      property: string;
    }>;
  };
  dbCache?: DBCacheConfig;
}

export interface DBCacheConfig {
  enabled: boolean;
  directory: string;
  persistenceInterval: number;
  maxCacheAge: number;
}

export { S3CoreDBConfig, Relationship, Node, StorageAdapter, AuthContext };
