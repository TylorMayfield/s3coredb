import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { Relationship, Node, S3CoreDBConfig, AuthContext } from "./types";
import { S3NodeOperations } from "./s3-node-operations";
import { logger } from './logger';

export class S3RelationshipOperations {
  private s3: S3Client;
  private bucket: string;
  private nodeOperations: S3NodeOperations;

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
    this.nodeOperations = new S3NodeOperations(config);
  }

  private getRelationshipKey(relationship: Relationship): string {
    return `relationships/${relationship.type}/${relationship.from}__${relationship.to}.json`;
  }

  async createRelationship(relationship: Relationship, auth: AuthContext): Promise<void> {
    const { from, to, type } = relationship;

    // Verify access to both nodes
    const [fromNode, toNode] = await Promise.all([
      this.nodeOperations.getNode(from, auth),
      this.nodeOperations.getNode(to, auth)
    ]);

    if (!fromNode || !toNode) {
      logger.error('Permission denied or nodes not found', { from, to, type });
      throw new Error("Permission denied or nodes not found");
    }

    const key = this.getRelationshipKey(relationship);
    try {
      const putObjectCommand = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(relationship),
        ContentType: "application/json",
      });
      await this.s3.send(putObjectCommand);
      logger.info('Relationship created', { 
        from,
        to, 
        type,
        fromType: fromNode.type,
        toType: toNode.type 
      });
    } catch (error) {
      logger.error('Error creating relationship', {
        from,
        to,
        type,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async queryRelatedNodes(
    from: string,
    type: string,
    auth: AuthContext,
    options?: { direction?: "IN" | "OUT" }
  ): Promise<Node[]> {
    // First check if user has access to the source node
    const sourceNode = await this.nodeOperations.getNode(from, auth);
    if (!sourceNode) {
      logger.warn('Permission denied or source node not found', { from, type });
      return [];
    }

    try {
      // List all relationships of the specified type
      const listCommand = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: `relationships/${type}/`,
      });

      const listResponse = await this.s3.send(listCommand);
      if (!listResponse.Contents) return [];

      const relatedNodeIds = new Set<string>();

      for (const object of listResponse.Contents) {
        if (!object.Key?.endsWith('.json')) continue;

        try {
          const data = await this.s3.send(
            new GetObjectCommand({
              Bucket: this.bucket,
              Key: object.Key,
            })
          );

          const relationshipJson = await data.Body?.transformToString();
          if (!relationshipJson) continue;

          const relationship = JSON.parse(relationshipJson) as Relationship;
          const [fromId, toId] = object.Key.split('/').pop()!.slice(0, -5).split('__');

          if (!options?.direction || 
              (options.direction === "OUT" && fromId === from) || 
              (options.direction === "IN" && toId === from)) {
            const targetId = options?.direction === "IN" ? fromId : toId;
            relatedNodeIds.add(targetId);
          }
        } catch (error) {
          logger.error('Error processing relationship', {
            key: object.Key,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // Only fetch nodes the user has permission to access
      const relatedNodes: Node[] = [];
      for (const nodeId of relatedNodeIds) {
        const node = await this.nodeOperations.getNode(nodeId, auth);
        if (node) {
          relatedNodes.push(node);
        }
      }
      
      logger.info('Related nodes retrieved', { 
        from,
        type,
        direction: options?.direction,
        count: relatedNodes.length 
      });
      return relatedNodes;
    } catch (error) {
      logger.error('Error querying related nodes', {
        from,
        type,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async listRelationshipTypes(): Promise<string[]> {
    try {
      const response = await this.s3.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: "relationships/",
        Delimiter: "/"
      }));

      if (!response.CommonPrefixes) return [];

      return response.CommonPrefixes
        .map(prefix => prefix.Prefix)
        .filter((prefix): prefix is string => !!prefix)
        .map(prefix => prefix.replace('relationships/', '').replace('/', ''));
    } catch (error) {
      logger.error('Error listing relationship types', {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  async listRelationshipsOfType(type: string): Promise<Relationship[]> {
    try {
      const response = await this.s3.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: `relationships/${type}/`
      }));

      if (!response.Contents) return [];

      const relationships: Relationship[] = [];
      for (const object of response.Contents) {
        if (!object.Key?.endsWith('.json')) continue;

        try {
          const data = await this.s3.send(new GetObjectCommand({
            Bucket: this.bucket,
            Key: object.Key
          }));

          const bodyContents = await data.Body?.transformToString();
          if (bodyContents) {
            relationships.push(JSON.parse(bodyContents));
          }
        } catch (error) {
          logger.error('Failed to get relationship', {
            key: object.Key,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      return relationships;
    } catch (error) {
      logger.error('Error listing relationships of type', {
        type,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  async deleteRelationship(relationship: Relationship): Promise<void> {
    const key = this.getRelationshipKey(relationship);
    try {
      await this.s3.send(new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key
      }));
      logger.info('Relationship deleted', {
        from: relationship.from,
        to: relationship.to,
        type: relationship.type
      });
    } catch (error) {
      logger.error('Error deleting relationship', {
        from: relationship.from,
        to: relationship.to,
        type: relationship.type,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}
