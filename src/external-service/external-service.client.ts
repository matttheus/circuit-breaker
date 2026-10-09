import { Injectable } from '@nestjs/common';
import {
  type DependencyName,
  EXTERNAL_SERVICE_BASE_URL,
  EXTERNAL_SERVICE_TIMEOUT_MS,
} from '../config/constants.js';
import {
  DependencyHttpError,
  DependencyNetworkError,
  DependencyTimeoutError,
  parseRetryAfter,
} from './dependency.errors.js';

@Injectable()
export class ExternalServiceClient {
  send(dependency: DependencyName, payload: unknown): Promise<unknown> {
    return this.request(dependency, `/${dependency}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async healthCheck(dependency: DependencyName): Promise<void> {
    await this.request(dependency, `/${dependency}/health`, { method: 'GET' });
  }

  private async request(
    dependency: DependencyName,
    path: string,
    init: RequestInit,
  ): Promise<unknown> {
    const url = new URL(`${EXTERNAL_SERVICE_BASE_URL}${path}`);
    let status: number;
    let retryAfter: string | null;
    let text: string;
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(EXTERNAL_SERVICE_TIMEOUT_MS),
      });
      status = response.status;
      retryAfter = response.headers.get('retry-after');
      text = await response.text();
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new DependencyTimeoutError(
          dependency,
          EXTERNAL_SERVICE_TIMEOUT_MS,
        );
      }
      throw new DependencyNetworkError(dependency, error);
    }

    const body = parseJson(text);
    if (status < 200 || status >= 300) {
      throw new DependencyHttpError(
        dependency,
        status,
        body,
        parseRetryAfter(retryAfter),
      );
    }
    return body;
  }
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}
