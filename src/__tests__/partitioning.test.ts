import { S3Client } from '../s3Client';
import { PartitionManager, PartitionConfig } from '../partitioning';

// Mock S3Client
const mockS3Client = { putObject: jest.fn() } as unknown as S3Client;

describe('PartitionManager', () => {
  let partitionManager: PartitionManager;
  const partitionConfig: PartitionConfig = {
    strategy: 'time',
    timeGranularity: 'day',
    maxPartitionSize: 1024 * 1024,
    indexing: { enabled: true, fields: ['timestamp'] },
  };

  beforeEach(() => {
    partitionManager = new PartitionManager(mockS3Client, partitionConfig);
  });

  describe('getPartitionKey', () => {
    it('should generate partition key based on timestamp', async () => {
      const timestamp = new Date('2025-01-16T14:00:00Z');
      const key = await partitionManager.getPartitionKey(timestamp);
      expect(key).toBe('2025/01/16');
    });

    it('should generate partition key with hour granularity', async () => {
      partitionConfig.timeGranularity = 'hour';
      const timestamp = new Date('2025-01-16T14:30:00Z');
      const key = await partitionManager.getPartitionKey(timestamp);
      expect(key).toBe('2025/01/16/14');
    });
  });

  describe('getPartitionPath', () => {
    it('should return the correct partition path', () => {
      const path = partitionManager.getPartitionPath('test-collection', '2025/01/16');
      expect(path).toBe('collections/test-collection/partitions/2025/01/16.json');
    });
  });

  describe('createPartition', () => {
    it('should call putObject with the correct path', async () => {
      await partitionManager.createPartition('test-collection', '2025/01/16');
      expect(mockS3Client.putObject).toHaveBeenCalledWith(
        'collections/test-collection/partitions/2025/01/16.json',
        []
      );
    });
  });
});
