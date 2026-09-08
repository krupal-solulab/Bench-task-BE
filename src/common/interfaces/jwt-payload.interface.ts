import { Role } from '../enums/role.enum';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  organizationId: string | null;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  organizationId: string | null;
}
