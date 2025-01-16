import { CollectionManager, CollectionMetadata } from "../collection";
import { S3Client } from "../s3Client";
import { PartitionManager, PartitionConfig } from "../partitioning";
import { IndexManager, IndexConfig, IndexEntry } from "../indexing";
import { PutObjectCommandOutput } from "@aws-sdk/client-s3";

// Mock data storage
let mockData: { [key: string]: string };

// Mock S3Client
let mockS3Client: jest.Mocked<S3Client>;

// Mock PartitionManager and IndexManager
let mockPartitionManager: jest.Mocked<PartitionManager>;
let mockIndexManager: jest.Mocked<IndexManager>;

describe("CollectionManager", () => {
  let collectionManager: CollectionManager;
  const testCollection = "test-collection";
  const partitionConfig: PartitionConfig = {
    strategy: "time",
    timeGranularity: "day",
    maxPartitionSize: 1024 * 1024, // 1MB
    indexing: {
      enabled: true,
      fields: ["timestamp"],
    },
  };

  const testDoc = {
    id: "123",
    name: "Test User",
    timestamp: new Date("2025-01-16T19:31:17.000Z"),
  };

  const testDocs = [
    {
      id: "123",
      name: "Alice",
      age: 25,
      timestamp: new Date("2025-01-16T19:00:00.000Z"),
    },
    {
      id: "456",
      name: "Bob",
      age: 30,
      timestamp: new Date("2025-01-16T20:00:00.000Z"),
    },
  ];

  beforeEach(() => {
    // Reset mock data
    mockData = {};

    mockS3Client = {
      getObject: jest.fn().mockImplementation(async (path: string) => {
        return JSON.parse(mockData[path] || "{}");
      }),
      putObject: jest
        .fn()
        .mockImplementation(async (path: string, data: any) => {
          mockData[path] = JSON.stringify(data);
          return {} as PutObjectCommandOutput;
        }),
      listObjects: jest.fn(),
      deleteObject: jest.fn(),
      getObjectMetadata: jest.fn(),
      copyObject: jest.fn(),
      s3Bucket: "test-bucket",
      s3_bucket: "test-bucket",
      s3_acl: "private",
    } as unknown as jest.Mocked<S3Client>;

    mockPartitionManager = {
      getPartitionKey: jest.fn(),
      getPartitionData: jest.fn(),
      writeToPartition: jest.fn(),
      getPartitionsInRange: jest.fn(),
      shouldCreateNewPartition: jest.fn(),
      getPartitionPath: jest.fn(),
      createPartition: jest.fn(),
    } as unknown as jest.Mocked<PartitionManager>;

    mockIndexManager = {
      createIndex: jest.fn(),
      updateIndex: jest.fn(),
      removeFromIndex: jest.fn(),
      findByIndex: jest.fn(),
      getIndex: jest.fn(),
      findInRange: jest.fn(),
    } as unknown as jest.Mocked<IndexManager>;

    collectionManager = new CollectionManager(
      mockS3Client,
      testCollection,
      partitionConfig
    );
    collectionManager["partitionManager"] = mockPartitionManager;
    collectionManager["indexManager"] = mockIndexManager;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe("initialize", () => {
    it("should create collection metadata", async () => {
      await collectionManager.initialize();

      const metadataPath = `collections/${testCollection}/metadata.json`;
      const metadata = JSON.parse(mockData[metadataPath]);

      expect(metadata).toEqual({
        name: testCollection,
        partitionConfig,
        indexes: [],
      });
    });
  });

  describe("insert", () => {
    beforeEach(async () => {
      await collectionManager.initialize();
      await collectionManager.createIndex("name", "unique");
    });

    it("should insert document into partition", async () => {
      const testDocWithStringDate = {
        ...testDoc,
        timestamp: testDoc.timestamp.toISOString(),
      };

      mockPartitionManager.getPartitionKey.mockResolvedValue("2025-01-16");
      mockPartitionManager.getPartitionData.mockResolvedValue([]);
      mockPartitionManager.shouldCreateNewPartition.mockResolvedValue(false);
      mockPartitionManager.writeToPartition.mockImplementation(
        (collection: string, partitionKey: string, data: any) => {
          const path = `collections/${collection}/partitions/${partitionKey}.json`;
          mockData[path] = JSON.stringify(data);
          return Promise.resolve();
        }
      );

      await collectionManager.insert(testDoc);

      // Check if document was stored in the correct partition
      const partitionPath = `collections/${testCollection}/partitions/2025-01-16.json`;
      const partitionData = JSON.parse(mockData[partitionPath] || "[]");

      expect(partitionData).toContainEqual(testDocWithStringDate);
    });

    it("should update indexes after insert", async () => {
      mockPartitionManager.getPartitionKey.mockResolvedValue("2025-01-16");
      mockPartitionManager.getPartitionData.mockResolvedValue([]);
      mockPartitionManager.shouldCreateNewPartition.mockResolvedValue(false);

      mockIndexManager.updateIndex.mockImplementation(
        (collection: string, indexField: string, entries: IndexEntry[]) => {
          const path = `collections/${collection}/indexes/${indexField}.json`;
          mockData[path] = JSON.stringify({ entries });
          return Promise.resolve();
        }
      );

      await collectionManager.insert(testDoc);

      // Check if index was updated
      const indexPath = `collections/${testCollection}/indexes/name.json`;
      const indexData = JSON.parse(mockData[indexPath] || '{"entries":[]}');

      expect(indexData.entries).toContainEqual({
        key: testDoc.name,
        partitionKey: "2025-01-16",
        documentId: testDoc.id,
      } as IndexEntry);
    });
  });

  describe("find", () => {
    interface TestDoc {
      id: string;
      name: string;
      age: number;
      timestamp: Date;
    }

    beforeEach(async () => {
      await collectionManager.initialize();
      await collectionManager.createIndex("name", "unique");
      await collectionManager.createIndex("name", "unique");
      // Instead of actually inserting docs, just mock the partition data
      mockPartitionManager.getPartitionData.mockResolvedValue(testDocs);
    });

    it("should find documents by field value", async () => {
      const results = await collectionManager.find<TestDoc>({ name: "Alice" });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("123");
    });

    it("should find documents by time range", async () => {
      const testDocsWithStringDates = testDocs.map((doc) => ({
        ...doc,
        timestamp: doc.timestamp.toISOString(),
      }));

      mockPartitionManager.getPartitionsInRange.mockResolvedValue([
        "2025-01-16",
      ]);
      mockPartitionManager.getPartitionData.mockImplementation(() => {
        // Filter docs based on time range
        return Promise.resolve(
          testDocsWithStringDates.filter((doc) => {
            const timestamp = new Date(doc.timestamp);
            return (
              timestamp >= new Date("2025-01-16T18:00:00.000Z") &&
              timestamp <= new Date("2025-01-16T20:30:00.000Z")
            );
          })
        );
      });

      const results = await collectionManager.find<TestDoc>({
        timestamp: {
          start: new Date("2025-01-16T18:00:00.000Z"),
          end: new Date("2025-01-16T20:30:00.000Z"),
        },
      });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("123");
    });
  });

  describe("findByIndex", () => {
    interface TestDoc {
      id: string;
      name: string;
      age: number;
      timestamp: Date;
    }

    beforeEach(async () => {
      await collectionManager.initialize();
      await collectionManager.createIndex("name", "unique");
      // Instead of actually inserting docs, just mock the responses
      mockIndexManager.findByIndex.mockResolvedValue([
        { partitionKey: "2025-01-16", documentId: "123", key: "Alice" },
      ]);
      mockPartitionManager.getPartitionData.mockResolvedValue(testDocs);
    });

    it("should find documents using index", async () => {
      const results = await collectionManager.findByIndex<TestDoc>(
        "name",
        "Alice"
      );
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("123");
    });

    it("should return empty array for non-existent value", async () => {
      mockIndexManager.findByIndex.mockResolvedValue([]);
      const results = await collectionManager.findByIndex<TestDoc>(
        "name",
        "Charlie"
      );

      expect(results).toHaveLength(0);
    });
  });

  describe("delete", () => {
    beforeEach(async () => {
      await collectionManager.initialize();
      await collectionManager.createIndex("name", "unique");
      // Instead of actually inserting doc, just mock the responses
      mockPartitionManager.getPartitionKey.mockResolvedValue("2025-01-16");
      mockPartitionManager.getPartitionData.mockResolvedValue([testDoc]);
    });

    it("should delete document and update indexes", async () => {
      mockIndexManager.removeFromIndex.mockResolvedValue(undefined);
      mockPartitionManager.writeToPartition.mockImplementation(
        (collection: string, partitionKey: string, data: any) => {
          const path = `collections/${collection}/partitions/${partitionKey}.json`;
          mockData[path] = JSON.stringify(data);
          return Promise.resolve();
        }
      );

      await collectionManager.delete(testDoc.id);

      // Check if document was removed from partition
      const partitionPath = `collections/${testCollection}/partitions/2025-01-16.json`;
      const partitionData = JSON.parse(mockData[partitionPath] || "[]");

      expect(partitionData).not.toContainEqual(testDoc);

      // Check if document was removed from index
      const indexPath = `collections/${testCollection}/indexes/name.json`;
      const indexData = JSON.parse(mockData[indexPath] || '{"entries":[]}');

      expect(indexData.entries).not.toContainEqual({
        key: testDoc.name,
        partitionKey: "2025-01-16",
        documentId: testDoc.id,
      });
    });
  });

  describe("createIndex", () => {
    beforeEach(async () => {
      await collectionManager.initialize();
    });

    it("should create index and update metadata", async () => {
      // Mock the index creation
      mockIndexManager.createIndex.mockImplementation(
        (collection: string, config: IndexConfig) => {
          const indexPath = `collections/${collection}/indexes/${config.field}.json`;
          mockData[indexPath] = JSON.stringify({
            config,
            entries: [],
          });
          return Promise.resolve();
        }
      );

      await collectionManager.createIndex("name", "unique");

      // Check metadata was updated
      const metadata = JSON.parse(
        mockData[`collections/${testCollection}/metadata.json`]
      );
      expect(metadata.indexes).toContainEqual({
        field: "name",
        type: "unique",
      } as IndexConfig);

      // Check index was created
      const indexPath = `collections/${testCollection}/indexes/name.json`;
      const indexData = JSON.parse(mockData[indexPath]);
      expect(indexData).toEqual({
        config: { field: "name", type: "unique" } as IndexConfig,
        entries: [],
      });
    });
  });
});
