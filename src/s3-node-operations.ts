import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { Node, S3CoreDBConfig } from "./types";

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

  async createNode(node: Node): Promise<Node> {
    const params = {
      Bucket: this.bucket,
      Key: `${node.type}/${node.id}.json`,
      Body: JSON.stringify(node),
      ContentType: "application/json",
    };

    try {
      const command = new PutObjectCommand(params);
      await this.s3.send(command);
      return node;
    } catch (error) {
      console.error("Error creating node:", error);
      throw error;
    }
  }

  async getNode(id: string): Promise<Node | null> {
    try {
      const nodeType = await this.getNodeTypeFromId(id);
      if (!nodeType) {
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
        return JSON.parse(bodyContents);
      } else {
        return null;
      }
    } catch (error) {
      console.error("Error getting node:", error);
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
                return nodeType; // Exit the inner loop since we found the node
              }
            } catch (error) {
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

  async queryNodes(query: any): Promise<Node[]> {
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
                        if (this.matchesQuery(node, query)) {
                          results.push(node);
                        }
                      }
                    } catch (error) {
                      console.error(
                        `Failed to get object: ${object.Key}, Error:`,
                        error
                      );
                    }
                  }
                }
              }
            } catch (error) {
              console.error(
                `Failed to list objects under prefix ${prefix.Prefix}`,
                error
              );
            }
          }
        }
      }
    } while (prefixData.NextContinuationToken !== undefined);

    return results;
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
