import { DataItem, SecurityContext, VersionMetadata } from "./types";
import { S3Client } from "./s3Client";
import { DataOperations } from "./dataOperations";

export class S3CoreDB {
  private dataOps: DataOperations;
  private s3Client: S3Client;

  constructor(
    s3_key: string,
    s3_secret: string,
    s3_bucket: string,
    s3_prefix: string = "",
    s3_acl: string = "private",
    s3_endpoint?: string,
    securityContext?: SecurityContext
  ) {
    this.s3Client = new S3Client(
      s3_key,
      s3_secret,
      s3_bucket,
      s3_prefix,
      s3_acl,
      s3_endpoint
    );

    this.dataOps = new DataOperations(this.s3Client, securityContext);
  }

  setSecurityContext(context: SecurityContext) {
    this.dataOps.setSecurityContext(context);
  }

  async insert(table: string, data: DataItem): Promise<string> {
    return this.dataOps.insert(table, data);
  }

  async update(table: string, data: DataItem, id: string): Promise<string> {
    return this.dataOps.update(table, data, id);
  }

  async delete(table: string, id: string): Promise<string> {
    return this.dataOps.delete(table, id);
  }

  async get_all(table: string): Promise<DataItem[]> {
    return this.dataOps.get_all(table);
  }

  async get(
    table: string,
    id: string,
    version?: number
  ): Promise<DataItem | undefined> {
    return this.dataOps.get(table, id, version);
  }

  async getVersionHistory(
    table: string,
    id: string
  ): Promise<VersionMetadata[]> {
    return this.dataOps.getVersionHistory(table, id);
  }
}
