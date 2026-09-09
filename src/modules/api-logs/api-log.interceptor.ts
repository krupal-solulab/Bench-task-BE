import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { ApiLogsService } from './api-logs.service';

type RequestWithUser = Request & { user?: AuthenticatedUser };

/**
 * Persists one row per request (method, path, status, organization/user, timing) so a
 * PlatformAdmin can review API activity from the UI, filtered by organization/status/method.
 * Never awaited, never throws into the request pipeline - see ApiLogsService.record().
 */
@Injectable()
export class ApiLogInterceptor implements NestInterceptor {
  constructor(private readonly apiLogsService: ApiLogsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    // Health checks are polled frequently by the hosting platform and by Docker/Render health
    // probes - they aren't meaningful "API activity" and would otherwise dominate the log.
    if (request.path.endsWith('/health')) return next.handle();

    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse<Response>();
        void this.persist(request, response.statusCode, startedAt, null);
      }),
      catchError((err: unknown) => {
        const statusCode =
          err instanceof HttpException ? err.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        void this.persist(request, statusCode, startedAt, errorMessage);
        return throwError(() => err);
      }),
    );
  }

  private async persist(
    request: RequestWithUser,
    statusCode: number,
    startedAt: number,
    errorMessage: string | null,
  ): Promise<void> {
    await this.apiLogsService.record({
      method: request.method,
      path: request.path,
      statusCode,
      organizationId: request.user?.organizationId ?? null,
      userId: request.user?.id ?? null,
      userEmail: request.user?.email ?? null,
      durationMs: Date.now() - startedAt,
      ip: request.ip ?? null,
      userAgent: this.firstHeaderValue(request.headers['user-agent']),
      errorMessage,
    });
  }

  private firstHeaderValue(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  }
}
