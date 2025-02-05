import { StorageAdapter, S3CoreDBConfig, Node, Relationship } from "./types";
import { S3NodeOperations } from "./s3-node-operations";
import { S3RelationshipOperations } from "./s3-relationship-operations";

class S3StorageAdapter implements StorageAdapter {
  private nodeOperations: S3NodeOperations;
  private relationshipOperations: S3RelationshipOperations;

  constructor(config: S3CoreDBConfig) {
    this.nodeOperations = new S3NodeOperations(config);
    this.relationshipOperations = new S3RelationshipOperations(config);
  }

  async createNode(node: Node): Promise<Node> {
    return this.nodeOperations.createNode(node);
  }

  async getNode(id: string): Promise<Node | null> {
    return this.nodeOperations.getNode(id);
  }

  async getNodeTypeFromId(id: string): Promise<string | null> {
    return this.nodeOperations.getNodeTypeFromId(id);
  }

  async queryNodes(query: any): Promise<Node[]> {
    return this.nodeOperations.queryNodes(query);
  }

  async createRelationship(relationship: Relationship): Promise<void> {
    return this.relationshipOperations.createRelationship(relationship);
  }

  async queryRelatedNodes(
    from: string,
    type: string,
    options?: { direction?: "IN" | "OUT" }
  ): Promise<Node[]> {
    return this.relationshipOperations.queryRelatedNodes(from, type, options);
  }
}

export { S3StorageAdapter };
