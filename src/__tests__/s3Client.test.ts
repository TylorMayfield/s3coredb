import AWS from 'aws-sdk';
import { S3Client } from '../s3Client';

// Mock AWS SDK
jest.mock('aws-sdk', () => {
  return {
    Endpoint: jest.fn(),
    config: {
      update: jest.fn()
    },
    S3: jest.fn()
  };
});

describe('S3Client', () => {
  let s3Client: S3Client;
  let mockGetObject: jest.Mock;
  let mockPutObject: jest.Mock;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Setup mock methods
    mockGetObject = jest.fn();
    mockPutObject = jest.fn();
    
    // Setup S3 mock
    const MockS3 = AWS.S3 as unknown as jest.Mock;
    MockS3.mockImplementation(() => ({
      getObject: mockGetObject,
      putObject: mockPutObject
    }));

    // Create new client for each test
    s3Client = new S3Client(
      'test-key',
      'test-secret',
      'test-bucket',
      'test-prefix/',
      'private'
    );
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      const client = new S3Client('key', 'secret', 'bucket');
      expect(AWS.config.update).toHaveBeenCalledWith({
        accessKeyId: 'key',
        secretAccessKey: 'secret'
      });
      expect(AWS.S3).toHaveBeenCalledWith({
        params: {
          Bucket: 'bucket',
          timeout: 6000000
        }
      });
    });

    it('should initialize with custom endpoint', () => {
      const client = new S3Client(
        'key',
        'secret',
        'bucket',
        '',
        'private',
        'http://localhost:4566'
      );
      expect(AWS.Endpoint).toHaveBeenCalledWith('http://localhost:4566');
    });

    it('should initialize with custom prefix and ACL', () => {
      const client = new S3Client(
        'key',
        'secret',
        'bucket',
        'prefix/',
        'public-read'
      );
      expect(AWS.S3).toHaveBeenCalledWith({
        params: {
          Bucket: 'bucket',
          timeout: 6000000
        }
      });
    });
  });

  describe('getObject', () => {
    it('should get and parse JSON data', async () => {
      const mockData = { test: 'data' };
      mockGetObject.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Body: Buffer.from(JSON.stringify(mockData))
        })
      });

      const result = await s3Client.getObject('test.json');
      
      expect(mockGetObject).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'test-prefix/test.json'
      });
      expect(result).toEqual(mockData);
    });

    it('should handle missing data', async () => {
      mockGetObject.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Body: undefined
        })
      });

      const result = await s3Client.getObject('test.json');
      expect(result).toEqual([]);
    });

    it('should handle S3 errors', async () => {
      mockGetObject.mockReturnValue({
        promise: jest.fn().mockRejectedValue(new Error('S3 Error'))
      });

      const result = await s3Client.getObject('test.json');
      expect(result).toEqual([]);
    });

    it('should handle invalid JSON', async () => {
      mockGetObject.mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Body: Buffer.from('invalid json')
        })
      });

      const result = await s3Client.getObject('test.json');
      expect(result).toEqual([]);
    });
  });

  describe('putObject', () => {
    it('should put JSON data', async () => {
      const mockData = { test: 'data' };
      mockPutObject.mockReturnValue({
        promise: jest.fn().mockResolvedValue({ ETag: 'test-etag' })
      });

      await s3Client.putObject('test.json', mockData);
      
      expect(mockPutObject).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        ACL: 'private',
        Key: 'test-prefix/test.json',
        Body: JSON.stringify(mockData),
        ContentType: 'application/json'
      });
    });

    it('should handle S3 errors', async () => {
      const mockData = { test: 'data' };
      mockPutObject.mockReturnValue({
        promise: jest.fn().mockRejectedValue(new Error('S3 Error'))
      });

      await expect(s3Client.putObject('test.json', mockData))
        .rejects
        .toThrow('S3 Error');
    });

    it('should use custom ACL', async () => {
      const client = new S3Client(
        'key',
        'secret',
        'bucket',
        '',
        'public-read'
      );
      
      const mockData = { test: 'data' };
      mockPutObject.mockReturnValue({
        promise: jest.fn().mockResolvedValue({ ETag: 'test-etag' })
      });

      await client.putObject('test.json', mockData);
      
      expect(mockPutObject).toHaveBeenCalledWith(expect.objectContaining({
        ACL: 'public-read'
      }));
    });
  });

  describe('prefix handling', () => {
    it('should handle empty prefix', async () => {
      const client = new S3Client('key', 'secret', 'bucket');
      mockPutObject.mockReturnValue({
        promise: jest.fn().mockResolvedValue({ ETag: 'test-etag' })
      });

      await client.putObject('test.json', {});
      
      expect(mockPutObject).toHaveBeenCalledWith(expect.objectContaining({
        Key: 'test.json'
      }));
    });

    it('should handle prefix with trailing slash', async () => {
      const client = new S3Client('key', 'secret', 'bucket', 'prefix/');
      mockPutObject.mockReturnValue({
        promise: jest.fn().mockResolvedValue({ ETag: 'test-etag' })
      });

      await client.putObject('test.json', {});
      
      expect(mockPutObject).toHaveBeenCalledWith(expect.objectContaining({
        Key: 'prefix/test.json'
      }));
    });

    it('should handle prefix without trailing slash', async () => {
      const client = new S3Client('key', 'secret', 'bucket', 'prefix');
      mockPutObject.mockReturnValue({
        promise: jest.fn().mockResolvedValue({ ETag: 'test-etag' })
      });

      await client.putObject('test.json', {});
      
      expect(mockPutObject).toHaveBeenCalledWith(expect.objectContaining({
        Key: 'prefixtest.json'
      }));
    });
  });
});
