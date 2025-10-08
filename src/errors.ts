/**
 * Custom error types for S3CoreDB
 */

export class S3CoreDBError extends Error {
    constructor(
        public code: string,
        public details: any,
        message: string
    ) {
        super(message);
        this.name = 'S3CoreDBError';
        Error.captureStackTrace(this, this.constructor);
    }
}

export class PermissionDeniedError extends S3CoreDBError {
    constructor(requiredPermissions: string[], userPermissions: string[], resource?: string) {
        super(
            'PERMISSION_DENIED',
            { 
                required: requiredPermissions, 
                actual: userPermissions,
                resource 
            },
            `Permission denied. Required one of: [${requiredPermissions.join(', ')}], Have: [${userPermissions.join(', ')}]${resource ? ` for ${resource}` : ''}`
        );
        this.name = 'PermissionDeniedError';
    }
}

export class NodeNotFoundError extends S3CoreDBError {
    constructor(nodeId: string) {
        super(
            'NODE_NOT_FOUND',
            { nodeId },
            `Node not found: ${nodeId}`
        );
        this.name = 'NodeNotFoundError';
    }
}

export class RelationshipNotFoundError extends S3CoreDBError {
    constructor(from: string, to: string, type: string) {
        super(
            'RELATIONSHIP_NOT_FOUND',
            { from, to, type },
            `Relationship not found: ${from} -[${type}]-> ${to}`
        );
        this.name = 'RelationshipNotFoundError';
    }
}

export class ValidationError extends S3CoreDBError {
    constructor(field: string, reason: string, value?: any) {
        super(
            'VALIDATION_ERROR',
            { field, reason, value },
            `Validation failed for ${field}: ${reason}`
        );
        this.name = 'ValidationError';
    }
}

export class DuplicateRelationshipError extends S3CoreDBError {
    constructor(from: string, to: string, type: string) {
        super(
            'DUPLICATE_RELATIONSHIP',
            { from, to, type },
            `Relationship already exists: ${from} -[${type}]-> ${to}`
        );
        this.name = 'DuplicateRelationshipError';
    }
}

export class QueryLimitExceededError extends S3CoreDBError {
    constructor(requested: number, maximum: number) {
        super(
            'QUERY_LIMIT_EXCEEDED',
            { requested, maximum },
            `Query limit exceeded: requested ${requested}, maximum allowed ${maximum}`
        );
        this.name = 'QueryLimitExceededError';
    }
}

export class ConcurrentModificationError extends S3CoreDBError {
    constructor(resourceId: string, expectedVersion: number, actualVersion: number) {
        super(
            'CONCURRENT_MODIFICATION',
            { resourceId, expectedVersion, actualVersion },
            `Concurrent modification detected for ${resourceId}: expected version ${expectedVersion}, found ${actualVersion}`
        );
        this.name = 'ConcurrentModificationError';
    }
}

