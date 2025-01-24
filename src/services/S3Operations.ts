import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ObjectCannedACL,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { createS3Client, S3ClientConfig } from "../S3ClientConfig";
import { DataItem } from "../types/DataItem";
import { generateId } from "../utils";
import { ShardingStrategy, ShardConfig } from "./ShardingStrategy";

export class S3Operations {
  private s3Client: S3Client;
  private bucket: string;
  private prefix: string;
  private acl: ObjectCannedACL;
  private shardingStrategy: ShardingStrategy;

  constructor(
    accessKeyId: string,
    secretAccessKey: string,
    bucket: string,
    prefix: string,
    acl: ObjectCannedACL,
    shardConfig: ShardConfig = { strategy: "hash", shardCount: 10 },
    endpoint?: string
  ) {
    this.bucket = bucket;
    this.prefix = prefix;
    this.acl = acl;
    this.shardingStrategy = new ShardingStrategy(shardConfig);

    const config: S3ClientConfig = {
      credentials: { accessKeyId, secretAccessKey },
    };

    if (endpoint) {
      config.endpoint = endpoint;
      config.forcePathStyle = true;
    }

    this.s3Client = createS3Client(config);
  }

  private getFullKey(table: string, id: string): string {
    const shard = this.shardingStrategy.calculateShard(table, id);
    return `${this.prefix}${table}/${shard}/${id}.json`;
  }

  async insert(table: string, data: DataItem): Promise<string> {
    const id = data._id || generateId();
    const timestamp = new Date().toISOString();
    const item = { ...data, _id: id, _lastModified: timestamp };

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.getFullKey(table, id),
      Body: JSON.stringify(item),
      ACL: this.acl,
      Metadata: {
        shard: this.shardingStrategy.calculateShard(table, id),
        timestamp,
      },
    });

    await this.s3Client.send(command);
    return id;
  }

  async get(table: string, id: string): Promise<DataItem | null> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.getFullKey(table, id),
    });

    try {
      const response = await this.s3Client.send(command);
      if (!response.Body) return null;

      const bodyContents = await response.Body?.transformToString();
      return JSON.parse(bodyContents);
    } catch (error) {
      if ((error as any).name === "NoSuchKey") return null;
      if (error instanceof Error) {
        throw new Error(`Error fetching item from S3: ${error.message}`);
      } else {
        throw new Error("Error fetching item from S3");
      }
    }
  }

  // Optional: Add method to list items in a shard
  async listShard(table: string, shard: string): Promise<string[]> {
    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: `${this.prefix}${table}/${shard}/`,
    });

    try {
      const response = await this.s3Client.send(command);
      return (response.Contents || [])
        .map((obj) => obj.Key || "")
        .filter((key) => key.endsWith(".json"))
        .map((key) => key.split("/").pop()?.replace(".json", "") || "");
    } catch (error) {
      throw new Error(`Error listing shard contents: ${error}`);
    }
  }
}
