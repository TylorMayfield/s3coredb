import { Node, AuthContext, StorageAdapter, Relationship } from "./types";
import { logger } from './logger';

export abstract class BaseStorageAdapter implements StorageAdapter {
    abstract createNode(node: Node, auth: AuthContext): Promise<Node>;
    abstract getNode(id: string, auth: AuthContext): Promise<Node | null>;
    abstract getNodeTypeFromId(id: string): Promise<string | null>;
    abstract queryNodes(query: any, auth: AuthContext): Promise<Node[]>;
    abstract createRelationship(relationship: Relationship, auth: AuthContext): Promise<void>;
    abstract queryRelatedNodes(
        from: string,
        type: string,
        auth: AuthContext,
        options?: { direction?: "IN" | "OUT" }
    ): Promise<Node[]>;

    protected matchesQuery(node: Node, query: any): boolean {
        for (const key in query) {
            if (key.includes('.')) {
                const queryValue = query[key];
                const nodeValue = this.getNestedValue(node, key);
                
                if (Array.isArray(nodeValue)) {
                    if (Array.isArray(queryValue)) {
                        if (!queryValue.some(v => nodeValue.includes(v))) {
                            return false;
                        }
                    } else {
                        if (!nodeValue.includes(queryValue)) {
                            return false;
                        }
                    }
                } else if (queryValue !== nodeValue) {
                    return false;
                }
            } else {
                if (query[key] !== node[key]) {
                    return false;
                }
            }
        }
        return true;
    }

    protected getNestedValue(obj: any, path: string): any {
        return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
    }

    protected canAccessNode(node: Node, auth: AuthContext): boolean {
        if (auth.isAdmin) return true;
        return node.permissions.some(perm => auth.userPermissions.includes(perm));
    }

    protected matchesRelationshipQuery(
        relationship: Relationship,
        from: string,
        type: string,
        direction?: "IN" | "OUT"
    ): boolean {
        if (relationship.type !== type) return false;
        return !direction || 
            (direction === "OUT" && relationship.from === from) ||
            (direction === "IN" && relationship.to === from);
    }

    protected validateNode(node: Node): void {
        if (!node.type || typeof node.type !== 'string') {
            throw new Error('Node must have a valid type string');
        }
        if (!node.permissions || !Array.isArray(node.permissions)) {
            throw new Error('Node must have a permissions array');
        }
        if (!node.properties || typeof node.properties !== 'object') {
            throw new Error('Node must have a properties object');
        }
    }

    protected validateRelationship(relationship: Relationship): void {
        if (!relationship.from || typeof relationship.from !== 'string') {
            throw new Error('Relationship must have a valid from ID');
        }
        if (!relationship.to || typeof relationship.to !== 'string') {
            throw new Error('Relationship must have a valid to ID');
        }
        if (!relationship.type || typeof relationship.type !== 'string') {
            throw new Error('Relationship must have a valid type string');
        }
    }
}