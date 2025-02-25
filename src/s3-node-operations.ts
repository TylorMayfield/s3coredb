import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { Node, S3CoreDBConfig, AuthContext, QueryFilter, Aggregation, QueryOptions, QueryResult } from "./types";
import { logger } from './logger';

export class S3NodeOperations {
  private s3: S3Client;
  private bucket: string;

  constructor(config: S3CoreDBConfig) {
    const s3Config = {
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.s3ForcePathStyle,
    };
    this.s3 = new S3Client(s3Config);
    this.bucket = config.bucket;
  }

  private getNodeKey(node: Node): string {
    return `nodes/${node.type}/${node.id}.json`;
  }

  private getNodeKeyFromId(type: string, id: string): string {
    return `nodes/${type}/${id}.json`;
  }

  async createNode(node: Node, auth: AuthContext): Promise<Node> {
    if (!this.canCreateWithPermissions(node.permissions, auth)) {
      logger.error('Permission denied for node creation', { 
        nodeId: node.id,
        nodeType: node.type,
        userPermissions: auth.userPermissions,
        requiredPermissions: node.permissions
      });
      throw new Error("Permission denied: Insufficient permissions to create node");
    }

    const params = {
      Bucket: this.bucket,
      Key: this.getNodeKey(node),
      Body: JSON.stringify(node),
      ContentType: "application/json",
    };

    try {
      const command = new PutObjectCommand(params);
      await this.s3.send(command);
      logger.info('Node created successfully', { nodeId: node.id, nodeType: node.type });
      return node;
    } catch (error) {
      logger.error('Error creating node', { 
        nodeId: node.id, 
        nodeType: node.type, 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  async getNode(id: string, auth: AuthContext): Promise<Node | null> {
    try {
      const nodeType = await this.getNodeTypeFromId(id);
      if (!nodeType) {
        logger.info('Node type not found for ID', { nodeId: id });
        return null;
      }

      const params = {
        Bucket: this.bucket,
        Key: this.getNodeKeyFromId(nodeType, id),
      };

      const command = new GetObjectCommand(params);
      const data = await this.s3.send(command);
      const bodyContents = await data.Body?.transformToString();
      if (bodyContents) {
        const node = JSON.parse(bodyContents);
        
        if (!this.canAccessNode(node, auth)) {
          logger.warn('Permission denied for node access', { 
            nodeId: id, 
            nodeType,
            userPermissions: auth.userPermissions,
            nodePermissions: node.permissions
          });
          return null;
        }
        
        logger.info('Node retrieved successfully', { nodeId: id, nodeType });
        return node;
      } else {
        logger.warn('Node body empty', { nodeId: id, nodeType });
        return null;
      }
    } catch (error) {
      logger.error('Error getting node', { 
        nodeId: id, 
        error: error instanceof Error ? error.message : String(error) 
      });
      return null;
    }
  }

  async getNodeTypeFromId(id: string): Promise<string | null> {
    const prefixParams = {
      Bucket: this.bucket,
      Prefix: "nodes/",
      Delimiter: "/",
    };

    try {
      const typesResponse = await this.s3.send(new ListObjectsV2Command(prefixParams));
      if (!typesResponse.CommonPrefixes) return null;

      for (const typePrefix of typesResponse.CommonPrefixes) {
        if (!typePrefix.Prefix) continue;
        
        const type = typePrefix.Prefix.replace('nodes/', '').replace('/', '');
        const nodeKey = this.getNodeKeyFromId(type, id);
        
        try {
          const getObjectResult = await this.s3.send(
            new GetObjectCommand({
              Bucket: this.bucket,
              Key: nodeKey,
            })
          );
          if (getObjectResult.$metadata.httpStatusCode === 200) {
            logger.debug('Found node type', { nodeId: id, nodeType: type });
            return type;
          }
        } catch (error) {
          continue; // Node not found in this type directory
        }
      }

      logger.debug('Node type not found', { nodeId: id });
      return null;
    } catch (error) {
      logger.error('Error getting node type', { 
        nodeId: id, 
        error: error instanceof Error ? error.message : String(error) 
      });
      return null;
    }
  }

  async queryNodes(query: any, auth: AuthContext): Promise<Node[]> {
    const results: Node[] = [];

    try {
      // List all type directories under nodes/
      const typesResponse = await this.s3.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: "nodes/",
        Delimiter: "/"
      }));

      if (!typesResponse.CommonPrefixes) return [];

      // If type is specified in query, only search that type's directory
      const prefixesToSearch = query.type 
        ? [typesResponse.CommonPrefixes.find(p => p.Prefix === `nodes/${query.type}/`)].filter(Boolean)
        : typesResponse.CommonPrefixes;

      for (const prefix of prefixesToSearch) {
        // Add type guard for prefix
        if (!prefix?.Prefix) continue;

        const listParams = {
          Bucket: this.bucket,
          Prefix: prefix.Prefix
        };

        const listedObjects = await this.s3.send(new ListObjectsV2Command(listParams));
        if (!listedObjects.Contents) continue;

        for (const object of listedObjects.Contents) {
          if (!object.Key || !object.Key.endsWith('.json')) continue;

          try {
            const data = await this.s3.send(
              new GetObjectCommand({
                Bucket: this.bucket,
                Key: object.Key,
              })
            );
            const bodyContents = await data.Body?.transformToString();
            if (bodyContents) {
              const node = JSON.parse(bodyContents);
              if (this.matchesQuery(node, query) && this.canAccessNode(node, auth)) {
                results.push(node);
              }
            }
          } catch (error) {
            logger.error('Failed to get object', { 
              key: object.Key, 
              error: error instanceof Error ? error.message : String(error) 
            });
          }
        }
      }
    } catch (error) {
      logger.error('Error querying nodes', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }

    logger.info('Query completed', { 
      queryParams: query, 
      resultCount: results.length,
      userPermissions: auth.userPermissions
    });
    return results;
  }

  async listNodeTypes(): Promise<string[]> {
    try {
      const typesResponse = await this.s3.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: "nodes/",
        Delimiter: "/"
      }));

      if (!typesResponse.CommonPrefixes) return [];

      return typesResponse.CommonPrefixes
        .map(prefix => prefix.Prefix)
        .filter((prefix): prefix is string => !!prefix)
        .map(prefix => prefix.replace('nodes/', '').replace('/', ''));
    } catch (error) {
      logger.error('Error listing node types', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return [];
    }
  }

  async listNodesOfType(type: string): Promise<Node[]> {
    try {
      const listParams = {
        Bucket: this.bucket,
        Prefix: `nodes/${type}/`
      };

      const listedObjects = await this.s3.send(new ListObjectsV2Command(listParams));
      if (!listedObjects.Contents) return [];

      const nodes: Node[] = [];
      for (const object of listedObjects.Contents) {
        if (!object.Key?.endsWith('.json')) continue;

        try {
          const data = await this.s3.send(
            new GetObjectCommand({
              Bucket: this.bucket,
              Key: object.Key,
            })
          );
          const bodyContents = await data.Body?.transformToString();
          if (bodyContents) {
            nodes.push(JSON.parse(bodyContents));
          }
        } catch (error) {
          logger.error('Failed to get object', { 
            key: object.Key, 
            error: error instanceof Error ? error.message : String(error) 
          });
        }
      }
      return nodes;
    } catch (error) {
      logger.error('Error listing nodes of type', { 
        type,
        error: error instanceof Error ? error.message : String(error) 
      });
      return [];
    }
  }

  async deleteNode(node: Node): Promise<void> {
    try {
      const key = this.getNodeKey(node);
      await this.s3.send(new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key
      }));
      logger.info('Node deleted', { nodeId: node.id, nodeType: node.type });
    } catch (error) {
      logger.error('Error deleting node', { 
        nodeId: node.id,
        nodeType: node.type,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  private canCreateWithPermissions(requiredPermissions: string[], auth: AuthContext): boolean {
    if (auth.isAdmin) return true;
    return requiredPermissions.some(perm => auth.userPermissions.includes(perm));
  }

  private canAccessNode(node: Node, auth: AuthContext): boolean {
    if (auth.isAdmin) return true;
    return node.permissions.some(perm => auth.userPermissions.includes(perm));
  }

  private matchesQuery(node: Node, query: any): boolean {
    if (!query) return true;
    
    for (const key in query) {
      if (query.hasOwnProperty(key)) {
        if (!(key in node) || node[key as keyof Node] !== query[key]) {
          return false;
        }
      }
    }
    return true;
  }

  private evaluateFilter(node: Node, filter: QueryFilter): boolean {
    if (!filter) return true;

    if (filter.logic && filter.filters) {
      switch (filter.logic) {
        case 'and':
          return filter.filters.every(f => this.evaluateFilter(node, f));
        case 'or':
          return filter.filters.some(f => this.evaluateFilter(node, f));
        case 'not':
          return !filter.filters.some(f => this.evaluateFilter(node, f));
        default:
          return true;
      }
    }

    if (!filter.field || !filter.operator) return true;
    const value = node.properties[filter.field];

    switch (filter.operator) {
      case 'eq':
        return value === filter.value;
      case 'neq':
        return value !== filter.value;
      case 'gt':
        return value > filter.value;
      case 'gte':
        return value >= filter.value;
      case 'lt':
        return value < filter.value;
      case 'lte':
        return value <= filter.value;
      case 'in':
        return Array.isArray(filter.value) && filter.value.includes(value);
      case 'nin':
        return Array.isArray(filter.value) && !filter.value.includes(value);
      case 'contains':
        return typeof value === 'string' && value.includes(String(filter.value));
      case 'startsWith':
        return typeof value === 'string' && value.startsWith(String(filter.value));
      case 'endsWith':
        return typeof value === 'string' && value.endsWith(String(filter.value));
      default:
        return true;
    }
  }

  private calculateAggregations(nodes: Node[], aggregations: Aggregation[], groupBy?: string[]): Record<string, any> {
    if (!aggregations?.length) return {};

    const groups = new Map<string, Node[]>();
    if (groupBy?.length) {
      nodes.forEach(node => {
        const groupKey = groupBy.map(field => node.properties[field]).join('__');
        const group = groups.get(groupKey) || [];
        group.push(node);
        groups.set(groupKey, group);
      });
    } else {
      groups.set('all', nodes);
    }

    const results: Record<string, any> = {};
    for (const [groupKey, groupNodes] of groups) {
      const groupResults: Record<string, any> = {};
      
      for (const agg of aggregations) {
        const values = groupNodes.map(n => n.properties[agg.field]).filter(v => v != null);
        const alias = agg.alias || `${agg.operator}_${agg.field}`;

        switch (agg.operator) {
          case 'count':
            groupResults[alias] = values.length;
            break;
          case 'sum':
            groupResults[alias] = values.reduce((a, b) => a + b, 0);
            break;
          case 'avg':
            groupResults[alias] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
            break;
          case 'min':
            groupResults[alias] = values.length ? Math.min(...values) : null;
            break;
          case 'max':
            groupResults[alias] = values.length ? Math.max(...values) : null;
            break;
        }
      }

      if (groupBy?.length) {
        const groupFields = groupKey.split('__');
        results[groupKey] = {
          group: Object.fromEntries(groupBy.map((field, i) => [field, groupFields[i]])),
          aggregations: groupResults
        };
      } else {
        Object.assign(results, groupResults);
      }
    }

    return results;
  }

  async queryNodesAdvanced(options: QueryOptions, auth: AuthContext): Promise<QueryResult> {
    const allNodes = await this.queryNodes(options.filter?.field === 'type' ? { type: options.filter.value } : {}, auth);
    
    // Apply complex filtering
    const filteredNodes = allNodes.filter(node => this.evaluateFilter(node, options.filter || {}));

    // Calculate total before pagination
    const total = filteredNodes.length;

    // Apply sorting
    if (options.sort?.length) {
      filteredNodes.sort((a, b) => {
        for (const sort of options.sort!) {
          const aVal = a.properties[sort.field];
          const bVal = b.properties[sort.field];
          if (aVal !== bVal) {
            return sort.direction === 'asc' ? 
              (aVal < bVal ? -1 : 1) : 
              (aVal < bVal ? 1 : -1);
          }
        }
        return 0;
      });
    }

    // Apply pagination
    const start = options.pagination?.offset || 0;
    const end = options.pagination ? start + options.pagination.limit : undefined;
    const paginatedNodes = filteredNodes.slice(start, end);

    // Calculate aggregations
    const aggregations = this.calculateAggregations(
      filteredNodes,
      options.aggregations || [],
      options.groupBy
    );

    return {
      items: paginatedNodes,
      total,
      aggregations,
      hasMore: end ? end < filteredNodes.length : false
    };
  }
}