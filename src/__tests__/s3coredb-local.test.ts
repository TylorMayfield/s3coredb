import { S3CoreDB } from "../S3CoreDB";
import { Node, AuthContext } from "../types";
import { LocalStorageAdapter } from "../local-storage-adapter";

const authContext: AuthContext = {
  userPermissions: ["create", "read"],
  isAdmin: false,
};

let db: S3CoreDB;

beforeAll(() => {
  const adapter = new LocalStorageAdapter();
  db = new S3CoreDB(
    {
      endpoint: "http://localhost:4566",
      accessKeyId: "test",
      secretAccessKey: "test",
      bucket: "test-bucket",
      s3ForcePathStyle: true,
    },
    adapter
  );
  db.setDefaultAuthContext(authContext);
});

describe("S3CoreDB Local Adapter", () => {
  it("should create a node", async () => {
    const nodeData = {
      type: "user",
      properties: { name: "John Doe", email: "john@example.com" },
      permissions: ["create"],
    };
    const node = await db.createNode(nodeData);
    expect(node).toHaveProperty("id");
    expect(node.properties.name).toBe("John Doe");
  });

  it("should retrieve a node", async () => {
    const nodeData = {
      type: "user",
      properties: { name: "Jane Doe", email: "jane@example.com" },
      permissions: ["read"],
    };
    const createdNode = await db.createNode(nodeData);
    const retrievedNode = await db.getNode(createdNode.id);
    expect(retrievedNode).not.toBeNull();
    expect(retrievedNode?.properties.email).toBe("jane@example.com");
  });

  it("should query nodes", async () => {
    const nodeData1 = {
      type: "user",
      properties: { name: "Alice", email: "alice@example.com" },
      permissions: ["read"],
    };
    const nodeData2 = {
      type: "user",
      properties: { name: "Bob", email: "bob@example.com" },
      permissions: ["read"],
    };
    await db.createNode(nodeData1);
    await db.createNode(nodeData2);

    const query = { type: "user", "properties.name": "Alice" };
    const results = await db.queryNodes(query);
    expect(results.length).toBe(1);
    expect(results[0].properties.email).toBe("alice@example.com");
  });

  it("should query nodes with multiple properties", async () => {
    const nodeData = {
      type: "user",
      properties: { name: "Charlie", email: "charlie@example.com", age: 25 },
      permissions: ["read"],
    };
    await db.createNode(nodeData);

    const query = {
      type: "user",
      "properties.name": "Charlie",
      "properties.age": 25,
    };
    const results = await db.queryNodes(query);
    expect(results.length).toBe(1);
    expect(results[0].properties.email).toBe("charlie@example.com");
  });

  it("should handle relationships between nodes", async () => {
    // Create users with all needed permissions
    const user1 = await db.createNode({
      type: "user",
      properties: { name: "User1" },
      permissions: ["read", "create", "restricted"],
    });

    const user2 = await db.createNode({
      type: "user",
      properties: { name: "User2" },
      permissions: ["read", "create", "restricted"],
    });

    // User1 FOLLOWS User2
    await db.createRelationship({
      from: user1.id,
      to: user2.id,
      type: "FOLLOWS",
      permissions: ["read", "create", "restricted"],
      properties: { since: new Date().toISOString() },
    });

    const testAuthContext: AuthContext = {
      userPermissions: ["read", "create", "restricted"],
      isAdmin: false,
    };
    db.setDefaultAuthContext(testAuthContext);

    // Query: "Who follows User2?" (incoming relationships to User2)
    const followers = await db.queryRelatedNodes(
      user2.id,
      "FOLLOWS",
      testAuthContext,
      { direction: "IN" }
    );
    expect(followers.length).toBe(1);
    expect(followers[0].properties.name).toBe("User1"); // User1 follows User2

    // Query: "Who does User1 follow?" (outgoing relationships from User1)
    const following = await db.queryRelatedNodes(
      user1.id,
      "FOLLOWS",
      testAuthContext,
      { direction: "OUT" }
    );
    expect(following.length).toBe(1);
    expect(following[0].properties.name).toBe("User2"); // User1 follows User2

    // Reset auth context for other tests
    db.setDefaultAuthContext(authContext);
  });

  it("should handle non-existent nodes gracefully", async () => {
    const nonExistentNode = await db.getNode("non-existent-id");
    expect(nonExistentNode).toBeNull();
  });

  it("should handle empty query results", async () => {
    const query = { type: "non-existent-type" };
    const results = await db.queryNodes(query);
    expect(results).toEqual([]);
  });

  it("should respect node permissions", async () => {
    // Set admin context first to create the restricted node
    const createAuthContext: AuthContext = {
      userPermissions: ["create", "read", "restricted"],
      isAdmin: false,
    };
    db.setDefaultAuthContext(createAuthContext);

    // Create a node with restricted permissions
    const restrictedNode = await db.createNode({
      type: "secret",
      properties: { content: "classified" },
      permissions: ["restricted"],
    });

    // Try to query with insufficient permissions
    const limitedAuthContext: AuthContext = {
      userPermissions: ["read"],
      isAdmin: false,
    };
    db.setDefaultAuthContext(limitedAuthContext);

    const results = await db.queryNodes({ type: "secret" });
    expect(results.length).toBe(0);

    // Verify we can see it with proper permissions
    const fullAuthContext: AuthContext = {
      userPermissions: ["restricted"],
      isAdmin: false,
    };
    db.setDefaultAuthContext(fullAuthContext);

    const restrictedResults = await db.queryNodes({ type: "secret" });
    expect(restrictedResults.length).toBe(1);

    // Reset auth context for other tests
    db.setDefaultAuthContext(authContext);
  });

  it("should find a user by name", async () => {
    const nodeData = {
      type: "user",
      properties: { name: "Eve", email: "eve@example.com" },
      permissions: ["read"],
    };
    await db.createNode(nodeData);

    const query = { type: "user", "properties.name": "Eve" };
    const results = await db.queryNodes(query);
    expect(results.length).toBe(1);
    expect(results[0].properties.email).toBe("eve@example.com");
  });

  it("should find nodes by type when multiple exist", async () => {
    const nodeData1 = {
      type: "document",
      properties: { title: "Doc1", content: "Content1" },
      permissions: ["read"],
    };
    const nodeData2 = {
      type: "document",
      properties: { title: "Doc2", content: "Content2" },
      permissions: ["read"],
    };
    await db.createNode(nodeData1);
    await db.createNode(nodeData2);

    const query = { type: "document" };
    const results = await db.queryNodes(query);
    expect(results.length).toBe(2);
    expect(results[0].properties.title).toBe("Doc1");
    expect(results[1].properties.title).toBe("Doc2");
  });
});
