import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { Node, S3CoreDBConfig, AuthContext, QueryFilter, Aggregation, QueryOptions, QueryResult } from "./types";
import { ShardManager } from "./shard-manager";
import { logger } from './logger';

export class S3NodeOperations {
  private s3: S3Client;
  private bucket: string;
  private shardManager?: ShardManager;

  constructor(config: S3CoreDBConfig, shardManager?: ShardManager) {
    this.shardManager = shardManager;
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

  getNodeKey(node: Node, shardPath: string): string {
    return `nodes/${shardPath}/${node.id}.json`;
  }

  async createNode(node: Node, auth: AuthContext, shardPath: string): Promise<Node> {
    const key = this.getNodeKey(node, shardPath);
    try {
      const putObjectCommand = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(node),
        ContentType: "application/json",
      });
      await this.s3.send(putObjectCommand);
      logger.info('Node created successfully', { id: node.id, type: node.type });
      return node;
    } catch (error) {
      logger.error('Error creating node:', error);
      throw error;
    }
  }

  async getNode(id: string, auth: AuthContext, type?: string): Promise<Node | null> {
    try {
      if (type) {
        const shardPath = this.shardManager ? this.shardManager.getShardPath(id) : '';
        const key = `nodes/${type}/${shardPath ? shardPath + '/' : ''}${id}.json`;
        
        try {
          const getObjectCommand = new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
          });
          
          const response = await this.s3.send(getObjectCommand);
          const data = await response.Body?.transformToString();
          if (!data) return null;

          return JSON.parse(data) as Node;
        } catch (e: any) {
          // If accessing with ShardManager fails (or returns NoSuchKey), and we didn't use ShardManager, fallback?
          // Actually, if ShardManager IS used, we expect the path to be correct.
          // If ShardManager is NOT used, shardPath is empty, so it checks nodes/type/id.json.
          if (e.name !== 'NoSuchKey') {
            throw e;
          }
          return null;
        }
      } else {
        // If type is not known, we must check all types.
        // Instead of listing objects (slow and broken for wildcards), we iterate types and check existence.
        const types = await this.listNodeTypes();
        const shardPath = this.shardManager ? this.shardManager.getShardPath(id) : '';

        // We can parallelize the checks
        const checkPromises = types.map(async (t) => {
            const key = `nodes/${t}/${shardPath ? shardPath + '/' : ''}${id}.json`;
            try {
                const getObjectCommand = new GetObjectCommand({
                    Bucket: this.bucket,
                    Key: key,
                });
                const response = await this.s3.send(getObjectCommand);
                const data = await response.Body?.transformToString();
                if (data) {
                    return JSON.parse(data) as Node;
                }
            } catch (e: any) {
                if (e.name !== 'NoSuchKey') {
                    logger.warn(`Error checking node ${id} in type ${t}: ${e.message}`);
                }
            }
            return null;
        });

        const results = await Promise.all(checkPromises);
        return results.find(n => n !== null) || null;
      }
    } catch (error) {
      logger.error('Error getting node:', error);
    }
    return null;
  }

  async getNodeTypeFromId(id: string): Promise<string | null> {
    try {
      const listCommand = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: "nodes/",
      });
      const response = await this.s3.send(listCommand);

      for (const object of response.Contents || []) {
        if (object.Key?.endsWith(`${id}.json`)) {
          const parts = object.Key.split('/');
          if (parts.length >= 3) {
            return parts[1]; // Return the type from the path
          }
        }
      }
    } catch (error) {
      logger.error('Error getting node type:', error);
    }
    return null;
  }

  async listNodeTypes(): Promise<string[]> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: "nodes/",
        Delimiter: "/",
      });
      const response = await this.s3.send(command);
      return (response.CommonPrefixes || [])
        .map(prefix => prefix.Prefix!.replace('nodes/', '').replace('/', ''))
        .filter(type => type.length > 0);
    } catch (error) {
      logger.error('Error listing node types:', error);
      return [];
    }
  }

  async listNodesOfType(type: string): Promise<Node[]> {
    const nodes: Node[] = [];
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: `nodes/${type}/`,
      });
      const response = await this.s3.send(command);

      for (const object of response.Contents || []) {
        if (object.Key?.endsWith('.json')) {
          const getCommand = new GetObjectCommand({
            Bucket: this.bucket,
            Key: object.Key,
          });
          const nodeResponse = await this.s3.send(getCommand);
          const data = await nodeResponse.Body?.transformToString();
          if (data) {
            nodes.push(JSON.parse(data));
          }
        }
      }
    } catch (error) {
      logger.error('Error listing nodes of type:', error);
    }
    return nodes;
  }

  async deleteNode(node: Node): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: `nodes/${node.type}/${node.id}.json`,
      });
      await this.s3.send(command);
      logger.info('Node deleted successfully', { id: node.id, type: node.type });
    } catch (error) {
      logger.error('Error deleting node:', error);
      throw error;
    }
  }

  async queryNodes(query: any): Promise<Node[]> {
    const nodes: Node[] = [];
    try {
      if (query.type) {
        // If type is specified, only search in that type's folder
        const command = new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `nodes/${query.type}/`,
        });
        const response = await this.s3.send(command);

        for (const object of response.Contents || []) {
          if (object.Key?.endsWith('.json')) {
            const getCommand = new GetObjectCommand({
              Bucket: this.bucket,
              Key: object.Key,
            });
            const nodeResponse = await this.s3.send(getCommand);
            const data = await nodeResponse.Body?.transformToString();
            if (data) {
              const node = JSON.parse(data);
              if (this.matchesQuery(node, query)) {
                nodes.push(node);
              }
            }
          }
        }
      } else {
        // Search all types
        const types = await this.listNodeTypes();
        for (const type of types) {
          const typeNodes = await this.listNodesOfType(type);
          nodes.push(...typeNodes.filter(node => this.matchesQuery(node, query)));
        }
      }
    } catch (error) {
      logger.error('Error querying nodes:', error);
    }
    return nodes;
  }

  private matchesQuery(node: Node, query: any): boolean {
    for (const [key, value] of Object.entries(query)) {
      if (key === 'type') {
        if (node.type !== value) return false;
      } else if (key.startsWith('properties.')) {
        const propertyKey = key.substring('properties.'.length);
        const propertyValue = node.properties[propertyKey];
        if (Array.isArray(value)) {
          if (!Array.isArray(propertyValue) || !value.every(v => propertyValue.includes(v))) {
            return false;
          }
        } else if (propertyValue !== value) {
          return false;
        }
      }
    }
    return true;
  }
}