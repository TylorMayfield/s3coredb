import { S3Client } from './s3Client';
import { PartitionManager, PartitionConfig } from './partitioning';
import { IndexManager, IndexConfig } from './indexing';

export interface CollectionMetadata {
  name: string;
  partitionConfig: PartitionConfig;
  indexes: IndexConfig[];
  schema?: object;
}

export class CollectionManager {
  private s3Client: S3Client;
  private partitionManager: PartitionManager;
  private indexManager: IndexManager;
  private collection: string;
  private metadata: CollectionMetadata;

  constructor(
    s3Client: S3Client,
    collection: string,
    config: PartitionConfig
  ) {
    this.s3Client = s3Client;
    this.collection = collection;
    this.partitionManager = new PartitionManager(s3Client, config);
    this.indexManager = new IndexManager(s3Client);
    this.metadata = {
      name: collection,
      partitionConfig: config,
      indexes: []
    };
  }

  private getMetadataPath(): string {
    return `collections/${this.collection}/metadata.json`;
  }

  async initialize(): Promise<void> {
    const path = this.getMetadataPath();
    await this.s3Client.putObject(path, this.metadata);
  }

  async insert<T extends { id: string }>(document: T): Promise<void> {
    const timestamp = new Date();
    const partitionKey = await this.partitionManager.getPartitionKey(timestamp);
    
    // Get current partition data
    let partitionData = await this.partitionManager.getPartitionData<T>(
      this.collection,
      partitionKey
    );

    // Check if we need a new partition
    if (await this.partitionManager.shouldCreateNewPartition(this.collection, partitionKey)) {
      const newTimestamp = new Date(timestamp.getTime() + 1000); // Add 1 second
      const newPartitionKey = await this.partitionManager.getPartitionKey(newTimestamp);
      await this.partitionManager.createPartition(this.collection, newPartitionKey);
      partitionData = [];
    }

    // Add document to partition
    partitionData.push(document);
    await this.partitionManager.writeToPartition(
      this.collection,
      partitionKey,
      partitionData
    );

    // Update indexes
    for (const indexConfig of this.metadata.indexes) {
      const field = indexConfig.field;
      const value = (document as any)[field];
      if (value !== undefined) {
        await this.indexManager.updateIndex(
          this.collection,
          field,
          [{
            key: value,
            partitionKey,
            documentId: document.id
          }]
        );
      }
    }
  }

  async find<T>(query: {
    [key: string]: any;
    timestamp?: { start: Date; end: Date };
  }): Promise<T[]> {
    let partitionKeys: string[] = [];
    
    // Handle time-based queries
    if (query.timestamp) {
      partitionKeys = await this.partitionManager.getPartitionsInRange(
        this.collection,
        query.timestamp.start,
        query.timestamp.end
      );
    } else {
      // Default to current partition if no time range specified
      partitionKeys = [await this.partitionManager.getPartitionKey(new Date())];
    }

    // Get all documents from relevant partitions
    const results: T[] = [];
    for (const partitionKey of partitionKeys) {
      const partitionData = await this.partitionManager.getPartitionData<T>(
        this.collection,
        partitionKey
      );
      
      // Filter based on query criteria
      const filtered = partitionData.filter(doc => {
        // Check timestamp range first if it exists
        if (query.timestamp) {
          const docTimestamp = new Date((doc as any).timestamp);
          const start = new Date(query.timestamp.start);
          const end = new Date(query.timestamp.end);
          if (docTimestamp < start || docTimestamp > end) {
            return false;
          }
        }

        // Check other query criteria
        for (const [key, value] of Object.entries(query)) {
          if (key === 'timestamp') continue;
          if ((doc as any)[key] !== value) return false;
        }
        return true;
      });
      
      results.push(...filtered);
    }

    return results;
  }

  async findByIndex<T>(field: string, value: any): Promise<T[]> {
    const indexEntries = await this.indexManager.findByIndex(
      this.collection,
      field,
      value
    );

    const results: T[] = [];
    for (const entry of indexEntries) {
      const partitionData = await this.partitionManager.getPartitionData<T>(
        this.collection,
        entry.partitionKey
      );
      
      const document = partitionData.find(doc => 
        (doc as any).id === entry.documentId
      );
      
      if (document) {
        results.push(document);
      }
    }

    return results;
  }

  async createIndex(field: string, type: 'unique' | 'non-unique' = 'non-unique'): Promise<void> {
    const indexConfig = { field, type };
    this.metadata.indexes.push(indexConfig);
    
    // Update metadata
    await this.s3Client.putObject(
      this.getMetadataPath(),
      this.metadata
    );

    // Create index
    await this.indexManager.createIndex(this.collection, indexConfig);
  }

  async delete(documentId: string): Promise<void> {
    // Find document in indexes
    for (const indexConfig of this.metadata.indexes) {
      await this.indexManager.removeFromIndex(
        this.collection,
        indexConfig.field,
        [documentId]
      );
    }

    // Remove from partition
    // Note: This is inefficient for large datasets and should be optimized
    const timestamp = new Date();
    const partitionKey = await this.partitionManager.getPartitionKey(timestamp);
    const partitionData = await this.partitionManager.getPartitionData(
      this.collection,
      partitionKey
    );

    const updatedData = partitionData.filter(doc => 
      (doc as any).id !== documentId
    );

    await this.partitionManager.writeToPartition(
      this.collection,
      partitionKey,
      updatedData
    );
  }
}
