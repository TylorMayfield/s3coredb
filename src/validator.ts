import { Node, Relationship } from './types';
import { ValidationError } from './errors';

export class Validator {
    private static readonly MAX_TYPE_LENGTH = 100;
    private static readonly MAX_PROPERTY_KEY_LENGTH = 100;
    private static readonly MAX_PROPERTY_VALUE_SIZE = 1024 * 1024; // 1MB
    private static readonly MAX_PROPERTIES_COUNT = 1000;
    private static readonly VALID_TYPE_PATTERN = /^[a-zA-Z0-9_-]+$/;
    private static readonly VALID_KEY_PATTERN = /^[a-zA-Z0-9_.-]+$/;
    private static readonly RESERVED_KEYS = ['__proto__', 'constructor', 'prototype'];

    static validateNodeType(type: string): void {
        if (!type || typeof type !== 'string') {
            throw new ValidationError('type', 'Type must be a non-empty string');
        }

        if (type.length > this.MAX_TYPE_LENGTH) {
            throw new ValidationError('type', `Type exceeds maximum length of ${this.MAX_TYPE_LENGTH}`, type.length);
        }

        if (!this.VALID_TYPE_PATTERN.test(type)) {
            throw new ValidationError('type', 'Type must contain only alphanumeric characters, hyphens, and underscores', type);
        }
    }

    static validateProperties(properties: any): void {
        if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
            throw new ValidationError('properties', 'Properties must be a non-null object');
        }

        const keys = Object.keys(properties);
        if (keys.length > this.MAX_PROPERTIES_COUNT) {
            throw new ValidationError('properties', `Exceeds maximum properties count of ${this.MAX_PROPERTIES_COUNT}`, keys.length);
        }

        for (const key of keys) {
            this.validatePropertyKey(key);
            this.validatePropertyValue(key, properties[key]);
        }
    }

    private static validatePropertyKey(key: string): void {
        if (this.RESERVED_KEYS.includes(key)) {
            throw new ValidationError(key, 'Property key is reserved and cannot be used', key);
        }

        if (key.length > this.MAX_PROPERTY_KEY_LENGTH) {
            throw new ValidationError(key, `Property key exceeds maximum length of ${this.MAX_PROPERTY_KEY_LENGTH}`, key.length);
        }

        if (!this.VALID_KEY_PATTERN.test(key)) {
            throw new ValidationError(key, 'Property key must contain only alphanumeric characters, hyphens, underscores, and dots', key);
        }
    }

    private static validatePropertyValue(key: string, value: any): void {
        if (value === null || value === undefined) {
            return; // Allow null/undefined
        }

        const size = this.estimateSize(value);
        if (size > this.MAX_PROPERTY_VALUE_SIZE) {
            throw new ValidationError(key, `Property value size (${size} bytes) exceeds maximum of ${this.MAX_PROPERTY_VALUE_SIZE} bytes`);
        }

        // Check for potentially dangerous types
        if (typeof value === 'function') {
            throw new ValidationError(key, 'Property value cannot be a function');
        }

        if (typeof value === 'object' && value !== null) {
            // Recursively validate nested objects
            if (Array.isArray(value)) {
                value.forEach((item, index) => {
                    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
                        this.validateNestedObject(item, `${key}[${index}]`);
                    }
                });
            } else {
                this.validateNestedObject(value, key);
            }
        }
    }

    private static validateNestedObject(obj: any, path: string): void {
        for (const key of Object.keys(obj)) {
            if (this.RESERVED_KEYS.includes(key)) {
                throw new ValidationError(path, `Nested property key '${key}' is reserved`, key);
            }
        }
    }

    private static estimateSize(value: any): number {
        const json = JSON.stringify(value);
        return new TextEncoder().encode(json).length;
    }

    static validatePermissions(permissions: string[]): void {
        if (!Array.isArray(permissions)) {
            throw new ValidationError('permissions', 'Permissions must be an array');
        }

        if (permissions.length === 0) {
            throw new ValidationError('permissions', 'Permissions array cannot be empty');
        }

        for (const perm of permissions) {
            if (typeof perm !== 'string') {
                throw new ValidationError('permissions', 'Each permission must be a string', perm);
            }
            if (perm.length === 0 || perm.length > 50) {
                throw new ValidationError('permissions', 'Permission length must be between 1 and 50 characters', perm);
            }
        }
    }

    static validateNode(node: Partial<Node>, isCreation: boolean = false): void {
        // For creation, require all fields
        if (isCreation) {
            if (!node.type) {
                throw new ValidationError('type', 'Type is required');
            }
            if (!node.properties) {
                throw new ValidationError('properties', 'Properties must be a non-null object');
            }
            if (!node.permissions) {
                throw new ValidationError('permissions', 'Permissions are required');
            }
        }

        if (node.type) {
            this.validateNodeType(node.type);
        }

        if (node.properties !== undefined) {
            this.validateProperties(node.properties);
        }

        if (node.permissions !== undefined) {
            this.validatePermissions(node.permissions);
        }

        if (node.id && typeof node.id !== 'string') {
            throw new ValidationError('id', 'Node ID must be a string');
        }
    }

    static validateRelationship(relationship: Partial<Relationship>): void {
        if (relationship.from && typeof relationship.from !== 'string') {
            throw new ValidationError('from', 'Relationship from ID must be a string');
        }

        if (relationship.to && typeof relationship.to !== 'string') {
            throw new ValidationError('to', 'Relationship to ID must be a string');
        }

        if (relationship.type) {
            this.validateNodeType(relationship.type); // Same rules as node types
        }

        if (relationship.properties) {
            this.validateProperties(relationship.properties);
        }

        if (relationship.permissions) {
            this.validatePermissions(relationship.permissions);
        }
    }

    static sanitizeString(value: string, maxLength: number = 1000): string {
        return value.substring(0, maxLength).trim();
    }
}

export const DEFAULT_QUERY_LIMIT = 1000;
export const MAX_QUERY_LIMIT = 10000;

export function validateQueryLimit(limit?: number): number {
    if (limit === undefined) {
        return DEFAULT_QUERY_LIMIT;
    }

    if (typeof limit !== 'number' || limit < 1) {
        throw new ValidationError('limit', 'Query limit must be a positive number', limit);
    }

    if (limit > MAX_QUERY_LIMIT) {
        throw new ValidationError('limit', `Query limit exceeds maximum of ${MAX_QUERY_LIMIT}`, limit);
    }

    return limit;
}

