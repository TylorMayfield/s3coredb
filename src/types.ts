import { S3Client } from "@aws-sdk/client-s3";

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
}

interface Node {
  id: string;
  type: string;
  properties: any;
}

interface StorageAdapter {
  createNode(node: Node): Promise<Node>;
  getNode(id: string): Promise<Node | null>;
  getNodeTypeFromId(id: string): Promise<string | null>;
  queryNodes(query: any): Promise<Node[]>;
  createRelationship(relationship: Relationship): Promise<void>;
  queryRelatedNodes(
    from: string,
    type: string,
    options?: { direction?: "IN" | "OUT" }
  ): Promise<Node[]>;
}

export { S3CoreDBConfig, Relationship, Node, StorageAdapter };
