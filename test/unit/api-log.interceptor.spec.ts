import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { Role } from 'src/common/enums/role.enum';
import { ApiLogInterceptor } from 'src/modules/api-logs/api-log.interceptor';
import { ApiLogsService } from 'src/modules/api-logs/api-logs.service';

function makeContext(request: Record<string, unknown>, response: Record<string, unknown> = {}) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('ApiLogInterceptor', () => {
  let apiLogsService: jest.Mocked<Pick<ApiLogsService, 'record'>>;
  let interceptor: ApiLogInterceptor;

  beforeEach(() => {
    apiLogsService = { record: jest.fn().mockResolvedValue(undefined) };
    interceptor = new ApiLogInterceptor(apiLogsService as unknown as ApiLogsService);
  });

  it('does not persist anything for a health check request', async () => {
    const context = makeContext({ path: '/api/v1/health', method: 'GET' });
    const result = await firstValueFrom(
      interceptor.intercept(context, { handle: () => of({ ok: true }) }),
    );
    await flush();

    expect(result).toEqual({ ok: true });
    expect(apiLogsService.record).not.toHaveBeenCalled();
  });

  it('persists a success entry with the response status code and the request user context', async () => {
    const request = {
      path: '/api/v1/projects',
      method: 'GET',
      ip: '127.0.0.1',
      headers: { 'user-agent': 'jest-test' },
      user: { id: 'user-1', email: 'a@a.com', role: Role.ADMIN, organizationId: 'org-1' },
    };
    const context = makeContext(request, { statusCode: 200 });

    await firstValueFrom(interceptor.intercept(context, { handle: () => of({ data: [] }) }));
    await flush();

    expect(apiLogsService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/projects',
        statusCode: 200,
        organizationId: 'org-1',
        userId: 'user-1',
        userEmail: 'a@a.com',
        ip: '127.0.0.1',
        userAgent: 'jest-test',
        errorMessage: null,
      }),
    );
  });

  it('persists a failure entry using the HttpException status, and re-throws unchanged', async () => {
    const request = { path: '/api/v1/projects/x', method: 'DELETE', headers: {} };
    const context = makeContext(request);
    const error = new ForbiddenException('nope');

    await expect(
      firstValueFrom(interceptor.intercept(context, { handle: () => throwError(() => error) })),
    ).rejects.toBe(error);
    await flush();

    expect(apiLogsService.record).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403, errorMessage: 'nope' }),
    );
  });

  it('falls back to a 500 status for a non-HTTP exception', async () => {
    const request = { path: '/api/v1/projects', method: 'GET', headers: {} };
    const context = makeContext(request);
    const error = new Error('boom');

    await expect(
      firstValueFrom(interceptor.intercept(context, { handle: () => throwError(() => error) })),
    ).rejects.toBe(error);
    await flush();

    expect(apiLogsService.record).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, errorMessage: 'boom' }),
    );
  });

  it('records null organization/user for an unauthenticated (public) request', async () => {
    const request = { path: '/api/v1/auth/login', method: 'POST', headers: {} };
    const context = makeContext(request, { statusCode: 201 });

    await firstValueFrom(interceptor.intercept(context, { handle: () => of({}) }));
    await flush();

    expect(apiLogsService.record).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: null, userId: null, userEmail: null }),
    );
  });
});
