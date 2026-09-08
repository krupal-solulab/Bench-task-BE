import { ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

function makeContext(): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({}) }),
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
});
