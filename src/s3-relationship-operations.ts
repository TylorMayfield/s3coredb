import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { Relationship, Node, S3CoreDBConfig, AuthContext } from "./types";
import { S3NodeOperations } from "./s3-node-operations";
import { logger } from './logger';

class S3RelationshipOperations {
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

  async createRelationship(relationship: Relationship, auth: AuthContext): Promise<void> {
    const { from, to, type } = relationship;
    const fromType = await this.nodeOperations.getNodeTypeFromId(from);
    const toType = await this.nodeOperations.getNodeTypeFromId(to);

    if (!fromType || !toType) {
      logger.error('Invalid relationship nodes', { from, to, type });
      throw new Error("One or both nodes in the relationship do not exist.");
    }

    // Verify access to both nodes
    const [fromNode, toNode] = await Promise.all([
      this.nodeOperations.getNode(from, auth),
      this.nodeOperations.getNode(to, auth)
    ]);

    if (!fromNode || !toNode) {
      logger.error('Permission denied or nodes not found', { from, to, type });
      throw new Error("Permission denied or nodes not found");
    }

    const key = `${fromType}/${from}/relationships.json`;
    try {
      const getObjectCommand = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const existingRelationships = await this.s3.send(getObjectCommand);
      const existingRelationshipsJson = await existingRelationships.Body?.transformToString();
      const relationships: Relationship[] = existingRelationshipsJson
        ? JSON.parse(existingRelationshipsJson)
        : [];
      relationships.push(relationship);
      const putObjectCommand = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(relationships),
        ContentType: "application/json",
      });
      await this.s3.send(putObjectCommand);
      logger.info('Relationship created', { 
        from,
        to, 
        type,
        fromType,
        toType 
      });
    } catch (error: any) {
      if (error.$metadata?.httpStatusCode === 404) {
        const putObjectCommand = new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: JSON.stringify([relationship]),
          ContentType: "application/json",
        });
        await this.s3.send(putObjectCommand);
        logger.info('First relationship created for node', { 
          from,
          to,
          type,
          fromType 
        });
      } else {
        logger.error('Error creating relationship', {
          from,
          to,
          type,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
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

    const fromType = await this.nodeOperations.getNodeTypeFromId(from);
    if (!fromType) {
      logger.warn('Node type not found for relationship query', { from, type });
      return [];
    }

    const key = `${fromType}/${from}/relationships.json`;
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });

    try {
      const data = await this.s3.send(command);
      const relationshipsJson = await data.Body?.transformToString();
      const relationships: Relationship[] = relationshipsJson
        ? JSON.parse(relationshipsJson)
        : [];
      const relatedNodeIds =
        options?.direction === "OUT"
          ? relationships
              .filter((rel) => rel.type === type && rel.from === from)
              .map((rel) => rel.to)
          : relationships
              .filter((rel) => rel.type === type && rel.to === from)
              .map((rel) => rel.from);

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
    } catch (error: any) {
      if (error.$metadata?.httpStatusCode === 404) {
        logger.debug('No relationships found', { from, type });
        return [];
      }
      logger.error('Error querying related nodes', {
        from,
        type,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}

export { S3RelationshipOperations };
