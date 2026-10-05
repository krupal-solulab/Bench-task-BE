import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import type { ApiTokensService } from 'src/modules/api-tokens/api-tokens.service';

function makeContext(request: Record<string, unknown> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  let reflector: Reflector;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
  });

  it('bypasses passport entirely for a @Public() route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const superSpy = jest.spyOn(AuthGuard('jwt').prototype, 'canActivate');
    expect(guard.canActivate(makeContext())).toBe(true);
    expect(superSpy).not.toHaveBeenCalled();
    superSpy.mockRestore();
  });

  it('delegates to the passport jwt strategy for a non-public route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const superSpy = jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockImplementation(() => true);
    const context = makeContext();
    guard.canActivate(context);
    expect(superSpy).toHaveBeenCalledWith(context);
    superSpy.mockRestore();
  });

  describe('personal API tokens (Module 11)', () => {
    const tokenUser = {
      id: 'u1',
      email: 'a@b.c',
      role: 'Developer',
      organizationId: 'o1',
      viaApiToken: 't1',
    };

    it('authenticates a Bearer pat_ token without touching passport', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const authenticate = jest.fn().mockResolvedValue(tokenUser);
      const tokenGuard = new JwtAuthGuard(reflector, {
        authenticate,
      } as unknown as ApiTokensService);
      const superSpy = jest.spyOn(AuthGuard('jwt').prototype, 'canActivate');
      const request: Record<string, unknown> = { headers: { authorization: 'Bearer pat_abc' } };
      await expect(tokenGuard.canActivate(makeContext(request))).resolves.toBe(true);
      expect(authenticate).toHaveBeenCalledWith('pat_abc');
      expect(request.user).toEqual(tokenUser);
      expect(superSpy).not.toHaveBeenCalled();
      superSpy.mockRestore();
    });

    it('rejects an unknown pat_ token with 401', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const tokenGuard = new JwtAuthGuard(reflector, {
        authenticate: jest.fn().mockResolvedValue(null),
      } as unknown as ApiTokensService);
      const context = makeContext({ headers: { authorization: 'Bearer pat_nope' } });
      await expect(tokenGuard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('still sends ordinary JWTs to passport', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const authenticate = jest.fn();
      const tokenGuard = new JwtAuthGuard(reflector, {
        authenticate,
      } as unknown as ApiTokensService);
      const superSpy = jest
        .spyOn(AuthGuard('jwt').prototype, 'canActivate')
        .mockImplementation(() => true);
      tokenGuard.canActivate(makeContext({ headers: { authorization: 'Bearer eyJhbGc' } }));
      expect(superSpy).toHaveBeenCalled();
      expect(authenticate).not.toHaveBeenCalled();
      superSpy.mockRestore();
    });
  });
});
