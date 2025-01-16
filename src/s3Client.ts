import AWS from 'aws-sdk';
import { S3DBConfig } from './types';

export class S3Client {
  private s3Bucket: AWS.S3;
  private s3_bucket: string;
  private s3_acl: string;
  private s3_prefix: string;

  constructor(
    s3_key: string,
    s3_secret: string,
    s3_bucket: string,
    s3_prefix: string = "",
    s3_acl: string = "private",
    s3_endpoint?: string
  ) {
    this.s3_bucket = s3_bucket;
    this.s3_prefix = s3_prefix;
    this.s3_acl = s3_acl;

    const s3_config: S3DBConfig = {
      accessKeyId: s3_key,
      secretAccessKey: s3_secret,
    };

    if (s3_endpoint) {
      const endpoint = new AWS.Endpoint(s3_endpoint);
      s3_config.endpoint = endpoint;
    }

    AWS.config.update(s3_config);

    this.s3Bucket = new AWS.S3({
      params: {
        Bucket: s3_bucket,
        timeout: 6000000,
      },
    });
  }

  async getObject(key: string): Promise<any> {
    const params = {
      Bucket: this.s3_bucket,
      Key: this.getFullKey(key),
    };

    try {
      const data = await this.s3Bucket.getObject(params).promise();
      return JSON.parse(data.Body?.toString("utf-8") || "[]");
    } catch (error) {
      return [];
    }
  }

  async putObject(key: string, data: any): Promise<AWS.S3.PutObjectOutput> {
    const params = {
      Bucket: this.s3_bucket,
      ACL: this.s3_acl,
      Key: this.getFullKey(key),
      Body: JSON.stringify(data),
      ContentType: "application/json",
    };

    return await this.s3Bucket.putObject(params).promise();
  }

  async listObjects(prefix: string): Promise<string[]> {
    try {
      const params = {
        Bucket: this.s3_bucket,
        Prefix: this.getFullKey(prefix)
      };
      
      const response = await this.s3Bucket.listObjectsV2(params).promise();
      return (response.Contents || [])
        .map(obj => obj.Key!)
        .map(key => key.replace(this.getFullKey(''), '')); // Remove prefix
    } catch (error) {
      console.error('Error listing objects:', error);
      return [];
    }
  }

  async getObjectMetadata(key: string): Promise<AWS.S3.HeadObjectOutput> {
    const params = {
      Bucket: this.s3_bucket,
      Key: this.getFullKey(key)
    };
    
    return await this.s3Bucket.headObject(params).promise();
  }

  async deleteObject(key: string): Promise<void> {
    const params = {
      Bucket: this.s3_bucket,
      Key: this.getFullKey(key)
    };
    
    await this.s3Bucket.deleteObject(params).promise();
  }

  async copyObject(sourceKey: string, destinationKey: string): Promise<void> {
    const params = {
      Bucket: this.s3_bucket,
      CopySource: `${this.s3_bucket}/${this.getFullKey(sourceKey)}`,
      Key: this.getFullKey(destinationKey)
    };
    
    await this.s3Bucket.copyObject(params).promise();
  }

  private getFullKey(key: string): string {
    return this.s3_prefix + key;
  }
}
