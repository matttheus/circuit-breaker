import type { CircuitBreakerStore } from './stores/circuit-breaker.store.js';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
  errorThresholdPercent: number;
  minimumRequests: number;
  windowMs: number;
  windowBuckets: number;
  openTimeoutMs: number;
  halfOpenSuccessThreshold: number;
  halfOpenProbeLeaseMs: number;
}

export interface CircuitStateChange {
  from: CircuitState;
  to: CircuitState;
}

export interface CircuitWindow {
  requests: number;
  failures: number;
  errorPercent: number;
}

export interface CircuitBreakerSnapshot {
  name: string;
  store: string;
  state: CircuitState;
  window: CircuitWindow;
  halfOpenSuccesses: number;
  openedAt: string | null;
  retryAfterMs: number;
  stats: {
    successes: number;
    failures: number;
    rejected: number;
    ignored: number;
  };
}

export interface CircuitBreakerHooks {
  now?: () => number;
  onStateChange?: (change: CircuitStateChange) => void;
  isFailure?: (error: unknown) => boolean;
  healthCheck?: () => Promise<unknown>;
}

export class CircuitOpenError extends Error {
  constructor(
    circuitName: string,
    readonly retryAfterMs: number,
  ) {
    super(`Circuit "${circuitName}" is open; retry in ${retryAfterMs}ms`);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  private readonly now: () => number;

  constructor(
    readonly name: string,
    private readonly store: CircuitBreakerStore,
    private readonly hooks: CircuitBreakerHooks = {},
  ) {
    this.now = hooks.now ?? Date.now;
  }

  async execute<T>(action: () => Promise<T>): Promise<T> {
    return this.run(action, !this.hooks.healthCheck);
  }

  async probe(): Promise<void> {
    const { healthCheck } = this.hooks;
    if (!healthCheck) {
      throw new Error(`Circuit "${this.name}" has no health check`);
    }
    await this.run(healthCheck, true);
  }

  private async run<T>(action: () => Promise<T>, allowProbe: boolean) {
    const permit = await this.store.acquire(this.now(), allowProbe);
    this.notify(permit.change);
    if (!permit.allowed) {
      throw new CircuitOpenError(this.name, permit.retryAfterMs);
    }

    let result: T;
    try {
      result = await action();
    } catch (error) {
      const isFailure = this.hooks.isFailure?.(error) ?? true;
      this.notify(
        await (isFailure
          ? this.store.recordFailure(this.now())
          : this.store.recordIgnored(this.now())),
      );
      throw error;
    }
    this.notify(await this.store.recordSuccess(this.now()));
    return result;
  }

  async getState(): Promise<CircuitState> {
    return (await this.snapshot()).state;
  }

  async snapshot(): Promise<CircuitBreakerSnapshot> {
    const record = await this.store.read(this.now());
    return {
      name: this.name,
      store: this.store.kind,
      ...record,
      openedAt:
        record.openedAt === null
          ? null
          : new Date(record.openedAt).toISOString(),
    };
  }

  async reset(): Promise<void> {
    this.notify(await this.store.reset(this.now()));
  }

  private notify(change: CircuitStateChange | null): void {
    if (change) {
      this.hooks.onStateChange?.(change);
    }
  }
}
