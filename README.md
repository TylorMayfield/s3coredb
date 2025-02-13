# S3CoreDB

A simple node-based database using S3-compatible storage.

## Quick Start

### Install

```bash
npm install s3coredb
```

### Connect

```typescript
import { S3CoreDB } from "s3coredb";

const db = new S3CoreDB({
  endpoint: "YOUR_S3_ENDPOINT",      // e.g., 's3.amazonaws.com'
  accessKeyId: "YOUR_KEY",
  secretAccessKey: "YOUR_SECRET",
  bucket: "YOUR_BUCKET",
  s3ForcePathStyle: true            // Required for MinIO
});
```

### Basic Usage

```typescript
// Create a user node
const user = await db.createNode({
  type: "user",
  properties: {
    name: "John",
    email: "john@example.com"
  }
});

// Create a product node
const product = await db.createNode({
  type: "product",
  properties: {
    name: "Cool Widget",
    price: 19.99
  }
});

// Create a relationship (user purchased product)
await db.createRelationship({
  from: user.id,
  to: product.id,
  type: "PURCHASED"
});

// Get a node by ID
const foundUser = await db.getNode(user.id);

// Query nodes
const users = await db.queryNodes({
  type: "user",
  "properties.name": "John"
});

// Find related nodes
const purchases = await db.queryRelatedNodes(user.id, "PURCHASED");
```

## Features

- Store data as nodes with relationships
- Works with any S3-compatible storage
- TypeScript support
- Simple querying
- Built-in indexing
- Access control

## Need More?

Check out our [GitHub repository](https://github.com/yourusername/s3coredb) for detailed documentation, examples, and advanced features.
