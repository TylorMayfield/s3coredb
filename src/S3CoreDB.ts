import crypto from "crypto";
import { Node, S3CoreDBConfig, StorageAdapter } from "./types";
import { S3StorageAdapter } from "./storage-adapter";

class S3CoreDB {
  private storage: StorageAdapter;

  constructor(config: S3CoreDBConfig, adapter?: StorageAdapter) {
    this.storage = adapter || new S3StorageAdapter(config);
  }

  async createNode(data: { type: string; properties: any }): Promise<Node> {
    const id = crypto.randomUUID();
    const node: Node = { id, ...data };
    return this.storage.createNode(node);
  }

  async getNode(id: string): Promise<Node | null> {
    return this.storage.getNode(id);
  }

  async getNodeTypeFromId(id: string): Promise<string | null> {
    return this.storage.getNodeTypeFromId(id);
  }

  async queryNodes(query: any): Promise<Node[]> {
    return this.storage.queryNodes(query);
  }

  async createRelationship(relationship: Relationship): Promise<void> {
    return this.storage.createRelationship(relationship);
  }

  async queryRelatedNodes(
    from: string,
    type: string,
    options?: { direction?: "IN" | "OUT" }
  ): Promise<Node[]> {
    return this.storage.queryRelatedNodes(from, type, options);
  }
}

interface Relationship {
  from: string;
  to: string;
  type: string;
}

export { S3CoreDB };
