import type { CircuitBreakerStoreType } from '../../config/constants.js';
import type {
  CircuitBreakerOptions,
  CircuitState,
  CircuitStateChange,
  CircuitWindow,
} from '../circuit-breaker.js';

export interface CircuitRecord {
  state: CircuitState;
  window: CircuitWindow;
  halfOpenSuccesses: number;
  openedAt: number | null;
  retryAfterMs: number;
  stats: {
    successes: number;
    failures: number;
    rejected: number;
    ignored: number;
  };
}

export type CircuitPermit =
  | { allowed: true; change: CircuitStateChange | null }
  | { allowed: false; retryAfterMs: number; change: CircuitStateChange | null };

export type CircuitOperation =
  'acquire' | 'success' | 'failure' | 'ignore' | 'reset';

export interface CircuitBreakerStore {
  readonly kind: CircuitBreakerStoreType;
  acquire(now: number, allowProbe: boolean): Promise<CircuitPermit>;
  recordSuccess(now: number): Promise<CircuitStateChange | null>;
  recordFailure(now: number): Promise<CircuitStateChange | null>;
  recordIgnored(now: number): Promise<CircuitStateChange | null>;
  reset(now: number): Promise<CircuitStateChange | null>;
  read(now: number): Promise<CircuitRecord>;
}

export abstract class CircuitBreakerStoreFactory {
  abstract create(
    name: string,
    options: CircuitBreakerOptions,
  ): CircuitBreakerStore;
}

export function toChange(
  from: CircuitState,
  to: CircuitState,
): CircuitStateChange | null {
  return from === to ? null : { from, to };
}

export function windowRange(
  now: number,
  options: CircuitBreakerOptions,
): { current: number; oldest: number } {
  const bucketMs = options.windowMs / options.windowBuckets;
  const current = Math.floor(now / bucketMs);
  return { current, oldest: current - options.windowBuckets + 1 };
}

export function toWindow(requests: number, failures: number): CircuitWindow {
  return {
    requests,
    failures,
    errorPercent:
      requests === 0 ? 0 : Math.round((failures / requests) * 10_000) / 100,
  };
}

export function shouldTrip(
  { requests, failures }: CircuitWindow,
  options: CircuitBreakerOptions,
): boolean {
  return (
    requests >= options.minimumRequests &&
    failures * 100 >= options.errorThresholdPercent * requests
  );
}
