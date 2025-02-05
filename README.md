# S3CoreDB

A TypeScript library for using S3-compatible storage as a scalable, relational, node-based database with built-in indexing, access control, and individual object storage.

## Introduction

S3CoreDB leverages the power and scalability of S3-compatible object storage to provide a flexible and cost-effective solution for storing and querying relational data. It stores each data object (node) as a separate JSON file within your S3 bucket, enabling efficient retrieval and management. It offers features like node-based relationships, indexing for fast lookups, and granular access control. It's designed to work with various S3 providers, giving you flexibility in your infrastructure choices.

## Features

- **Relational Node-Based Database:** Store data as interconnected nodes with relationships, enabling complex data structures.
- **Scalability:** Built on S3-compatible storage, S3CoreDB scales effortlessly to handle growing data needs.
- **Indexing:** Built-in indexing capabilities ensure fast and efficient data retrieval.
- **Access Control:** Fine-grained access control mechanisms to secure your data.
- **Individual Object Storage:** Each data object (node) is stored as its own JSON file for efficient management.
- **TypeScript Support:** Fully typed for a seamless development experience.
- **S3-Compatible:** Works with various S3 providers (AWS, MinIO, Ceph, etc.).

## Installation

```bash
npm install s3coredb
```

## Usage

### Connecting to S3CoreDB

```typescript
import { S3CoreDB } from "s3coredb";

const db = new S3CoreDB({
  endpoint: "YOUR_S3_ENDPOINT", // e.g., 's3.amazonaws.com', 'play.min.io:9000'
  accessKeyId: "YOUR_ACCESS_KEY_ID",
  secretAccessKey: "YOUR_SECRET_ACCESS_KEY",
  region: "YOUR_S3_REGION", // Optional, depends on the provider
  bucket: "YOUR_S3_BUCKET_NAME", // The main bucket for metadata and objects
  s3ForcePathStyle: true, // Required for MinIO and some other providers
});
```

### Creating Nodes

```typescript
const userNode = await db.createNode({
  type: "user",
  properties: {
    name: "John Doe",
    email: "johndoe@example.com",
  },
});

const productNode = await db.createNode({
  type: "product",
  properties: {
    name: "Awesome Widget",
    price: 29.99,
  },
});

const reviewNode = await db.createNode({
  type: "review",
  properties: {
    rating: 5,
    text: "This widget is amazing!",
  },
});

console.log(userNode.id); // Unique ID of the created user node
console.log(productNode.id); // Unique ID of the created product node
console.log(reviewNode.id); // Unique ID of the created review node
```

### Creating Relationships

```typescript
// User "John Doe" purchased "Awesome Widget"
await db.createRelationship(userNode.id, productNode.id, "PURCHASED");

// User "John Doe" wrote a review for "Awesome Widget"
await db.createRelationship(userNode.id, reviewNode.id, "WROTE_REVIEW");

// "Awesome Widget" has a review
await db.createRelationship(productNode.id, reviewNode.id, "HAS_REVIEW");
```

### Retrieving a Node

```typescript
const retrievedUserNode = await db.getNode(userNode.id);
console.log(retrievedUserNode.properties.name); // Output: John Doe
```

### Querying Nodes

#### Example 1: Finding users with a specific name

```typescript
const users = await db.queryNodes({
  type: "user",
  "properties.name": "John Doe", // Conditional query
});
console.log(users);
```

#### Example 2: Finding users created after a certain date (if you have a createdAt property)

```typescript
const recentUsers = await db.queryNodes({
  type: "user",
  "properties.createdAt": { $gt: "2024-01-01" }, // Example using a greater-than condition
});
console.log(recentUsers);
```

#### Example 3: Finding users with a specific email domain

```typescript
const usersWithSpecificDomain = await db.queryNodes({
  type: "user",
  "properties.email": { regex: "@example.com" }, // Example using regular expression
});
console.log(usersWithSpecificDomain);
```

#### Example 4: Finding products purchased by a user

```typescript
const products = await db.queryRelatedNodes(userNode.id, "PURCHASED"); // Get related products
console.log(products);
```

#### Example 5: Finding reviews written by a user

```typescript
const reviews = await db.queryRelatedNodes(userNode.id, "WROTE_REVIEW");
console.log(reviews);
```

#### Example 6: Finding the user who wrote a review

```typescript
const userWhoReviewed = await db.queryRelatedNodes(
  reviewNode.id,
  "WROTE_REVIEW",
  { direction: "IN" }
);
console.log(userWhoReviewed);
```
