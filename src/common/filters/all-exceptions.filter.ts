import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

interface ErrorResponseBody {
  statusCode: number;
  message: string;
  error: string;
  details?: string[];
  /** The 0-indexed character offset a JQL syntax error occurred at (see JqlSyntaxError in
   * jql.util.ts) - lets the Issue Navigator highlight the exact bad token, not just show the
   * message text. Absent for every other kind of error. */
  position?: number;
  timestamp: string;
  path: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@InjectPinoLogger(AllExceptionsFilter.name) private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, message, error, details, position } = this.resolveError(exception);

    const body: ErrorResponseBody = {
      statusCode,
      message,
      error,
      ...(details ? { details } : {}),
      ...(position !== undefined ? { position } : {}),
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error({ err: exception, path: request.url }, 'unhandled exception');
    } else {
      this.logger.warn({ statusCode, path: request.url }, message);
    }

    response.status(statusCode).json(body);
  }

  private resolveError(exception: unknown): {
    statusCode: number;
    message: string;
    error: string;
    details?: string[];
    position?: number;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return { statusCode: status, message: payload, error: exception.name };
      }

      const payloadObj = payload as {
        message?: string | string[];
        error?: string;
        position?: number;
      };
      const rawMessage = payloadObj.message;
      const isValidationError = Array.isArray(rawMessage);

      return {
        statusCode: status,
        message: isValidationError
          ? 'Validation failed'
          : ((rawMessage as string) ?? exception.message),
        error: payloadObj.error ?? exception.name,
        details: isValidationError ? (rawMessage as string[]) : undefined,
        position: typeof payloadObj.position === 'number' ? payloadObj.position : undefined,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
    };
  }
}
