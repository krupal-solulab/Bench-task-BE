import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from 'src/common/enums/role.enum';
import { OrganizationScopeGuard } from 'src/common/guards/organization-scope.guard';
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

const admin: AuthenticatedUser = {
  id: 'u1',
  email: 'admin@a.com',
  role: Role.ADMIN,
  organizationId: 'org-1',
};

const platformAdmin: AuthenticatedUser = {
  id: 'p1',
  email: 'platform@a.com',
  role: Role.PLATFORM_ADMIN,
  organizationId: null,
};

describe('OrganizationScopeGuard', () => {
  let reflector: Reflector;
  let guard: OrganizationScopeGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new OrganizationScopeGuard(reflector);
  });

  /** Queues return values in the exact order the guard reads them: public, shared, platformOnly. */
  function mockMetadata(
    isPublic: boolean | undefined,
    isShared: boolean | undefined,
    isPlatformOnly?: boolean,
  ) {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementationOnce(() => isPublic)
      .mockImplementationOnce(() => isShared)
      .mockImplementationOnce(() => isPlatformOnly);
  }

  it('allows a @Public() route regardless of role or missing user', () => {
    mockMetadata(true, undefined, undefined);
    expect(guard.canActivate(makeContext(undefined))).toBe(true);
  });

  it('allows a @SharedRoute() route for a PlatformAdmin', () => {
    mockMetadata(false, true, undefined);
    expect(guard.canActivate(makeContext(platformAdmin))).toBe(true);
  });

  it('allows a @SharedRoute() route for a regular org user', () => {
    mockMetadata(false, true, undefined);
    expect(guard.canActivate(makeContext(admin))).toBe(true);
  });

  it('allows a PlatformAdmin onto a @PlatformOnly() route', () => {
    mockMetadata(false, false, true);
    expect(guard.canActivate(makeContext(platformAdmin))).toBe(true);
  });

  it('denies a regular org user (Admin) on a @PlatformOnly() route', () => {
    mockMetadata(false, false, true);
    expect(guard.canActivate(makeContext(admin))).toBe(false);
  });

  it('denies a PlatformAdmin on an ordinary (non-platform-only, non-shared, non-public) route - fail-closed', () => {
    mockMetadata(false, false, false);
    expect(guard.canActivate(makeContext(platformAdmin))).toBe(false);
  });

  it('denies a PlatformAdmin on a route with no metadata at all (new route forgot to annotate it)', () => {
    mockMetadata(false, false, undefined);
    expect(guard.canActivate(makeContext(platformAdmin))).toBe(false);
  });

  it('allows a regular org user onto an ordinary route', () => {
    mockMetadata(false, false, false);
    expect(guard.canActivate(makeContext(admin))).toBe(true);
  });

  it('treats a request with no user as not-a-PlatformAdmin (falls through to the org-user branch)', () => {
    mockMetadata(false, false, false);
    expect(guard.canActivate(makeContext(undefined))).toBe(true);
  });
});
