import {
  S3Client,
  ObjectCannedACL,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { DataItem } from "./types/DataItem";
import { SecurityContext } from "./types/SecurityContext";
import { S3Operations } from "./services/S3Operations";
import { AccessControl } from "./services/AccessControl";
import { ShardConfig } from "./types/ShardConfig";

export class S3CoreDB {
  private s3Operations: S3Operations;
  private accessControl: AccessControl;

  constructor(
    accessKeyId: string,
    secretAccessKey: string,
    bucket: string,
    prefix: string = "",
    acl: string = "private",
    endpoint?: string,
    securityContext?: SecurityContext,
    shardConfig: ShardConfig = { strategy: "hash", shardCount: 10 }
  ) {
    this.s3Operations = new S3Operations(
      accessKeyId,
      secretAccessKey,
      bucket,
      prefix,
      acl as ObjectCannedACL,
      shardConfig,
      endpoint
    );
    this.accessControl = new AccessControl(securityContext);
  }

  setSecurityContext(context: SecurityContext) {
    this.accessControl.setSecurityContext(context);
  }

  async insert(table: string, data: DataItem): Promise<string> {
    return this.s3Operations.insert(table, data);
  }

  async get(table: string, id: string): Promise<DataItem | null> {
    const item = await this.s3Operations.get(table, id);
    return this.accessControl.checkAccess(item || undefined, "read")
      ? item
      : null;
  }

  async listShard(table: string, shard: string): Promise<string[]> {
    return this.s3Operations.listShard(table, shard);
  }
}
