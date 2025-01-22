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

  checkAccess(
    item: DataItem | undefined,
    operation: "read" | "write" | "delete"
  ): boolean {
    if (!item?._acl || !this.securityContext) return true;

    const { userId, roles = [] } = this.securityContext;
    const acl = item._acl;

    if (acl.owner === userId) return true;

    const accessList =
      operation === "read"
        ? acl.readAccess
        : operation === "write"
        ? acl.writeAccess
        : acl.deleteAccess;

    return (
      accessList?.some(
        (access) =>
          access === "*" ||
          access === userId ||
          (access.startsWith("role:") &&
            roles.includes(access.replace("role:", "")))
      ) ?? false
    );
  }
}
