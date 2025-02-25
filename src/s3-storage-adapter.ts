import { Node, AuthContext, StorageAdapter, Relationship, S3CoreDBConfig } from "./types";
import { BaseStorageAdapter } from "./base-storage-adapter";
import { S3NodeOperations } from "./s3-node-operations";
import { S3RelationshipOperations } from "./s3-relationship-operations";
import { logger } from './logger';

export class S3StorageAdapter extends BaseStorageAdapter implements StorageAdapter {
    private nodeOperations: S3NodeOperations;
    private relationshipOperations: S3RelationshipOperations;

    constructor(config: S3CoreDBConfig) {
        super();
        this.nodeOperations = new S3NodeOperations(config);
        this.relationshipOperations = new S3RelationshipOperations(config);
        logger.info('S3StorageAdapter initialized', { 
            endpoint: config.endpoint, 
            bucket: config.bucket 
        });
    }

    async createNode(node: Node, auth: AuthContext): Promise<Node> {
        this.validateNode(node);
        return this.nodeOperations.createNode(node, auth);
    }

    async getNode(id: string, auth: AuthContext): Promise<Node | null> {
        return this.nodeOperations.getNode(id, auth);
    }

    async getNodeTypeFromId(id: string): Promise<string | null> {
        return this.nodeOperations.getNodeTypeFromId(id);
    }

    async queryNodes(query: any, auth: AuthContext): Promise<Node[]> {
        return this.nodeOperations.queryNodes(query, auth);
    }

    async createRelationship(relationship: Relationship, auth: AuthContext): Promise<void> {
        this.validateRelationship(relationship);
        return this.relationshipOperations.createRelationship(relationship, auth);
    }

    async queryRelatedNodes(
        from: string,
        type: string,
        auth: AuthContext,
        options?: { direction?: "IN" | "OUT" }
    ): Promise<Node[]> {
        return this.relationshipOperations.queryRelatedNodes(from, type, auth, options);
    }

    async cleanup(): Promise<void> {
        try {
            // Clean up nodes
            const nodeTypes = await this.nodeOperations.listNodeTypes();
            for (const type of nodeTypes) {
                const nodes = await this.nodeOperations.listNodesOfType(type);
                for (const node of nodes) {
                    await this.nodeOperations.deleteNode(node);
                }
            }

            // Clean up relationships
            const relationshipTypes = await this.relationshipOperations.listRelationshipTypes();
            for (const type of relationshipTypes) {
                const relationships = await this.relationshipOperations.listRelationshipsOfType(type);
                for (const rel of relationships) {
                    await this.relationshipOperations.deleteRelationship(rel);
                }
            }

            logger.info('Cleaned up all data');
        } catch (error) {
            logger.error('Error during cleanup:', error);
            throw error;
        }
    }
}