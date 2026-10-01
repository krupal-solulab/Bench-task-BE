import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ImpersonationReadOnlyGuard } from 'src/common/guards/impersonation-read-only.guard';
import { Role } from 'src/common/enums/role.enum';

/** Module 8 gap-closure: impersonation is read-only. */
describe('ImpersonationReadOnlyGuard', () => {
  function context(method: string, impersonatedBy?: string, allowed = false): ExecutionContext {
    const handler = () => undefined;
    const reflector = { get: jest.fn().mockReturnValue(allowed) };
    const ctx = {
      getType: () => 'http',
      getHandler: () => handler,
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          user: {
            id: 'u-1',
            email: 'u@example.com',
            role: Role.DEVELOPER,
            organizationId: 'org-1',
            ...(impersonatedBy ? { impersonatedBy } : {}),
          },
        }),
      }),
    } as unknown as ExecutionContext;
    guard = new ImpersonationReadOnlyGuard(reflector as unknown as Reflector);
    return ctx;
  }
  let guard: ImpersonationReadOnlyGuard;

  it('never affects a normal (non-impersonated) session, for any method', () => {
    for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) {
      const ctx = context(method);
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });

  it('allows reads while impersonating', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const ctx = context(method, 'admin-1');
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });

  it('refuses every write while impersonating', () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const ctx = context(method, 'admin-1');
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    }
  });

  it('lets an explicitly exempted route (ending the session) through', () => {
    const ctx = context('POST', 'admin-1', true);
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
