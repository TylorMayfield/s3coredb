import { DataItem, SecurityContext, AccessControl } from "./types";

export class SecurityUtils {
  static canRead(item: DataItem, context: SecurityContext): boolean {
    if (!item._acl) return true;
    const acl = item._acl;
    return (
      acl.owner === context.userId ||
      this.hasAccess(context, acl.readAccess) ||
      this.hasAccess(context, acl.writeAccess)
    );
  }

  static canWrite(item: DataItem, context: SecurityContext): boolean {
    if (!item._acl) return true;

    const acl = item._acl;
    return (
      acl.owner === context.userId || this.hasAccess(context, acl.writeAccess)
    );
  }

  static canDelete(item: DataItem, context: SecurityContext): boolean {
    if (!item._acl) return true;

    const acl = item._acl;
    return (
      acl.owner === context.userId || this.hasAccess(context, acl.deleteAccess)
    );
  }

  private static hasAccess(
    context: SecurityContext,
    accessList?: string[]
  ): boolean {
    if (!accessList || accessList.length === 0) return false;
    if (!context.roles || context.roles.length === 0) return false;

    return accessList.some(
      (access) =>
        access === "*" || // Wildcard access
        context.roles?.includes(access) ||
        access === context.userId
    );
  }

  static createAcl(
    owner: string,
    readAccess?: string[],
    writeAccess?: string[],
    deleteAccess?: string[]
  ): AccessControl {
    return {
      owner,
      readAccess: readAccess || [],
      writeAccess: writeAccess || [],
      deleteAccess: deleteAccess || [],
    };
  }

  static filterReadableItems(
    items: DataItem | DataItem[],
    context: SecurityContext
  ): DataItem[] {
    if (!Array.isArray(items)) {
      items = [items];
    }
    return items.filter((item) => this.canRead(item, context));
  }
}
