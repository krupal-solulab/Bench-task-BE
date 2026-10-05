import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiTokenRestrictionGuard } from 'src/common/guards/api-token-restriction.guard';

function makeContext(user?: Record<string, unknown>): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('ApiTokenRestrictionGuard (Module 11)', () => {
  const reflector = new Reflector();
  const guard = new ApiTokenRestrictionGuard(reflector);

  afterEach(() => jest.restoreAllMocks());

  it('never affects a normal signed-in session, even on a disallowed route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    expect(guard.canActivate(makeContext({ id: 'u1' }))).toBe(true);
  });

  it('lets an API token through routes that are not marked', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(makeContext({ id: 'u1', viaApiToken: 't1' }))).toBe(true);
  });

  it('refuses an API token on a @DisallowApiToken route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    expect(() => guard.canActivate(makeContext({ id: 'u1', viaApiToken: 't1' }))).toThrow(
      ForbiddenException,
    );
  });
});
