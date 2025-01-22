import { DataItem } from "../types/DataItem";
import { SecurityContext } from "../types/SecurityContext";
export class AccessControl {
  private securityContext?: SecurityContext;

  constructor(securityContext?: SecurityContext) {
    this.securityContext = securityContext;
  }

  setSecurityContext(context: SecurityContext) {
    this.securityContext = context;
  }

  private isRoleAccessGranted(access: string, roles: string[]): boolean {
    return (
      access.startsWith("role:") && roles.includes(access.replace("role:", ""))
    );
  }

  checkAccess(item: DataItem, operation: "read" | "write" | "delete"): boolean {
    if (!item?._acl || !this.securityContext) return true;

    const { userId, roles = [] } = this.securityContext;
    const acl = item._acl;

    if (acl.owner === userId) return true;

    const accessMap = {
      read: acl.readAccess,
      write: acl.writeAccess,
      delete: acl.deleteAccess,
    };

    const accessList = accessMap[operation];

    return (
      accessList?.some(
        (access) =>
          access === "*" ||
          access === userId ||
          this.isRoleAccessGranted(access, roles)
      ) ?? false
    );
  }
}
