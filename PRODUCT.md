# 🗺️ Product Roadmap & Functional Specs

> **Mission:** To provide a scalable, serverless graph database experience on top of commodity storage (S3), enabling complex data modeling without dedicated graph database infrastructure.

## 📍 Current Capabilities
*As of October 2025*

### Core Data Model
- **Graph Structure:** Nodes and Relationships with support for arbitrary properties.
- **CRUD Operations:** Full Create, Read, Update, Delete lifecycle for both nodes and relationships.
- **Type Safety:** TypeScript-first design with comprehensive type definitions.

### Data Integrity & Security
- **Input Validation:** Strict validation for types, property sizes, and reserved keys.
- **Optimistic Locking:** Version-based concurrency control to prevent lost updates.
- **Query Limits:** Configurable limits for result sets to prevent DoS and memory exhaustion.
- **Custom Errors:** Granular error types (e.g., `NodeNotFoundError`, `PermissionDeniedError`) for precise handling.

### Storage
- **Storage Agnostic:** Adapters for AWS S3, Local FileSystem, and In-Memory storage.
- **Sharding:** Hash-based distribution of nodes for scalable storage organization.

### Access Control
- **Permissions:** Fine-grained permission strings (e.g., `['read', 'write']`) at the node and relationship level.

---

## 🗺️ The Roadmap

### 🏗️ Now (Active Development)
*Focus: Stabilization & Documentation*
- **Post-Release Stabilization:** Monitoring feedback from the v1.0 release.
- **Documentation:** Updating guides and examples to reflect the new CRUD and Validation features.

### 🗓️ Next (Prioritized)
*Focus: Data Integrity & Operational Excellence*
1. **Relationship Uniqueness Constraints:** Prevent duplicate relationships between the same nodes.
2. **Bulk Operations:** `createNodesBulk` and `createRelationshipsBulk` for high-performance imports.
3. **Monitoring & Metrics:** Expose performance metrics (latency, cache hits) and operational logs.
4. **Audit Logging:** Track who changed what and when.

### 💡 Future (Backlog)
*Focus: Advanced Features & Ecosystem*
- **Transactions:** Multi-step atomic operations (likely via distributed locking).
- **RBAC:** Role-Based Access Control to replace simple permission strings.
- **Persistent Indexing:** Secondary indexes to speed up property-based queries without full scans.
- **Plugins:** Middleware system for extending functionality.

---

## ⚠️ Functional Constraints
- **Eventual Consistency:** Relying on S3 means data may not be immediately visible after write (storage adapter dependent).
- **No ACID Transactions:** Operations are atomic per-node/relationship, but multi-node operations are not transactional.
- **Query Performance:** Without persistent secondary indexes, property queries require scanning all nodes in a type shard.
- **Max Limits:** Default query limit is 1,000 items; Max property value size is 1MB.

---

## 🧊 Icebox (Deprioritized)
- **GraphQL API:** Nice-to-have but adds significant complexity.
- **Full-Text Search:** Better handled by dedicated search engines for now.
