import type { DependencyName } from '../config/constants.js';

export abstract class DependencyError extends Error {
  protected constructor(
    readonly dependency: DependencyName,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class DependencyHttpError extends DependencyError {
  constructor(
    dependency: DependencyName,
    readonly status: number,
    readonly body: unknown,
    readonly retryAfterSeconds?: number,
  ) {
    super(dependency, `${dependency} responded with HTTP ${status}`);
  }

  get isClientError(): boolean {
    return (
      this.status >= 400 &&
      this.status < 500 &&
      this.status !== 408 &&
      this.status !== 429
    );
  }
}

export class DependencyTimeoutError extends DependencyError {
  constructor(dependency: DependencyName, timeoutMs: number) {
    super(dependency, `${dependency} did not respond within ${timeoutMs}ms`);
  }
}

export class DependencyNetworkError extends DependencyError {
  constructor(dependency: DependencyName, cause: unknown) {
    super(dependency, `${dependency} is unreachable`, { cause });
  }
}

export function isDependencyFailure(error: unknown): boolean {
  if (!(error instanceof DependencyError)) {
    return false;
  }
  return !(error instanceof DependencyHttpError && error.isClientError);
}

export function parseRetryAfter(
  value: string | null,
  now = Date.now(),
): number | undefined {
  if (!value) {
    return undefined;
  }
  if (/^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  const date = Date.parse(value);
  if (Number.isNaN(date)) {
    return undefined;
  }
  return Math.max(0, Math.ceil((date - now) / 1000));
}
