import { bulkheadSlots } from '../bulkhead/bulkhead-sizing.js';
import type { CircuitBreakerOptions } from '../circuit-breaker/circuit-breaker.js';

export const APP_PORT = Number(process.env.PORT ?? 3000);

export const REDIS_HOST = process.env.REDIS_HOST ?? 'localhost';
export const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);

export interface DependencyConfig {
  queue: string;
  concurrency: number;
  sync: {
    peakRequestsPerSecond: number;
    p99LatencyMs: number;
  };
  mock: {
    errorRatePercent: number;
    latencyMs: number;
  };
}

export const DEPENDENCIES = {
  payments: {
    queue: 'payments-calls',
    concurrency: 2,
    sync: { peakRequestsPerSecond: 100, p99LatencyMs: 100 },
    mock: { errorRatePercent: 60, latencyMs: 100 },
  },
  notifications: {
    queue: 'notifications-calls',
    concurrency: 5,
    sync: { peakRequestsPerSecond: 2, p99LatencyMs: 1_500 },
    mock: { errorRatePercent: 5, latencyMs: 1_500 },
  },
} satisfies Record<string, DependencyConfig>;

export type DependencyName = keyof typeof DEPENDENCIES;

export const DEPENDENCY_NAMES = Object.keys(DEPENDENCIES) as DependencyName[];

export const SYNC_BULKHEAD_HEADROOM_PERCENT = 25;

export function syncBulkheadSlots(dependency: DependencyName): number {
  return bulkheadSlots({
    ...DEPENDENCIES[dependency].sync,
    headroomPercent: SYNC_BULKHEAD_HEADROOM_PERCENT,
  });
}

export const MOCK_MAX_LATENCY_MS = 60_000;

export const EXTERNAL_SERVICE_BASE_URL = `http://localhost:${APP_PORT}/mock`;

export const EXTERNAL_SERVICE_TIMEOUT_MS = 2_000;

export type CircuitBreakerStoreType = 'memory' | 'redis';

export const CIRCUIT_BREAKER_STORE = (process.env.CIRCUIT_BREAKER_STORE ??
  'memory') as CircuitBreakerStoreType;

export const SYNC_CIRCUIT_BREAKER_STORE: CircuitBreakerStoreType = 'memory';

export const CIRCUIT_BREAKER_HEALTH_PROBE_INTERVAL_MS = 1_000;

export const CIRCUIT_BREAKER_REDIS_KEY_PREFIX = 'circuit-breaker:';

const CIRCUIT_BREAKER_ERROR_THRESHOLD_PERCENT = 50;

const CIRCUIT_BREAKER_MINIMUM_REQUESTS = 10;

const CIRCUIT_BREAKER_WINDOW_MS = 10_000;

const CIRCUIT_BREAKER_WINDOW_BUCKETS = 10;

const CIRCUIT_BREAKER_OPEN_TIMEOUT_MS = 10_000;

const CIRCUIT_BREAKER_HALF_OPEN_SUCCESS_THRESHOLD = 2;

const CIRCUIT_BREAKER_HALF_OPEN_PROBE_LEASE_MS = 5_000;

export const CIRCUIT_BREAKER_OPTIONS: CircuitBreakerOptions = {
  errorThresholdPercent: CIRCUIT_BREAKER_ERROR_THRESHOLD_PERCENT,
  minimumRequests: CIRCUIT_BREAKER_MINIMUM_REQUESTS,
  windowMs: CIRCUIT_BREAKER_WINDOW_MS,
  windowBuckets: CIRCUIT_BREAKER_WINDOW_BUCKETS,
  openTimeoutMs: CIRCUIT_BREAKER_OPEN_TIMEOUT_MS,
  halfOpenSuccessThreshold: CIRCUIT_BREAKER_HALF_OPEN_SUCCESS_THRESHOLD,
  halfOpenProbeLeaseMs: CIRCUIT_BREAKER_HALF_OPEN_PROBE_LEASE_MS,
};

export const JOBS_MAX_PER_REQUEST = 1_000;

export const JOB_ATTEMPTS = 5;

export const JOB_BACKOFF_DELAY_MS = 1_000;

export const JOB_KEEP_COMPLETED = 1_000;

export const JOB_KEEP_FAILED = 5_000;

export const JOB_MAX_AGE_MS = 10 * 60_000;

export const JOB_POSTPONE_JITTER_MS = 2_000;
