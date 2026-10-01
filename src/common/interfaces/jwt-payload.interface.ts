import { Role } from '../enums/role.enum';

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
}
