import { S3CoreDB } from "../s3CoreDB";
import { DataItem, SecurityContext } from "../types";
import { S3Client } from "../s3Client";
import { IndexManager } from "../indexing";

// Mock S3Client
const mockData: { [key: string]: string } = {};

const mockS3Client = {
  putObject: jest.fn().mockImplementation((key: string, data: any) => {
    mockData[key] = JSON.stringify(data);
    return Promise.resolve({});
  }),
  getObject: jest.fn().mockImplementation((key: string) => {
    const data = mockData[key];
    if (!data) {
      // Return empty array for regular documents, and { entries: [] } for index files
      return Promise.resolve(key.includes('/indexes/') ? { entries: [] } : []);
    }
    return Promise.resolve(JSON.parse(data));
  }),
  deleteObject: jest.fn().mockImplementation((key: string) => {
    delete mockData[key];
    return Promise.resolve({});
  }),
  listObjects: jest.fn().mockImplementation(() => {
    const keys = Object.keys(mockData).map((key) => ({ Key: key }));
    return Promise.resolve({
      Contents: keys,
      IsTruncated: false,
    });
  }),
  getObjectMetadata: jest.fn().mockImplementation((key: string) => {
    const data = mockData[key];
    if (!data) {
      return Promise.reject(new Error("NoSuchKey"));
    }
    return Promise.resolve({});
  }),
};

jest.mock("../s3Client", () => ({
  __esModule: true,
  S3Client: jest.fn().mockImplementation(() => mockS3Client),
}));

describe("S3CoreDB", () => {
  let db: S3CoreDB;
  let testDoc: DataItem;

  beforeEach(() => {
    // Clear mock data between tests
    Object.keys(mockData).forEach((key) => delete mockData[key]);

    // Initialize DB with security context
    db = new S3CoreDB(
      "test-key",
      "test-secret",
      "test-bucket",
      "",
      "private",
      undefined,
      { userId: "test-user", roles: ["admin"] }
    );

    // Create fresh test document for each test
    testDoc = {
      _id: "", // ID will be generated by insert
      name: "Test Document",
      _version: 1,
      _lastModified: "2025-01-16T12:20:08-05:00",
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("insert", () => {
    it("should insert a new document", async () => {
      const result = await db.insert("users", testDoc);
      expect(result).toBeDefined();
      expect(result).toBe(testDoc._id);
    });
  });

  describe("get", () => {
    it("should retrieve a document", async () => {
      const id = await db.insert("users", testDoc);
      const result = await db.get("users", id);
      expect(result).toBeDefined();
      const doc = result as DataItem;
      expect(doc._id).toBe(id);
    });

    it("should handle security context", async () => {
      const securityContext: SecurityContext = {
        userId: "user1",
        roles: ["reader"],
      };

      const id = await db.insert("users", testDoc);
      db.setSecurityContext(securityContext);
      const result = await db.get("users", id);
      expect(result).toBeDefined();
      const doc = result as DataItem;
      expect(doc._id).toBe(id);
    });
  });

  describe("update", () => {
    it("should update an existing document", async () => {
      const id = await db.insert("users", testDoc);
      const updateDoc = {
        ...testDoc,
        _id: id,
        name: "Updated Name",
      };

      const result = await db.update("users", updateDoc, id);
      expect(result).toBeDefined();
      expect(result).toBe(id);

      const updated = await db.get("users", id);
      expect(updated).toBeDefined();
      const doc = updated as DataItem;
      expect(doc.name).toBe("Updated Name");
    });
  });

  describe("delete", () => {
    it("should delete a document", async () => {
      const id = await db.insert("users", testDoc);
      const result = await db.delete("users", id);
      expect(result).toBeDefined();
      expect(result).toBe(id);

      const deleted = await db.get("users", id);
      expect(deleted).toBeUndefined();
    });
  });

  describe("get_all", () => {
    beforeEach(() => {
      // Clear mock data before each test
      Object.keys(mockData).forEach((key) => delete mockData[key]);
    });

    it("should retrieve all documents", async () => {
      const id = await db.insert("users", testDoc);
      const results = await db.get_all("users");
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(1);
      expect(results[0]._id).toBe(id);
    });

    it("should return empty array for empty bucket", async () => {
      const results = await db.get_all("users");
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });
  });
});

// IndexManager Tests
describe("IndexManager", () => {
  let indexManager: IndexManager;

  beforeEach(() => {
    // Clear mock data before each test
    Object.keys(mockData).forEach((key) => delete mockData[key]);
    indexManager = new IndexManager(mockS3Client as unknown as S3Client);
  });

  describe("createIndex", () => {
    it("should create an empty index", async () => {
      const config = { field: "age", type: "non-unique" as const };
      await indexManager.createIndex("users", config);

      const index = await indexManager.getIndex("users", "age");
      expect(index).toEqual([]);
    });
  });

  describe("updateIndex", () => {
    it("should add new entries to index", async () => {
      const entries = [
        { key: 25, partitionKey: "p1", documentId: "doc1" },
        { key: 30, partitionKey: "p1", documentId: "doc2" },
      ];

      await indexManager.updateIndex("users", "age", entries);
      const index = await indexManager.getIndex("users", "age");

      expect(index).toHaveLength(2);
      expect(index).toEqual(expect.arrayContaining(entries));
    });

    it("should update existing entries", async () => {
      // First add initial entries
      await indexManager.updateIndex("users", "age", [
        { key: 25, partitionKey: "p1", documentId: "doc1" },
      ]);

      // Update with new entry for same document
      const updatedEntry = { key: 26, partitionKey: "p1", documentId: "doc1" };
      await indexManager.updateIndex("users", "age", [updatedEntry]);

      const index = await indexManager.getIndex("users", "age");
      expect(index).toHaveLength(1);
      expect(index[0]).toEqual(updatedEntry);
    });
  });

  describe("findByIndex", () => {
    beforeEach(async () => {
      const entries = [
        { key: 25, partitionKey: "p1", documentId: "doc1" },
        { key: 30, partitionKey: "p1", documentId: "doc2" },
        { key: 25, partitionKey: "p2", documentId: "doc3" },
      ];
      await indexManager.updateIndex("users", "age", entries);
    });

    it("should find entries by exact value", async () => {
      const results = await indexManager.findByIndex("users", "age", 25);
      expect(results).toHaveLength(2);
      expect(results.every((entry: { key: number }) => entry.key === 25)).toBe(
        true
      );
    });

    it("should return empty array for non-existent value", async () => {
      const results = await indexManager.findByIndex("users", "age", 99);
      expect(results).toHaveLength(0);
    });
  });

  describe("findInRange", () => {
    beforeEach(async () => {
      const entries = [
        { key: 20, partitionKey: "p1", documentId: "doc1" },
        { key: 25, partitionKey: "p1", documentId: "doc2" },
        { key: 30, partitionKey: "p2", documentId: "doc3" },
        { key: 35, partitionKey: "p2", documentId: "doc4" },
      ];
      await indexManager.updateIndex("users", "age", entries);
    });

    it("should find entries in range inclusive", async () => {
      const results = await indexManager.findInRange("users", "age", 25, 30);
      expect(results).toHaveLength(2);
      results.forEach((entry: { key: any }) => {
        expect(entry.key).toBeGreaterThanOrEqual(25);
        expect(entry.key).toBeLessThanOrEqual(30);
      });
    });

    it("should return empty array for non-overlapping range", async () => {
      const results = await indexManager.findInRange("users", "age", 99, 100);
      expect(results).toHaveLength(0);
    });
  });

  describe("removeFromIndex", () => {
    beforeEach(async () => {
      const entries = [
        { key: 25, partitionKey: "p1", documentId: "doc1" },
        { key: 30, partitionKey: "p1", documentId: "doc2" },
        { key: 35, partitionKey: "p2", documentId: "doc3" },
      ];
      await indexManager.updateIndex("users", "age", entries);
    });

    it("should remove specified documents from index", async () => {
      await indexManager.removeFromIndex("users", "age", ["doc1", "doc2"]);
      const index = await indexManager.getIndex("users", "age");

      expect(index).toHaveLength(1);
      expect(index[0].documentId).toBe("doc3");
    });

    it("should handle removing non-existent documents", async () => {
      await indexManager.removeFromIndex("users", "age", ["non-existent"]);
      const index = await indexManager.getIndex("users", "age");

      expect(index).toHaveLength(3); // Original count unchanged
    });
  });
});
