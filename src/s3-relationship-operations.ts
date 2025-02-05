import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { Relationship, Node, S3CoreDBConfig } from "./types";
import { S3NodeOperations } from "./s3-node-operations";

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

  async createRelationship(relationship: Relationship): Promise<void> {
    const { from, to, type } = relationship;
    const fromType = await this.nodeOperations.getNodeTypeFromId(from);
    const toType = await this.nodeOperations.getNodeTypeFromId(to);

    if (!fromType || !toType) {
      throw new Error("One or both nodes in the relationship do not exist.");
    }

    const key = `${fromType}/${from}/relationships.json`;
    try {
      const getObjectCommand = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const existingRelationships = await this.s3.send(getObjectCommand);
      const existingRelationshipsJson =
        await existingRelationships.Body?.transformToString();
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
    } catch (error: any) {
      if (error.$metadata?.httpStatusCode === 404) {
        const putObjectCommand = new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: JSON.stringify([relationship]),
          ContentType: "application/json",
        });
        await this.s3.send(putObjectCommand);
      } else {
        console.error("Error creating relationship:", error);
        throw error;
      }
    }
  }

  async queryRelatedNodes(
    from: string,
    type: string,
    options?: { direction?: "IN" | "OUT" }
  ): Promise<Node[]> {
    const fromType = await this.nodeOperations.getNodeTypeFromId(from);
    if (!fromType) {
      return []; // Or throw an error, depending on your error handling strategy
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

      const relatedNodes: Node[] = [];
      for (const nodeId of relatedNodeIds) {
        const node = await this.nodeOperations.getNode(nodeId);
        if (node) {
          relatedNodes.push(node);
        }
      }
      return relatedNodes;
    } catch (error: any) {
      if (error.$metadata?.httpStatusCode === 404) {
        return [];
      }
      console.error("Error querying related nodes:", error);
      throw error;
    }
  }
}

export { S3RelationshipOperations };
