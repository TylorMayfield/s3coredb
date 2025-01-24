import { S3Client as AWSS3Client } from "@aws-sdk/client-s3";

export interface S3ClientConfig {
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  endpoint?: string;
  forcePathStyle?: boolean;
  region?: 'us-east-2';
}

export const createS3Client = (config: S3ClientConfig): AWSS3Client => {
  return new AWSS3Client(config);
};
