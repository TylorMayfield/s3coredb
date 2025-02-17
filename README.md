# S3CoreDB

A simple node-based database using S3-compatible storage, perfect for building graph-like data structures and social networks.

## Quick Start

### Install

```bash
npm install s3coredb
```

### Connect

```typescript
import { S3CoreDB } from "s3coredb";
import { FileSystemStorageAdapter } from "s3coredb";

// Initialize with S3
const db = new S3CoreDB({
  endpoint: "YOUR_S3_ENDPOINT",      // e.g., 'http://localhost:4566' for LocalStack
  accessKeyId: "YOUR_KEY",
  secretAccessKey: "YOUR_SECRET",
  bucket: "YOUR_BUCKET",
  s3ForcePathStyle: true            // Required for LocalStack/MinIO
});

// Or use FileSystem adapter for local development
const adapter = new FileSystemStorageAdapter('db-data');
const localDb = new S3CoreDB(s3Config, adapter);
```

### Basic Usage

```typescript
// Create user nodes with properties
const alice = await db.createNode({
  type: "user",
  properties: { 
    name: "Alice",
    interests: ["coding", "graph databases"],
    joinDate: new Date().toISOString()
  },
  permissions: ["read"]
});

const bob = await db.createNode({
  type: "user",
  properties: { 
    name: "Bob",
    interests: ["photography", "databases"],
    joinDate: new Date().toISOString()
  },
  permissions: ["read"]
});

// Create relationships with properties
await db.createRelationship({
  from: alice.id,
  to: bob.id,
  type: "FOLLOWS",
  permissions: ["read"],
  properties: {
    since: new Date().toISOString(),
    notificationPreference: "all"
  }
});

// Query followers
const bobFollowers = await db.queryRelatedNodes(
  bob.id,
  "FOLLOWS",
  { userPermissions: ["read"], isAdmin: false },
  { direction: "IN" }
);

// Query by property
const techUsers = await db.queryNodes({
  type: "user",
  "properties.interests": ["coding", "databases"]
});
```

## Features

- 🏗️ Graph-like data structure with nodes and relationships
- 🔐 Built-in permissions system
- 🔍 Flexible querying by properties and relationships
- 💾 Works with S3 or local filesystem storage
- 🔄 TypeScript support
- 📑 Property-based indexing
- ⚡ Simple and intuitive API

## Examples

Check out our [examples directory](examples/) for complete implementations, including:
- Social Network POC
- More coming soon...

## Need Help?

Visit our [GitHub repository](https://github.com/TylorMayfield/s3coredb) for detailed documentation and more examples.
