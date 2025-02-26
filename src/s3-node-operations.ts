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
      let key: string;
      if (type) {
        key = `nodes/${type}/${id}.json`;
        const getObjectCommand = new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        });
        
        const response = await this.s3.send(getObjectCommand);
        const data = await response.Body?.transformToString();
        if (!data) return null;
        
        return JSON.parse(data) as Node;
      } else {
        // List all type folders
        const listCommand = new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: "nodes/",
          Delimiter: "/",
        });
        const response = await this.s3.send(listCommand);
        
        // Search in each type folder recursively
        for (const prefix of response.CommonPrefixes || []) {
          const searchCommand = new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix.Prefix + "**/" + id + ".json",
          });
          const searchResponse = await this.s3.send(searchCommand);
          
          if (searchResponse.Contents && searchResponse.Contents.length > 0) {
            const getCommand = new GetObjectCommand({
              Bucket: this.bucket,
              Key: searchResponse.Contents[0].Key,
            });
            const nodeResponse = await this.s3.send(getCommand);
            const data = await nodeResponse.Body?.transformToString();
            if (data) {
              return JSON.parse(data) as Node;
            }
          }
        }
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