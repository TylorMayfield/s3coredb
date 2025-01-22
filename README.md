# S3CoreDB

A TypeScript library for using Amazon S3 as a scalable document database with built-in sharding and access control.

## Features

- 🔐 **Access Control**: Fine-grained ACL support with owner, read, write, and delete permissions
- 🔄 **Sharding Strategies**: Supports multiple sharding approaches:
  - Hash-based sharding
  - Range-based sharding
  - Date-based sharding
- 🔒 **Security Context**: Role-based access control system
- 📝 **Versioning**: Built-in document versioning with change tracking
- 🔍 **Flexible Querying**: List and retrieve documents by shard
- 🎯 **Custom Endpoints**: Support for S3-compatible storage services

## Installation

```bash
npm install s3coredb
```

## Usage

```typescript
import { S3CoreDB } from "s3coredb";

// Initialize the database
const db = new S3CoreDB(
  "YOUR_ACCESS_KEY_ID",
  "YOUR_SECRET_ACCESS_KEY",
  "your-bucket-name",
  "prefix/", // optional
  "private", // default ACL
  undefined, // optional endpoint
  { userId: "user1", roles: ["admin"] }, // optional security context
  { strategy: "hash", shardCount: 10 } // optional sharding config
);

// Insert a document
await db.insert("users", {
  _id: "user123",
  name: "John Doe",
  email: "john@example.com",
});

// Retrieve a document
const user = await db.get("users", "user123");
```
