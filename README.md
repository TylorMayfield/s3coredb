# S3CoreDB

S3CoreDB is a scalable document database built on top of Amazon S3, featuring time-based partitioning, indexing, and efficient querying capabilities. It's designed for applications that need to store and query JSON documents with automatic partition management and indexing support.

## Features

- Document-based storage using S3
- Time-based partitioning for efficient data management
- Automatic partition size management
- Secondary indexing support
- Flexible querying by time ranges and field values
- TypeScript support with full type safety
- Configurable S3 endpoint support (compatible with S3-like services)
- ACL (Access Control List) support

## Installation

```bash
npm install s3coredb
```

## Configuration

Configure S3CoreDB with your S3 credentials and settings:

```typescript
import { S3CoreDB } from "s3coredb";

const db = new S3CoreDB(
  s3_key: "YOUR_ACCESS_KEY_ID",
  s3_secret: "YOUR_SECRET_ACCESS_KEY",
  s3_bucket: "your-bucket-name",
  s3_prefix: "optional/prefix",  // Optional: prefix for all S3 keys
  s3_acl: "private",            // Optional: S3 ACL setting
  s3_endpoint: "http://your-endpoint"  // Optional: custom S3-compatible endpoint
);
```

## Usage Examples

### Collection Management

```typescript
// Create a collection with time-based partitioning
const collection = await db.createCollection("users", {
  strategy: "time",
  timeGranularity: "day",
  maxPartitionSize: 1024 * 1024, // 1MB
  indexing: {
    enabled: true,
    fields: ["name", "email"]  // Fields to index
  }
});

// Insert a document
const doc = await collection.insert({
  id: "user123",
  name: "John Doe",
  email: "john@example.com",
  timestamp: new Date()
});

// Query by time range
const recentUsers = await collection.find({
  timestamp: {
    start: new Date("2025-01-16T00:00:00Z"),
    end: new Date("2025-01-16T23:59:59Z")
  }
});

// Query by indexed field
const usersByName = await collection.findByIndex("name", "John Doe");
```

## Key Components

### 1. Collection Management
- Collections are the top-level containers for documents
- Each collection can be configured with its own partitioning and indexing strategy
- Automatic metadata management for collections

### 2. Time-based Partitioning
- Documents are automatically partitioned based on their timestamp
- Configurable time granularity (year, month, day, hour)
- Automatic partition size management
- Efficient querying of specific time ranges

### 3. Indexing
- Secondary indexes for fast field-based queries
- Automatic index updates on document changes
- Support for multiple indexed fields per collection

### 4. S3 Integration
- Built on top of AWS S3 for reliable storage
- Support for custom S3-compatible endpoints
- Configurable ACLs for security
- Efficient data retrieval using S3 list operations

## Best Practices

1. **Partitioning Strategy**:
   - Choose appropriate time granularity based on your data volume
   - Set reasonable partition size limits
   - Consider your query patterns when configuring partitions

2. **Indexing**:
   - Index only frequently queried fields
   - Be mindful of storage overhead for indexes
   - Use findByIndex for better query performance on indexed fields

3. **Data Organization**:
   - Include timestamp field in documents for time-based partitioning
   - Use consistent ID fields in documents
   - Consider data access patterns when designing document structure

## Error Handling

The library includes built-in error handling for common scenarios:
- S3 access errors
- Invalid partition configurations
- Index-related errors
- Document validation errors

## TypeScript Support

S3CoreDB is written in TypeScript and provides full type safety:
- Generic type support for document structures
- Type-safe query operations
- Comprehensive type definitions for all APIs

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
