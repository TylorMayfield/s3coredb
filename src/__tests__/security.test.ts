import { S3CoreDB } from '../s3CoreDB';
import { DataItem, SecurityContext, AccessControl } from '../types';
import { SecurityUtils } from '../security';

// Mock S3Client (reuse the same mock implementation)
const mockData: { [key: string]: string } = {};

const mockS3Client = {
  putObject: jest.fn().mockImplementation((key: string, data: any) => {
    mockData[key] = JSON.stringify(data);
    return Promise.resolve({});
  }),
  getObject: jest.fn().mockImplementation((key: string) => {
    const data = mockData[key];
    if (!data) {
      return Promise.resolve([]); // Return empty array for non-existent files
    }
    return Promise.resolve(JSON.parse(data)); // Parse the data before returning
  }),
  deleteObject: jest.fn().mockImplementation((key: string) => {
    delete mockData[key];
    return Promise.resolve({});
  }),
  listObjects: jest.fn().mockImplementation(() => {
    const keys = Object.keys(mockData).map(key => ({ Key: key }));
    return Promise.resolve({
      Contents: keys,
      IsTruncated: false
    });
  }),
  getObjectMetadata: jest.fn().mockImplementation((key: string) => {
    const data = mockData[key];
    if (!data) {
      return Promise.reject(new Error('NoSuchKey'));
    }
    return Promise.resolve({});
  })
};

jest.mock('../s3Client', () => ({
  __esModule: true,
  S3Client: jest.fn().mockImplementation(() => mockS3Client)
}));

describe('Row Level Security', () => {
  let db: S3CoreDB;
  let testDoc: DataItem;
  
  beforeEach(() => {
    // Clear mock data between tests
    Object.keys(mockData).forEach(key => delete mockData[key]);
    
    // Initialize DB with owner security context
    db = new S3CoreDB(
      'test-key',
      'test-secret',
      'test-bucket',
      '',
      'private',
      undefined,
      { userId: 'owner', roles: ['admin'] }
    );

    // Create fresh test document for each test
    testDoc = {
      _id: '',
      name: 'Test Document',
      _version: 1,
      _lastModified: '2025-01-16T12:20:08-05:00',
      _acl: SecurityUtils.createAcl(
        'owner',
        ['reader', 'admin'],  // Add admin to read access
        ['writer'],
        ['admin']
      )
    };
  });

  describe('Read Access', () => {
    it('should allow owner to read document', async () => {
      const id = await db.insert('users', testDoc);
      const result = await db.get('users', id);
      expect(result).toBeDefined();
    });

    it('should allow reader role to read document', async () => {
      const id = await db.insert('users', testDoc);
      
      // Switch to reader context
      db.setSecurityContext({ userId: 'reader1', roles: ['reader'] });
      
      const result = await db.get('users', id);
      expect(result).toBeDefined();
    });

    it('should allow writer role to read document', async () => {
      const id = await db.insert('users', testDoc);
      
      // Switch to writer context
      db.setSecurityContext({ userId: 'writer1', roles: ['writer'] });
      
      const result = await db.get('users', id);
      expect(result).toBeDefined();
    });

    it('should deny unauthorized user from reading document', async () => {
      const id = await db.insert('users', testDoc);
      
      // Switch to unauthorized context
      db.setSecurityContext({ userId: 'unauthorized', roles: ['other'] });
      
      const result = await db.get('users', id);
      expect(result).toBeUndefined();
    });
  });

  describe('Write Access', () => {
    it('should allow owner to update document', async () => {
      const id = await db.insert('users', testDoc);
      const updateDoc = { ...testDoc, _id: id, name: 'Updated Name' };
      
      await expect(db.update('users', updateDoc, id)).resolves.toBe(id);
    });

    it('should allow writer role to update document', async () => {
      const id = await db.insert('users', testDoc);
      
      // Switch to writer context
      db.setSecurityContext({ userId: 'writer1', roles: ['writer'] });
      
      const updateDoc = { ...testDoc, _id: id, name: 'Updated by Writer' };
      await expect(db.update('users', updateDoc, id)).resolves.toBe(id);
    });

    it('should deny reader role from updating document', async () => {
      const id = await db.insert('users', testDoc);
      
      // Switch to reader context
      db.setSecurityContext({ userId: 'reader1', roles: ['reader'] });
      
      const updateDoc = { ...testDoc, _id: id, name: 'Updated by Reader' };
      await expect(db.update('users', updateDoc, id)).rejects.toThrow('Permission denied');
    });
  });

  describe('Delete Access', () => {
    it('should allow owner to delete document', async () => {
      const id = await db.insert('users', testDoc);
      await expect(db.delete('users', id)).resolves.toBe(id);
    });

    it('should allow admin role to delete document', async () => {
      const id = await db.insert('users', testDoc);
      
      // Verify document exists and has correct ACL
      const inserted = await db.get('users', id);
      expect(inserted).toBeDefined();
      expect(inserted?._acl?.deleteAccess).toContain('admin');
      
      // Switch to admin context
      db.setSecurityContext({ userId: 'admin1', roles: ['admin'] });
      
      // Verify admin can read before delete
      const beforeDelete = await db.get('users', id);
      expect(beforeDelete).toBeDefined();
      
      // Attempt delete
      await expect(db.delete('users', id)).resolves.toBe(id);
      
      // Verify document is gone
      const afterDelete = await db.get('users', id);
      expect(afterDelete).toBeUndefined();
    });

    it('should deny writer role from deleting document', async () => {
      const id = await db.insert('users', testDoc);
      
      // Switch to writer context
      db.setSecurityContext({ userId: 'writer1', roles: ['writer'] });
      
      await expect(db.delete('users', id)).rejects.toThrow('Permission denied');
    });
  });

  describe('Wildcard Access', () => {
    beforeEach(() => {
      testDoc._acl = SecurityUtils.createAcl(
        'owner',
        ['*'],    // Everyone can read
        ['writer'], // Only writers can write
        ['admin']  // Only admins can delete
      );
    });

    it('should allow any role to read with wildcard access', async () => {
      const id = await db.insert('users', testDoc);
      
      // Switch to any random role
      db.setSecurityContext({ userId: 'random', roles: ['random-role'] });
      
      const result = await db.get('users', id);
      expect(result).toBeDefined();
    });

    it('should still enforce specific write access with wildcard read', async () => {
      const id = await db.insert('users', testDoc);
      
      // Switch to random role
      db.setSecurityContext({ userId: 'random', roles: ['random-role'] });
      
      const updateDoc = { ...testDoc, _id: id, name: 'Updated by Random' };
      await expect(db.update('users', updateDoc, id)).rejects.toThrow('Permission denied');
    });
  });

  describe('Bulk Operations', () => {
    it('should filter get_all results based on read permissions', async () => {
      // Create documents with different access levels
      const doc1 = { ...testDoc, name: 'Public Doc', _acl: SecurityUtils.createAcl('owner', ['*']) };
      const doc2 = { ...testDoc, name: 'Private Doc', _acl: SecurityUtils.createAcl('owner', ['admin']) };
      
      await db.insert('users', doc1);
      await db.insert('users', doc2);
      
      // Switch to non-admin user
      db.setSecurityContext({ userId: 'user1', roles: ['user'] });
      
      const results = await db.get_all('users');
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Public Doc');
    });
  });
});
