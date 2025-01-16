import { DataItem, FieldChange, VersionMetadata } from "./types";

export class VersionControl {
  static computeDiff(oldItem: DataItem, newItem: DataItem): FieldChange[] {
    const changes: FieldChange[] = [];
    const allFields = new Set([
      ...Object.keys(oldItem),
      ...Object.keys(newItem),
    ]);

    // Skip internal fields
    const internalFields = ["_id", "_acl", "_version", "_lastModified", "_history"];
    
    for (const field of allFields) {
      if (internalFields.includes(field)) continue;

      const oldValue = oldItem[field];
      const newValue = newItem[field];

      if (!(field in oldItem)) {
        changes.push({
          field,
          oldValue: undefined,
          newValue,
          type: "add",
        });
      } else if (!(field in newItem)) {
        changes.push({
          field,
          oldValue,
          newValue: undefined,
          type: "delete",
        });
      } else if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes.push({
          field,
          oldValue,
          newValue,
          type: "modify",
        });
      }
    }

    return changes;
  }

  static createVersion(
    oldItem: DataItem,
    newItem: DataItem,
    userId: string
  ): VersionMetadata {
    const changes = this.computeDiff(oldItem, newItem);
    const version = (oldItem._version || 0) + 1;

    return {
      version,
      timestamp: new Date().toISOString(),
      userId,
      changes,
    };
  }

  static applyVersion(item: DataItem, userId: string): DataItem {
    const updatedItem = { ...item };
    const version = updatedItem._version || 0;
    const previousVersion = updatedItem._history?.[version - 1];
    
    const baseItem: DataItem = previousVersion 
      ? { _id: updatedItem._id, ...previousVersion }
      : { _id: updatedItem._id };

    const versionMeta = this.createVersion(
      baseItem,
      updatedItem,
      userId
    );

    updatedItem._version = versionMeta.version;
    updatedItem._lastModified = versionMeta.timestamp;
    updatedItem._history = updatedItem._history || [];
    updatedItem._history.push(versionMeta);

    return updatedItem;
  }

  static getVersion(item: DataItem, version: number): DataItem | undefined {
    if (!item._history || version > (item._version || 0)) {
      return undefined;
    }

    // Start with the initial version
    let reconstructedItem: DataItem = { _id: item._id };

    // Apply changes up to the requested version
    for (let i = 0; i < version; i++) {
      const versionMeta = item._history[i];
      versionMeta.changes.forEach((change) => {
        switch (change.type) {
          case "add":
          case "modify":
            reconstructedItem[change.field] = change.newValue;
            break;
          case "delete":
            delete reconstructedItem[change.field];
            break;
        }
      });
    }

    return reconstructedItem;
  }

  static getVersionHistory(item: DataItem): VersionMetadata[] {
    return item._history || [];
  }
}
