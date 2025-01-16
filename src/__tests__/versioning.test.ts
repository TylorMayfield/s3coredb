import { VersionControl } from '../versioning';
import { DataItem } from '../types';

describe('VersionControl', () => {
  const userId = 'test-user';

  describe('computeDiff', () => {
    it('should detect added fields', () => {
      const oldItem: DataItem = {
        _id: 'test1',
        name: 'John'
      };
      
      const newItem: DataItem = {
        _id: 'test1',
        name: 'John',
        age: 30
      };

      const diff = VersionControl.computeDiff(oldItem, newItem);
      expect(diff).toHaveLength(1);
      expect(diff[0]).toEqual({
        field: 'age',
        oldValue: undefined,
        newValue: 30,
        type: 'add'
      });
    });

    it('should detect modified fields', () => {
      const oldItem: DataItem = {
        _id: 'test1',
        name: 'John',
        age: 30
      };
      
      const newItem: DataItem = {
        _id: 'test1',
        name: 'John Smith',
        age: 30
      };

      const diff = VersionControl.computeDiff(oldItem, newItem);
      expect(diff).toHaveLength(1);
      expect(diff[0]).toEqual({
        field: 'name',
        oldValue: 'John',
        newValue: 'John Smith',
        type: 'modify'
      });
    });

    it('should detect deleted fields', () => {
      const oldItem: DataItem = {
        _id: 'test1',
        name: 'John',
        age: 30
      };
      
      const newItem: DataItem = {
        _id: 'test1',
        name: 'John'
      };

      const diff = VersionControl.computeDiff(oldItem, newItem);
      expect(diff).toHaveLength(1);
      expect(diff[0]).toEqual({
        field: 'age',
        oldValue: 30,
        newValue: undefined,
        type: 'delete'
      });
    });

    it('should ignore _version and _history fields', () => {
      const oldItem: DataItem = {
        _id: 'test1',
        name: 'John',
        _version: 1,
        _history: []
      };
      
      const newItem: DataItem = {
        _id: 'test1',
        name: 'John',
        _version: 2,
        _history: [{ version: 1, timestamp: '2025-01-16T12:20:08-05:00', userId: 'test', changes: [] }]
      };

      const diff = VersionControl.computeDiff(oldItem, newItem);
      expect(diff).toHaveLength(0);
    });
  });

  describe('createVersion', () => {
    it('should create initial version metadata', () => {
      const oldItem: DataItem = {
        _id: 'test1',
        name: 'John'
      };
      
      const newItem: DataItem = {
        _id: 'test1',
        name: 'John Smith'
      };

      const versionMeta = VersionControl.createVersion(oldItem, newItem, userId);
      expect(versionMeta).toMatchObject({
        version: 1,
        userId,
        changes: [{
          field: 'name',
          oldValue: 'John',
          newValue: 'John Smith',
          type: 'modify'
        }]
      });
      expect(versionMeta.timestamp).toBeDefined();
    });

    it('should increment version number', () => {
      const oldItem: DataItem = {
        _id: 'test1',
        name: 'John',
        _version: 2
      };
      
      const newItem: DataItem = {
        _id: 'test1',
        name: 'John Smith',
        _version: 2
      };

      const versionMeta = VersionControl.createVersion(oldItem, newItem, userId);
      expect(versionMeta.version).toBe(3);
    });
  });
});
