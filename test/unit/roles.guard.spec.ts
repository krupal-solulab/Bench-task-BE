import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from 'src/common/enums/role.enum';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { AuthenticatedUser } from 'src/common/interfaces/jwt-payload.interface';

function makeContext(user: AuthenticatedUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  function mockMetadata(isPublic: boolean | undefined, roles: Role[] | undefined) {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementationOnce(() => isPublic) // IS_PUBLIC_KEY lookup
      .mockImplementationOnce(() => roles); // ROLES_KEY lookup
  }

  it('allows a @Public() route regardless of role or missing user', () => {
    mockMetadata(true, [Role.ADMIN]);
    expect(guard.canActivate(makeContext(undefined))).toBe(true);
  });

  it('allows any authenticated user when the route has no @Roles() decorator', () => {
    mockMetadata(false, undefined);
    const user: AuthenticatedUser = {
      id: 'u1',
      email: 'a@a.com',
      role: Role.DEVELOPER,
      organizationId: 'org-1',
    };
    expect(guard.canActivate(makeContext(user))).toBe(true);
  });

  it('allows any authenticated user when @Roles() is an empty array', () => {
    mockMetadata(false, []);
    const user: AuthenticatedUser = {
      id: 'u1',
      email: 'a@a.com',
      role: Role.DEVELOPER,
      organizationId: 'org-1',
    };
    expect(guard.canActivate(makeContext(user))).toBe(true);
  });

  it('denies when there is no user on the request at all', () => {
    mockMetadata(false, [Role.ADMIN]);
    expect(guard.canActivate(makeContext(undefined))).toBe(false);
  });

  it.each([
    [Role.ADMIN, [Role.ADMIN], true],
    [Role.ADMIN, [Role.ADMIN, Role.MANAGER], true],
    [Role.MANAGER, [Role.ADMIN], false],
    [Role.DEVELOPER, [Role.ADMIN, Role.MANAGER], false],
    [Role.DEVELOPER, [Role.DEVELOPER], true],
  ])('user role %s against @Roles(%p) -> allowed=%p', (userRole, requiredRoles, allowed) => {
    mockMetadata(false, requiredRoles as Role[]);
    const user: AuthenticatedUser = {
      id: 'u1',
      email: 'a@a.com',
      role: userRole as Role,
      organizationId: 'org-1',
    };
    expect(guard.canActivate(makeContext(user))).toBe(allowed);
  });

  it('denies a role that is not one of the known enum values gracefully (no match, no throw)', () => {
    mockMetadata(false, [Role.ADMIN]);
    const user = {
      id: 'u1',
      email: 'a@a.com',
      role: 'SuperAdmin' as Role,
      organizationId: 'org-1',
    };
    let result: boolean | undefined;
    expect(() => (result = guard.canActivate(makeContext(user)))).not.toThrow();
    expect(result).toBe(false);
  });
});
