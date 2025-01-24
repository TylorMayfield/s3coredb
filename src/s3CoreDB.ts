import { ObjectCannedACL } from "@aws-sdk/client-s3";
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
    console.log(
      `Initializing S3CoreDB with bucket: ${bucket}, prefix: ${prefix}`
    );
    try {
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
    } catch (error) {
      console.error("Error initializing S3CoreDB:", error);
      throw error;
    }
  }

  setSecurityContext(context: SecurityContext) {
    console.log("Setting new security context");
    this.accessControl.setSecurityContext(context);
  }

  async insert(table: string, data: DataItem): Promise<string> {
    console.log(`Inserting into table: ${table}`, { data });
    return this.s3Operations.insert(table, data);
  }

  async get(table: string, id: string): Promise<DataItem | null> {
    console.log(`Getting item from table: ${table}, id: ${id}`);
    const item = await this.s3Operations.get(table, id);
    console.log("Retrieved item:", item);

    if (!item) {
      console.log("Item not found");
      return null;
    }

    const hasAccess = this.accessControl.checkAccess(item, "read");
    console.log(`Access check result: ${hasAccess}`);
    return hasAccess ? item : null;
  }

  async listShard(table: string, shard: string): Promise<string[]> {
    console.log(`Listing shard for table: ${table}, shard: ${shard}`);
    const results = await this.s3Operations.listShard(table, shard);
    console.log(`Found ${results.length} items in shard`);
    return results;
  }
}
