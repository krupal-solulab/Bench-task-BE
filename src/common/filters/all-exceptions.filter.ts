import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

interface ErrorResponseBody {
  statusCode: number;
  message: string;
  error: string;
  details?: string[];
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

    const { statusCode, message, error, details } = this.resolveError(exception);

    const body: ErrorResponseBody = {
      statusCode,
      message,
      error,
      ...(details ? { details } : {}),
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
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
    };
  }
}
