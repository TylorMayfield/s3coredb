# S3CoreDB

S3CoreDB is a lightweight document database built on top of Amazon S3, providing versioning, access control, and simple CRUD operations. It's perfect for applications that need a simple document store with versioning capabilities while leveraging S3's durability and scalability.

## Features

- Document-based storage using S3
- Built-in versioning system
- Access control (ACL) support
- TypeScript support
- Async/await API
- Version history tracking
- Diff computation between versions

## Installation

```bash
npm install s3coredb
```

## Configuration

First, configure S3CoreDB with your AWS credentials:

```typescript
import { S3CoreDB } from "s3coredb";

const db = new S3CoreDB({
  accessKeyId: "YOUR_ACCESS_KEY_ID",
  secretAccessKey: "YOUR_SECRET_ACCESS_KEY",
  // Optional: custom endpoint for using with S3-compatible services
  endpoint: new AWS.Endpoint("http://your-endpoint"),
});
```

## Usage Examples

### Basic CRUD Operations

```typescript
// Create a new document
const newDoc = await db.create("my-bucket", {
  _id: "user123",
  name: "John Doe",
  email: "john@example.com",
});

// Read a document
const doc = await db.get("my-bucket", "user123");

// Update a document
const updatedDoc = await db.update("my-bucket", {
  _id: "user123",
  name: "John Smith",
  email: "john@example.com",
});

// Delete a document
await db.delete("my-bucket", "user123");
```

### Working with Versions

```typescript
// Get version history of a document
const history = await db.getVersionHistory("my-bucket", "user123");

// Get a specific version
const oldVersion = await db.getVersion("my-bucket", "user123", 2);

// Compare versions
const currentDoc = await db.get("my-bucket", "user123");
const diff = db.computeDiff(oldVersion, currentDoc);
```

### Access Control

```typescript
// Create a document with ACL
const docWithAcl = await db.create("my-bucket", {
  _id: "sensitive-doc",
  content: "confidential",
  _acl: {
    owner: "admin",
    readAccess: ["user1", "user2"],
    writeAccess: ["user1"],
    deleteAccess: ["admin"],
  },
});

// Access with security context
const securityContext = {
  userId: "user1",
  roles: ["reader"],
};

const doc = await db.get("my-bucket", "sensitive-doc", securityContext);
```

### Batch Operations

```typescript
// Batch get
const docs = await db.batchGet("my-bucket", ["id1", "id2", "id3"]);

// Batch update
const updates = [
  { _id: "id1", name: "Updated 1" },
  { _id: "id2", name: "Updated 2" },
];
const updatedDocs = await db.batchUpdate("my-bucket", updates);
```

## TypeScript Support

S3CoreDB is written in TypeScript and provides type definitions out of the box. You can define your document types:

```typescript
interface UserDoc extends DataItem {
  name: string;
  email: string;
  age?: number;
}

const user = await db.create<UserDoc>("my-bucket", {
  _id: "user1",
  name: "Jane Doe",
  email: "jane@example.com",
});
```

## Data Types

### DataItem

Base interface for all documents:

```typescript
interface DataItem {
  _id: string;
  _acl?: AccessControl;
  _version?: number;
  _lastModified?: string;
  _history?: VersionMetadata[];
  [key: string]: any;
}
```

### AccessControl

```typescript
interface AccessControl {
  owner: string;
  readAccess?: string[];
  writeAccess?: string[];
  deleteAccess?: string[];
}
```

### VersionMetadata

```typescript
interface VersionMetadata {
  version: number;
  timestamp: string;
  userId: string;
  changes: FieldChange[];
}
```

## Error Handling

S3CoreDB throws typed errors that you can catch and handle:

```typescript
try {
  const doc = await db.get("my-bucket", "non-existent-id");
} catch (error) {
  if (error instanceof DocumentNotFoundError) {
    console.log("Document not found");
  } else if (error instanceof AccessDeniedError) {
    console.log("Access denied");
  } else {
    console.log("Unknown error:", error);
  }
}
```

## Best Practices

1. Always provide security contexts when dealing with sensitive data
2. Use TypeScript interfaces to ensure type safety
3. Handle version conflicts appropriately
4. Implement proper error handling
5. Use batch operations when dealing with multiple documents
6. Keep document sizes reasonable (S3 has a 5TB object size limit)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
