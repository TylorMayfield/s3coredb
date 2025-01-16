import { S3Client } from './s3Client';

export interface PartitionConfig {
  strategy: 'time' | 'hash';
  timeGranularity: 'year' | 'month' | 'day' | 'hour';
  maxPartitionSize: number;
  indexing: {
    enabled: boolean;
    fields: string[];
  };
}

export interface TimePartitionKey {
  year: number;
  month?: number;
  day?: number;
  hour?: number;
}

export class PartitionManager {
  private s3Client: S3Client;
  private config: PartitionConfig;

  constructor(s3Client: S3Client, config: PartitionConfig) {
    this.s3Client = s3Client;
    this.config = config;
  }

  async getPartitionKey(timestamp: Date): Promise<string> {
    const year = timestamp.getUTCFullYear();
    const month = timestamp.getUTCMonth() + 1;
    const day = timestamp.getUTCDate();
    const hour = timestamp.getUTCHours();

    const parts: string[] = [year.toString()];

    if (this.config.timeGranularity === 'month' || 
        this.config.timeGranularity === 'day' || 
        this.config.timeGranularity === 'hour') {
      parts.push(month.toString().padStart(2, '0'));
    }

    if (this.config.timeGranularity === 'day' || 
        this.config.timeGranularity === 'hour') {
      parts.push(day.toString().padStart(2, '0'));
    }

    if (this.config.timeGranularity === 'hour') {
      parts.push(hour.toString().padStart(2, '0'));
    }

    return parts.join('/');
  }

  getPartitionPath(collection: string, partitionKey: string): string {
    return `collections/${collection}/partitions/${partitionKey}.json`;
  }

  async createPartition(collection: string, partitionKey: string): Promise<void> {
    const path = this.getPartitionPath(collection, partitionKey);
    await this.s3Client.putObject(path, []);
  }

  async getPartitionData<T>(collection: string, partitionKey: string): Promise<T[]> {
    const path = this.getPartitionPath(collection, partitionKey);
    try {
      const data = await this.s3Client.getObject(path);
      return data as T[];
    } catch (error) {
      return [];
    }
  }

  async writeToPartition<T>(
    collection: string, 
    partitionKey: string, 
    data: T[]
  ): Promise<void> {
    const path = this.getPartitionPath(collection, partitionKey);
    await this.s3Client.putObject(path, data);
  }

  async getPartitionsInRange(
    collection: string,
    startDate: Date,
    endDate: Date
  ): Promise<string[]> {
    const startKey = await this.getPartitionKey(startDate);
    const endKey = await this.getPartitionKey(endDate);
    
    // List all partitions in the range
    const prefix = `collections/${collection}/partitions/`;
    const allPartitions = await this.s3Client.listObjects(prefix);
    
    return allPartitions
      .filter(key => {
        const partitionKey = key.replace(prefix, '').replace('.json', '');
        return partitionKey >= startKey && partitionKey <= endKey;
      })
      .map(key => key.replace(prefix, '').replace('.json', ''));
  }

  async shouldCreateNewPartition(
    collection: string,
    partitionKey: string
  ): Promise<boolean> {
    const path = this.getPartitionPath(collection, partitionKey);
    const metadata = await this.s3Client.getObjectMetadata(path);
    
    return (metadata.ContentLength ?? 0) >= this.config.maxPartitionSize;
  }
}
