import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { Node, S3CoreDBConfig, AuthContext } from "./types";
import { logger } from './logger';

class S3NodeOperations {
  private s3: S3Client;
  private bucket: string;

  constructor(config: S3CoreDBConfig) {
    const s3Config = {
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.s3ForcePathStyle,
    };
    this.s3 = new S3Client(s3Config);
    this.bucket = config.bucket;
  }

  async createNode(node: Node, auth: AuthContext): Promise<Node> {
    // Validate permissions
    if (!this.canCreateWithPermissions(node.permissions, auth)) {
      logger.error('Permission denied for node creation', { 
        nodeId: node.id,
        nodeType: node.type,
        userPermissions: auth.userPermissions,
        requiredPermissions: node.permissions
      });
      throw new Error("Permission denied: Insufficient permissions to create node");
    }

    const params = {
      Bucket: this.bucket,
      Key: `${node.type}/${node.id}.json`,
      Body: JSON.stringify(node),
      ContentType: "application/json",
    };

    try {
      const command = new PutObjectCommand(params);
      await this.s3.send(command);
      logger.info('Node created successfully', { nodeId: node.id, nodeType: node.type });
      return node;
    } catch (error) {
      logger.error('Error creating node', { 
        nodeId: node.id, 
        nodeType: node.type, 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }

  async getNode(id: string, auth: AuthContext): Promise<Node | null> {
    try {
      const nodeType = await this.getNodeTypeFromId(id);
      if (!nodeType) {
        logger.info('Node type not found for ID', { nodeId: id });
        return null;
      }
      const params = {
        Bucket: this.bucket,
        Key: `${nodeType}/${id}.json`,
      };
      const command = new GetObjectCommand(params);
      const data = await this.s3.send(command);
      const bodyContents = await data.Body?.transformToString();
      if (bodyContents) {
        const node = JSON.parse(bodyContents);
        
        // Check permissions before returning the node
        if (!this.canAccessNode(node, auth)) {
          logger.warn('Permission denied for node access', { 
            nodeId: id, 
            nodeType,
            userPermissions: auth.userPermissions,
            nodePermissions: node.permissions
          });
          return null;
        }
        
        logger.info('Node retrieved successfully', { nodeId: id, nodeType });
        return node;
      } else {
        logger.warn('Node body empty', { nodeId: id, nodeType });
        return null;
      }
    } catch (error) {
      logger.error('Error getting node', { 
        nodeId: id, 
        error: error instanceof Error ? error.message : String(error) 
      });
      return null;
    }
  }

  async getNodeTypeFromId(id: string): Promise<string | null> {
    const prefixParams = {
      Bucket: this.bucket,
      Prefix: "/",
      Delimiter: "/",
    };
    let nodeType: string | null = null;
    let prefixData: any;

    do {
      prefixData = await this.s3.send(new ListObjectsV2Command(prefixParams));

      if (prefixData.CommonPrefixes) {
        for (const prefix of prefixData.CommonPrefixes) {
          if (prefix.Prefix) {
            const key = `${prefix.Prefix}${id}.json`;
            const getParams = {
              Bucket: this.bucket,
              Key: key,
            };
            try {
              const getObjectResult = await this.s3.send(
                new GetObjectCommand(getParams)
              );
              if (getObjectResult?.$metadata?.httpStatusCode === 200) {
                nodeType = prefix.Prefix.slice(0, -1);
                logger.debug('Found node type', { nodeId: id, nodeType });
                return nodeType; // Exit the inner loop since we found the node
              }
            } catch (error) {
              logger.debug('Node type not found', { nodeId: id, prefix: prefix.Prefix });
              return null; //Handle 404 and other errors by returning null.
            }
          }
        }
      }

      if (nodeType) {
        break;
      }
    } while (prefixData.NextContinuationToken !== undefined);

    return nodeType;
  }

  async queryNodes(query: any, auth: AuthContext): Promise<Node[]> {
    const results: Node[] = [];
    const prefixParams = {
      Bucket: this.bucket,
      Prefix: "/",
      Delimiter: "/",
    };

    let prefixData: any;
    do {
      prefixData = await this.s3.send(new ListObjectsV2Command(prefixParams));

      if (prefixData.CommonPrefixes) {
        for (const prefix of prefixData.CommonPrefixes) {
          if (prefix.Prefix) {
            const listParams = {
              Bucket: this.bucket,
              Prefix: prefix.Prefix,
            };

            try {
              const listedObjects = await this.s3.send(
                new ListObjectsV2Command(listParams)
              );

              if (listedObjects.Contents) {
                for (const object of listedObjects.Contents) {
                  if (object.Key) {
                    try {
                      const data = await this.s3.send(
                        new GetObjectCommand({
                          Bucket: this.bucket,
                          Key: object.Key,
                        })
                      );
                      const bodyContents = await data.Body?.transformToString();
                      if (bodyContents) {
                        const node = JSON.parse(bodyContents);
                        // Only include nodes that match both the query and permissions
                        if (this.matchesQuery(node, query) && this.canAccessNode(node, auth)) {
                          results.push(node);
                        }
                      }
                    } catch (error) {
                      logger.error('Failed to get object', { 
                        key: object.Key, 
                        error: error instanceof Error ? error.message : String(error) 
                      });
                    }
                  }
                }
              }
            } catch (error) {
              logger.error('Failed to list objects', { 
                prefix: prefix.Prefix, 
                error: error instanceof Error ? error.message : String(error) 
              });
            }
          }
        }
      }
    } while (prefixData.NextContinuationToken !== undefined);

    logger.info('Query completed', { 
      queryParams: query, 
      resultCount: results.length,
      userPermissions: auth.userPermissions
    });
    return results;
  }

  private canCreateWithPermissions(requiredPermissions: string[], auth: AuthContext): boolean {
    if (auth.isAdmin) return true;
    return requiredPermissions.some(perm => auth.userPermissions.includes(perm));
  }

  private canAccessNode(node: Node, auth: AuthContext): boolean {
    if (auth.isAdmin) return true;
    return node.permissions.some(perm => auth.userPermissions.includes(perm));
  }

  private matchesQuery(node: Node, query: any): boolean {
    if (!query) {
      return true;
    }
    for (const key in query) {
      if (query.hasOwnProperty(key)) {
        const queryValue = this.getNestedValue(query, key);
        const nodeValue = this.getNestedValue(node, key);

        if (queryValue instanceof RegExp) {
          if (typeof nodeValue !== "string" || !queryValue.test(nodeValue)) {
            return false;
          }
        } else if (Array.isArray(queryValue)) {
          if (
            !Array.isArray(nodeValue) ||
            !queryValue.every((item) => nodeValue.includes(item))
          ) {
            return false;
          }
        } else if (nodeValue !== queryValue) {
          return false;
        }
      }
    }
    return true;
  }

  private getNestedValue(obj: any, path: string): any {
    return path
      .split(".")
      .reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
  }
}

export { S3NodeOperations };
