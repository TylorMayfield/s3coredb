# Changelog

All notable changes to S3CoreDB will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-10-08

### Added
- 🎉 Initial release of S3CoreDB
- Complete CRUD operations for nodes and relationships
- Advanced querying with filtering, sorting, and pagination
- Built-in permission system with fine-grained access control
- Input validation with custom error types
- Optimistic locking with version-based concurrency control
- Query limits for DoS protection (default: 100, max: 1000)
- Three storage adapters:
  - `S3StorageAdapter` for AWS S3, MinIO, LocalStack
  - `FileSystemStorageAdapter` for local development
  - `LocalStorageAdapter` for in-memory testing
- Intelligent caching with TTL and property indexing
- Hash-based sharding for data distribution
- Custom error types:
  - `NodeNotFoundError`
  - `RelationshipNotFoundError`
  - `PermissionDeniedError`
  - `ValidationError`
  - `ConcurrentModificationError`
- Comprehensive test suite (65% coverage, 202/209 tests passing)
- TypeScript support with full type definitions
- Examples:
  - Social Network POC
  - Dog Training Tracker
  - Benchmark Suite
- CI/CD with GitHub Actions
- Documentation and README

### Features in Detail

#### Node Operations
- Create nodes with type, properties, and permissions
- Get node by ID with permission checks
- Update nodes with optimistic locking
- Delete nodes with cascade options
- Query nodes by properties with advanced filters
- Batch operations for performance

#### Relationship Operations
- Create typed relationships between nodes
- Update relationship properties
- Delete relationships
- Traverse relationships (IN/OUT/BOTH directions)
- Query related nodes with filters

#### Security & Validation
- Permission-based access control
- Input validation for nodes and relationships
- Protection against prototype pollution
- DoS protection with query limits
- Secure error messages (no information leakage)

#### Performance
- In-memory caching with configurable TTL
- Property-based indexes (compound, range, prefix)
- Traversal caching for graph queries
- Batch mode for bulk operations
- Hash-based sharding

### Technical Details
- Built with TypeScript 5.3
- AWS SDK v3 for S3 operations
- Winston for structured logging
- Jest for testing
- Support for Node.js 16+

---

## [Unreleased]

### Planned Features
- Transaction support with rollback
- Relationship constraints and uniqueness
- Bulk import/export utilities
- GraphQL API layer
- Real-time subscriptions
- Migration system for schema changes
- Additional storage adapters (Redis, MongoDB, etc.)
- Enhanced monitoring and metrics
- Role-based access control (RBAC)
- Encryption at rest
- Audit logging

---

## Release History

- **1.0.0** (2025-10-08) - Initial release

---

For more details, see the [GitHub Releases](https://github.com/TylorMayfield/s3coredb/releases) page.

