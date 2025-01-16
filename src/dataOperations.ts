import { DataItem, SecurityContext, VersionMetadata } from "./types";
import { SecurityUtils } from "./security";
import { generateId } from "./utils";
import { S3Client } from "./s3Client";
import { VersionControl } from "./versioning";

export class DataOperations {
  constructor(
    private s3Client: S3Client,
    private securityContext?: SecurityContext
  ) {}

  setSecurityContext(context: SecurityContext) {
    this.securityContext = context;
  }

  private checkSecurity(): SecurityContext {
    if (!this.securityContext) {
      throw new Error(
        "Security context not set. Please call setSecurityContext() first."
      );
    }
    return this.securityContext;
  }

  async insert(table: string, data: DataItem): Promise<string> {
    const context = this.checkSecurity();

    if (data._acl && !data._acl.owner) {
      data._acl.owner = context.userId;
    }

    const curdata = await this.get_all(table);
    const id = generateId();
    data._id = id;
    
    // Initialize version metadata
    const versionedData = VersionControl.applyVersion(data, context.userId);
    
    curdata.push(versionedData);
    await this.save(table, curdata);
    return id;
  }

  async update(table: string, data: DataItem, id: string): Promise<string> {
    const context = this.checkSecurity();
    const curdata = await this.get_all(table);
    const index = curdata.findIndex((x) => x._id === id);

    if (index === -1) {
      throw new Error("Item not found");
    }

    const existingItem = curdata[index];
    if (!SecurityUtils.canWrite(existingItem, context)) {
      throw new Error("Permission denied: Cannot update this item");
    }

    // Preserve ACL owner and apply versioning
    if (existingItem._acl && data._acl) {
      data._acl.owner = existingItem._acl.owner;
    }
    
    const versionedData = VersionControl.applyVersion(
      { ...data, _id: id, _history: existingItem._history },
      context.userId
    );

    curdata[index] = versionedData;
    await this.save(table, curdata);
    return id;
  }

  async delete(table: string, id: string): Promise<string> {
    const context = this.checkSecurity();
    const curdata = await this.get_all(table);
    const index = curdata.findIndex((x) => x._id === id);

    if (index === -1) {
      throw new Error("Item not found");
    }

    if (!SecurityUtils.canDelete(curdata[index], context)) {
      throw new Error("Permission denied: Cannot delete this item");
    }

    const newdata = curdata
      .slice(0, index)
      .concat(curdata.slice(index + 1, curdata.length));
    await this.save(table, newdata);
    return id;
  }

  async get_all(table: string): Promise<DataItem[]> {
    const context = this.checkSecurity();
    const items = await this.s3Client.getObject(table + ".json");
    return SecurityUtils.filterReadableItems(items, context);
  }

  async get(
    table: string,
    id: string,
    version?: number
  ): Promise<DataItem | undefined> {
    const context = this.checkSecurity();
    const curdata = await this.get_all(table);
    const item = curdata.find((x) => x._id === id);

    if (!item) return undefined;

    if (!SecurityUtils.canRead(item, context)) {
      throw new Error("Permission denied: Cannot read this item");
    }

    if (version !== undefined) {
      return VersionControl.getVersion(item, version);
    }

    return item;
  }

  async getVersionHistory(
    table: string,
    id: string
  ): Promise<VersionMetadata[]> {
    const item = await this.get(table, id);
    if (!item) {
      throw new Error("Item not found");
    }
    return VersionControl.getVersionHistory(item);
  }

  private async save(table: string, data: DataItem[]): Promise<AWS.S3.PutObjectOutput> {
    return await this.s3Client.putObject(table + ".json", data);
  }
}
