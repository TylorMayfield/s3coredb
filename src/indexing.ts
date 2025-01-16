import { S3Client } from "./s3Client";

export interface IndexConfig {
  field: string;
  type: "unique" | "non-unique";
}

export interface IndexEntry {
  key: any;
  partitionKey: string;
  documentId: string;
}

export class IndexManager {
  private s3Client: S3Client;

  constructor(s3Client: S3Client) {
    this.s3Client = s3Client;
  }

  private getIndexPath(collection: string, field: string): string {
    return `collections/${collection}/indexes/${field}.json`;
  }

  async createIndex(collection: string, config: IndexConfig): Promise<void> {
    const path = this.getIndexPath(collection, config.field);
    await this.s3Client.putObject(path, {
      config,
      entries: [],
    });
  }

  async updateIndex(
    collection: string,
    field: string,
    entries: IndexEntry[]
  ): Promise<void> {
    const path = this.getIndexPath(collection, field);
    let currentIndex = await this.getIndex(collection, field);

    // Remove old entries for the same documents
    const documentIds = new Set(entries.map((e) => e.documentId));
    currentIndex = currentIndex.filter((e) => !documentIds.has(e.documentId));

    // Add new entries
    currentIndex = [...currentIndex, ...entries];

    // Sort for efficient searching
    currentIndex.sort((a, b) => {
      if (a.key < b.key) return -1;
      if (a.key > b.key) return 1;
      return 0;
    });

    await this.s3Client.putObject(path, {
      config: { field, type: "non-unique" },
      entries: currentIndex,
    });
  }

  async getIndex(collection: string, field: string): Promise<IndexEntry[]> {
    const path = this.getIndexPath(collection, field);
    try {
      const index = (await this.s3Client.getObject(path)) as {
        entries: IndexEntry[];
      };
      return index.entries;
    } catch (error) {
      return [];
    }
  }

  async findByIndex(
    collection: string,
    field: string,
    value: any
  ): Promise<IndexEntry[]> {
    const index = await this.getIndex(collection, field);
    return index.filter((entry) => entry.key === value);
  }

  async findInRange(
    collection: string,
    field: string,
    start: any,
    end: any
  ): Promise<IndexEntry[]> {
    const index = await this.getIndex(collection, field);
    return index.filter((entry) => entry.key >= start && entry.key <= end);
  }

  async removeFromIndex(
    collection: string,
    field: string,
    documentIds: string[]
  ): Promise<void> {
    const path = this.getIndexPath(collection, field);
    const index = await this.getIndex(collection, field);

    const idsSet = new Set(documentIds);
    const filteredEntries = index.filter(
      (entry) => !idsSet.has(entry.documentId)
    );

    await this.s3Client.putObject(path, {
      config: { field, type: "non-unique" },
      entries: filteredEntries,
    });
  }
}
