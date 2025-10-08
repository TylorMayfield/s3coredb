<div align="center">

# 🗄️ S3CoreDB

**A powerful node-based graph database using S3-compatible storage**

[![npm version](https://img.shields.io/npm/v/s3coredb.svg)](https://www.npmjs.com/package/s3coredb)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)
[![Test Coverage](https://img.shields.io/badge/coverage-65%25-yellow)](./test-report.html)

*Build scalable graph-like data structures with S3 as your backend*

[Features](#-features) • [Installation](#-installation) • [Quick Start](#-quick-start) • [API](#-api-reference) • [Examples](#-examples)

</div>

---

## 🌟 Features

### Core Capabilities
- **🏗️ Graph Database Architecture** - Nodes and relationships for complex data modeling
- **🔐 Built-in Permission System** - Fine-grained access control at node and relationship level
- **🔍 Advanced Querying** - Filter by properties, traverse relationships, sort and paginate
- **💾 Flexible Storage** - S3, local filesystem, or in-memory adapters
- **⚡ High Performance** - Intelligent caching, sharding, and batch operations
- **🔄 CRUD Operations** - Complete Create, Read, Update, Delete support
- **🛡️ Data Validation** - Input validation with custom error handling
- **🔒 Optimistic Locking** - Version-based concurrency control
- **📊 Query Limits** - Built-in DoS protection with configurable limits
- **📝 TypeScript First** - Full type safety and IntelliSense support

### Storage Adapters
- **S3StorageAdapter** - AWS S3, MinIO, LocalStack
- **FileSystemStorageAdapter** - Local file storage for development
- **LocalStorageAdapter** - In-memory for testing

---

## 📦 Installation

```bash
npm install s3coredb
```

### Requirements
- Node.js 16+
- TypeScript 5.0+ (for TypeScript projects)
- S3-compatible storage (AWS S3, MinIO, or LocalStack) or local filesystem

---

## 🚀 Quick Start

### 1. Initialize Database

#### Using S3 Storage
```typescript
import { S3CoreDB } from 's3coredb';

const db = new S3CoreDB({
  endpoint: 'http://localhost:4566',  // LocalStack/MinIO
  accessKeyId: 'YOUR_KEY',
  secretAccessKey: 'YOUR_SECRET',
  bucket: 'my-database',
  s3ForcePathStyle: true
});
```

#### Using File System (Local Development)
```typescript
import { S3CoreDB, FileSystemStorageAdapter } from 's3coredb';

const adapter = new FileSystemStorageAdapter('./db-data');
const db = new S3CoreDB({
  endpoint: 'http://localhost:4566',
  accessKeyId: 'test',
  secretAccessKey: 'test',
  bucket: 'test-bucket'
}, adapter);
```

#### Using In-Memory (Testing)
```typescript
import { S3CoreDB, LocalStorageAdapter } from 's3coredb';

const adapter = new LocalStorageAdapter();
const db = new S3CoreDB(s3Config, adapter);
```

### 2. Create Nodes

```typescript
const alice = await db.createNode({
  type: 'user',
  properties: {
    name: 'Alice',
    email: 'alice@example.com',
    age: 28,
    interests: ['coding', 'hiking']
  },
  permissions: ['read', 'write']
});

const bob = await db.createNode({
  type: 'user',
  properties: {
    name: 'Bob',
    email: 'bob@example.com',
    age: 32
  },
  permissions: ['read']
});
```

### 3. Create Relationships

```typescript
await db.createRelationship({
  from: alice.id,
  to: bob.id,
  type: 'FOLLOWS',
  permissions: ['read'],
  properties: {
    since: new Date().toISOString(),
    notifications: true
  }
});
```

### 4. Query Data

```typescript
// Query nodes by properties
const users = await db.queryNodes({
  type: 'user',
  'properties.age': { $gte: 25, $lte: 35 }
});

// Traverse relationships
const followers = await db.queryRelatedNodes(
  bob.id,
  'FOLLOWS',
  { userPermissions: ['read'], isAdmin: false },
  { direction: 'IN' }
);

// Advanced queries with sorting and pagination
const recentUsers = await db.queryNodesAdvanced({
  type: 'user'
}, {
  sortBy: 'properties.createdAt',
  sortOrder: 'desc',
  limit: 10
});
```

### 5. Update and Delete

```typescript
// Update node
const updated = await db.updateNode(alice.id, {
  properties: {
    ...alice.properties,
    age: 29
  }
}, { userPermissions: ['write'], isAdmin: false });

// Delete node
await db.deleteNode(alice.id, { userPermissions: ['admin'], isAdmin: true });

// Update relationship
await db.updateRelationship(alice.id, bob.id, 'FOLLOWS', {
  properties: { notifications: false }
});

// Delete relationship
await db.deleteRelationship(alice.id, bob.id, 'FOLLOWS');
```

---

## 📚 API Reference

### Core Methods

#### Node Operations

```typescript
// Create a node
createNode(data: {
  type: string;
  properties: any;
  permissions: string[];
}, auth?: AuthContext): Promise<Node>

// Get a node by ID
getNode(id: string, auth?: AuthContext): Promise<Node | null>

// Update a node
updateNode(id: string, updates: Partial<Node>, auth?: AuthContext): Promise<Node>

// Delete a node
deleteNode(id: string, auth?: AuthContext): Promise<void>

// Query nodes
queryNodes(query: QueryOptions, auth?: AuthContext): Promise<Node[]>

// Advanced query with sorting/pagination
queryNodesAdvanced(
  query: QueryOptions,
  options: AdvancedQueryOptions,
  auth?: AuthContext
): Promise<Node[]>
```

#### Relationship Operations

```typescript
// Create a relationship
createRelationship(data: {
  from: string;
  to: string;
  type: string;
  permissions: string[];
  properties?: any;
}, auth?: AuthContext): Promise<Relationship>

// Update a relationship
updateRelationship(
  from: string,
  to: string,
  type: string,
  updates: Partial<Relationship>,
  auth?: AuthContext
): Promise<Relationship>

// Delete a relationship
deleteRelationship(
  from: string,
  to: string,
  type: string,
  auth?: AuthContext
): Promise<void>

// Query related nodes
queryRelatedNodes(
  from: string,
  type: string,
  auth?: AuthContext,
  options?: RelationshipQueryOptions
): Promise<Node[]>
```

### Types

```typescript
interface Node {
  id: string;
  type: string;
  properties: Record<string, any>;
  permissions: string[];
  version: number;
}

interface Relationship {
  from: string;
  to: string;
  type: string;
  permissions: string[];
  properties?: Record<string, any>;
  version: number;
}

interface AuthContext {
  userPermissions: string[];
  isAdmin: boolean;
}

interface QueryOptions {
  type?: string;
  [key: string]: any;  // Property filters
}

interface AdvancedQueryOptions {
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}
```

### Error Handling

S3CoreDB provides custom error types for better error handling:

```typescript
import {
  NodeNotFoundError,
  RelationshipNotFoundError,
  PermissionDeniedError,
  ValidationError,
  ConcurrentModificationError
} from 's3coredb';

try {
  await db.updateNode(nodeId, updates);
} catch (error) {
  if (error instanceof NodeNotFoundError) {
    console.log('Node does not exist');
  } else if (error instanceof PermissionDeniedError) {
    console.log('Access denied');
  } else if (error instanceof ConcurrentModificationError) {
    console.log('Version conflict - retry update');
  }
}
```

---

## 💡 Examples

### Social Network

```typescript
// Create users
const users = await Promise.all([
  db.createNode({ type: 'user', properties: { name: 'Alice' }, permissions: ['read'] }),
  db.createNode({ type: 'user', properties: { name: 'Bob' }, permissions: ['read'] }),
  db.createNode({ type: 'user', properties: { name: 'Charlie' }, permissions: ['read'] })
]);

// Create posts
const post = await db.createNode({
  type: 'post',
  properties: {
    content: 'Hello World!',
    createdAt: new Date().toISOString()
  },
  permissions: ['read']
});

// Create relationships
await db.createRelationship({
  from: users[0].id,
  to: users[1].id,
  type: 'FOLLOWS',
  permissions: ['read']
});

await db.createRelationship({
  from: users[0].id,
  to: post.id,
  type: 'POSTED',
  permissions: ['read']
});

// Query: Get all posts by Alice
const alicePosts = await db.queryRelatedNodes(
  users[0].id,
  'POSTED',
  { userPermissions: ['read'], isAdmin: false },
  { direction: 'OUT' }
);

// Query: Get Alice's followers
const aliceFollowers = await db.queryRelatedNodes(
  users[0].id,
  'FOLLOWS',
  { userPermissions: ['read'], isAdmin: false },
  { direction: 'IN' }
);
```

### Complete Examples

Check out our [examples directory](examples/) for full implementations:

- 🎯 **[CRUD Operations](examples/crud-example.ts)** - Complete guide to Create, Read, Update, Delete with error handling
- 📱 **[Social Network POC](examples/social-network-poc.ts)** - Full social network with users, posts, and relationships
- 🐕 **[Dog Training Tracker](examples/dog-training-poc.ts)** - Track dog training progress and relationships
- ⚡ **[Benchmark Suite](examples/benchmark-poc.ts)** - Performance testing and optimization

Run examples:
```bash
npm run crud          # CRUD operations example
npm run poc           # Social network example
npm run benchmark     # Performance benchmarks
```

---

## 🔧 Configuration

### Permission System

```typescript
// Set default auth context
db.setDefaultAuthContext({
  userPermissions: ['read', 'write'],
  isAdmin: false
});

// Override per operation
const node = await db.getNode(nodeId, {
  userPermissions: ['admin'],
  isAdmin: true
});
```

### Query Limits

```typescript
// Default limit: 100
// Max limit: 1000

const nodes = await db.queryNodes(
  { type: 'user' },
  { userPermissions: ['read'], isAdmin: false },
  { limit: 50 }  // Custom limit
);
```

### Batch Operations

```typescript
// Enable batch mode for better performance
adapter.startBatch();

for (const data of largeDataset) {
  await db.createNode(data);
}

await adapter.commitBatch();
```

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

Current test coverage: **65%** with **202/209 tests passing**

---

## 🏗️ Architecture

### Storage Layers
```
┌─────────────────────────────────┐
│         S3CoreDB API            │
├─────────────────────────────────┤
│     Base Storage Adapter        │
│  (Validation, Caching, Auth)    │
├─────────────────────────────────┤
│   Storage Implementation        │
│  S3 │ FileSystem │ LocalStorage │
├─────────────────────────────────┤
│     Cache Manager & Sharding    │
└─────────────────────────────────┘
```

### Key Components
- **CacheManager** - In-memory caching with TTL and indexing
- **ShardManager** - Hash-based data distribution
- **Validator** - Input validation and sanitization
- **Logger** - Winston-based structured logging

---

## 🤝 Contributing

We welcome contributions! Here's how to get started:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and add tests
4. Run tests: `npm test`
5. Commit: `git commit -m 'Add amazing feature'`
6. Push: `git push origin feature/amazing-feature`
7. Open a Pull Request

### Development Setup

```bash
# Clone the repo
git clone https://github.com/TylorMayfield/s3coredb.git
cd s3coredb

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test
```

---

## 📄 License

ISC License - see [LICENSE](LICENSE) file for details

---

## 🙏 Acknowledgments

Built with:
- [AWS SDK for JavaScript](https://aws.amazon.com/sdk-for-javascript/)
- [Winston](https://github.com/winstonjs/winston) for logging
- [Jest](https://jestjs.io/) for testing
- [TypeScript](https://www.typescriptlang.org/) for type safety

---

## 📞 Support

- 📫 [GitHub Issues](https://github.com/TylorMayfield/s3coredb/issues)
- 💬 [Discussions](https://github.com/TylorMayfield/s3coredb/discussions)
- 📧 Contact: [Your Email]

---

<div align="center">

**[⬆ Back to Top](#️-s3coredb)**

Made with ❤️ by the S3CoreDB team

</div>
