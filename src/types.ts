export interface S3DBConfig {
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  endpoint?: string;
}

export interface DataItem {
  _id: string;
  _acl?: AccessControl;
  _version?: number;
  _lastModified?: string;
  _history?: VersionMetadata[];
  [key: string]: any;
}

export interface AccessControl {
  owner: string;
  readAccess?: string[];
  writeAccess?: string[];
  deleteAccess?: string[];
}

export interface SecurityContext {
  userId: string;
  roles?: string[];
}

export interface VersionMetadata {
  version: number;
  timestamp: string;
  userId: string;
  changes?: FieldChange[];
}

export interface FieldChange {
  field: string;
  oldValue: any;
  newValue: any;
  type: "add" | "modify" | "delete";
}
