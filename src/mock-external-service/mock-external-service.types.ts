import type { DependencyConfig } from '../config/constants.js';

export type MockBehavior = DependencyConfig['mock'];

export interface MockStats {
  received: number;
  succeeded: number;
  failed: number;
  badRequests: number;
  healthChecks: number;
  inFlight: number;
  maxInFlight: number;
}

export type MockDependencyStats = MockBehavior & MockStats;

export interface MockHealthResponse {
  status: 'ok';
}

export interface MockCallResponse {
  ok: true;
  processedAt: string;
  payload: unknown;
}
