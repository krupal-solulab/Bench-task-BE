import { Role } from '../enums/role.enum';
import type { MemberPermissions } from '../../modules/projects/schemas/member-permissions.schema';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  organizationId: string | null;
  /** Module 8 gap-closure: set only on a read-only "view as" token - the impersonating Admin. */
  impersonatedBy?: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  organizationId: string | null;
  /** Module 8 gap-closure: present only while an Admin is viewing as this user (read-only). */
  impersonatedBy?: string;
  /** Module 11 gap-closure: the id of the personal API token used, when not a normal sign-in. */
  viaApiToken?: string;
  /** Signed in with an invite's temporary password and hasn't set their own one yet. */
  mustChangePassword?: boolean;
  /** Capabilities from the user's custom role (QA, DevOps, ...), added on top of per-project
   * member grants in every project they belong to. */
  rolePermissions?: MemberPermissions;
  /** The role whose permissions those are - a custom role, or the built-in Manager/Developer
   * row - so a project can override them for that role. */
  roleId?: string;
}
