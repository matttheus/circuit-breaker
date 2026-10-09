import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { BulkheadRejectedError } from '../bulkhead/bulkhead.js';
import { CircuitOpenError } from '../circuit-breaker/circuit-breaker.js';
import {
  DependencyError,
  DependencyHttpError,
  DependencyTimeoutError,
} from '../external-service/dependency.errors.js';

interface HttpErrorResponse {
  status: number;
  body: { message: string; [key: string]: unknown };
  retryAfterSeconds?: number;
}

export function toHttpErrorResponse(
  error: CircuitOpenError | BulkheadRejectedError | DependencyError,
): HttpErrorResponse {
  if (error instanceof CircuitOpenError) {
    return {
      status: 503,
      body: { message: 'Dependency temporarily unavailable (circuit open)' },
      retryAfterSeconds: Math.max(1, Math.ceil(error.retryAfterMs / 1000)),
    };
  }
  if (error instanceof BulkheadRejectedError) {
    return {
      status: 503,
      body: { message: 'Too many concurrent calls to the dependency' },
      retryAfterSeconds: 1,
    };
  }
  if (error instanceof DependencyHttpError && error.isClientError) {
    return {
      status: error.status,
      body: {
        message: 'Dependency rejected the request',
        dependency: error.dependency,
        details: error.body,
      },
    };
  }
  if (error instanceof DependencyHttpError && error.status === 429) {
    return {
      status: 503,
      body: { message: 'Dependency is rate limiting requests' },
      retryAfterSeconds: Math.max(1, error.retryAfterSeconds ?? 1),
    };
  }
  if (error instanceof DependencyTimeoutError) {
    return { status: 504, body: { message: error.message } };
  }
  return { status: 502, body: { message: error.message } };
}

@Catch(CircuitOpenError, BulkheadRejectedError, DependencyError)
export class DependencyErrorFilter implements ExceptionFilter {
  catch(
    error: CircuitOpenError | BulkheadRejectedError | DependencyError,
    host: ArgumentsHost,
  ) {
    const { status, body, retryAfterSeconds } = toHttpErrorResponse(error);
    const response = host.switchToHttp().getResponse<Response>();
    if (retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(retryAfterSeconds));
    }
    response.status(status).json(body);
  }
}
