export interface DataItem {
    _id: string;
    _acl?: {
      owner: string;
      readAccess?: string[];
      writeAccess?: string[];
      deleteAccess?: string[];
    };
    _lastModified: string;
    _created: string;
    _version: number;
    [key: string]: any;
    Tags?: string[];
  }
  