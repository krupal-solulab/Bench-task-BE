import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RAW_RESPONSE_KEY } from '../decorators/raw-response.decorator';

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  message?: string;
  meta?: unknown;
}

interface ShapedPayload<T> {
  data: T;
  message?: string;
  meta?: unknown;
}

function isShapedPayload<T>(value: unknown): value is ShapedPayload<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    ('meta' in value || 'message' in value)
  );
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, SuccessEnvelope<T> | T> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<SuccessEnvelope<T> | T> {
    const isRaw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    return next.handle().pipe(
      map((result) => {
        if (isRaw) {
          return result;
        }
        if (isShapedPayload<T>(result)) {
          return { success: true, ...result };
        }
        return { success: true, data: result };
      }),
    );
  }
}
