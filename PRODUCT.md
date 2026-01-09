# 🗺️ Product Roadmap & Functional Specs

> **Mission:** To provide a scalable, serverless graph database experience on top of commodity storage (S3), enabling complex data modeling without dedicated graph database infrastructure.

## 📍 Current Capabilities

S3CoreDB currently provides a production-ready (Score: 8/10) graph database engine with the following features:

### Core Data Model
*   **Nodes & Relationships:** Full graph data modeling support.
*   **CRUD Operations:** Create, Read, Update, and Delete for both Nodes and Relationships.
*   **Storage Agnostic:** Adapters for AWS S3, Local FileSystem, and In-Memory storage.
*   **Type Safety:** TypeScript-first design with comprehensive type definitions.

### Data Integrity & Safety
*   **Input Validation:** Comprehensive validation for types, property sizes (max 1MB), and structure.
*   **Optimistic Locking:** Version-based concurrency control to prevent lost updates.
*   **DoS Protection:** Configurable query limits (default 1000, max 10000) and pagination.
*   **Security:** Prevention against prototype pollution, path traversal, and code injection.

### Querying
*   **Advanced Filtering:** Filter nodes by property values.
*   **Graph Traversal:** Query related nodes with directionality (IN/OUT) and depth control.
*   **Pagination:** Limit and offset support for large datasets.

### Developer Experience
*   **TypeScript First:** Full type safety and IntelliSense.
*   **Custom Errors:** Structured error hierarchy (e.g., `NodeNotFoundError`, `PermissionDeniedError`) for reliable error handling.

---

## 🗺️ The Roadmap

### 🏗️ Now (Active Development)
*   **Post-Release Stabilization:** Monitoring feedback from the v1.0 release.
*   **Documentation:** Improving API references and "How-to" guides.

### 🗓️ Next (Prioritized)
These features are prioritized for the next release cycle (v1.1) to address remaining architectural gaps.

1.  **Relationship Uniqueness Constraints:**
    *   *Goal:* Prevent duplicate relationships (e.g., User A can only "FOLLOW" User B once).
    *   *Value:* Ensures data integrity for social graph use cases.
2.  **Bulk Operations:**
    *   *Goal:* `createNodesBulk`, `deleteNodesBulk`.
    *   *Value:* Significantly improve performance for data ingestion and migration.
3.  **Monitoring & Metrics:**
    *   *Goal:* expose `getMetrics()` for query latency, cache hit rates, and error rates.
    *   *Value:* Operational visibility for production deployments.
4.  **Audit Logging:**
    *   *Goal:* Track who changed what and when.
    *   *Value:* Security and compliance.

### 💡 Future (Backlog)
Ideas for the long-term vision, currently on hold or requiring further discovery.

*   **Transactions:** ACID compliance across multi-node operations (requires distributed locking strategy).
*   **Persistent Indexing:** Secondary indexes stored in S3 to speed up non-ID lookups.
*   **RBAC System:** Role hierarchies (Admin > Editor > Viewer) to replace the current simple permission string arrays.
*   **Plugin System:** Hooks for `beforeCreate`, `afterUpdate` to allow community extensions.
*   **GraphQL API:** A native GraphQL interface for querying the graph.

---

## ⚠️ Functional Constraints

*   **Consistency:** Eventual consistency when using S3 storage (read-after-write is usually consistent, but list operations may lag).
*   **Transactions:** No atomic multi-operation transactions. If a batch operation fails halfway, manual rollback is required.
*   **Performance:** Queries on properties without ID lookups involve scanning the shard/bucket, which is slower than indexed databases.
*   **Scale:** Optimized for "serverless" scale (millions of nodes), but not for high-frequency trading latency (sub-millisecond). S3 latency applies (typically 20-100ms).
*   **Limits:** Default query limit is 1,000 items; Max property value size is 1MB.
