import { Injectable } from '@nestjs/common';
import {
  CircuitBreakerOptions,
  CircuitState,
  CircuitStateChange,
  CircuitWindow,
} from '../circuit-breaker.js';
import {
  CircuitBreakerStore,
  CircuitBreakerStoreFactory,
  CircuitOperation,
  CircuitPermit,
  CircuitRecord,
  shouldTrip,
  toChange,
  toWindow,
  windowRange,
} from './circuit-breaker.store.js';

interface Bucket {
  successes: number;
  failures: number;
}

export class MemoryCircuitBreakerStore implements CircuitBreakerStore {
  readonly kind = 'memory';

  private state = CircuitState.CLOSED;
  private halfOpenSuccesses = 0;
  private openedAt: number | null = null;
  private probeExpiresAt = 0;
  private readonly buckets = new Map<number, Bucket>();
  private readonly stats = {
    successes: 0,
    failures: 0,
    rejected: 0,
    ignored: 0,
  };

  constructor(private readonly options: CircuitBreakerOptions) {}

  async acquire(now: number, allowProbe: boolean): Promise<CircuitPermit> {
    const { allowed, retryAfterMs, change } = this.apply(
      'acquire',
      now,
      allowProbe,
    );
    return allowed ? { allowed, change } : { allowed, retryAfterMs, change };
  }

  async recordSuccess(now: number) {
    return this.apply('success', now).change;
  }

  async recordFailure(now: number) {
    return this.apply('failure', now).change;
  }

  async recordIgnored(now: number) {
    return this.apply('ignore', now).change;
  }

  async reset(now: number) {
    return this.apply('reset', now).change;
  }

  async read(now: number): Promise<CircuitRecord> {
    const halfOpenDue = this.isOpenTimeoutElapsed(now);
    return {
      state: halfOpenDue ? CircuitState.HALF_OPEN : this.state,
      window: this.window(now),
      halfOpenSuccesses: halfOpenDue ? 0 : this.halfOpenSuccesses,
      openedAt: this.openedAt,
      retryAfterMs: this.openRetryAfterMs(now),
      stats: { ...this.stats },
    };
  }

  private apply(
    op: CircuitOperation,
    now: number,
    allowProbe = false,
  ): {
    allowed: boolean;
    retryAfterMs: number;
    change: CircuitStateChange | null;
  } {
    const initial = this.state;
    let allowed = true;
    let retryAfterMs = 0;

    if (this.isOpenTimeoutElapsed(now)) {
      this.state = CircuitState.HALF_OPEN;
      this.halfOpenSuccesses = 0;
      this.probeExpiresAt = 0;
    }

    switch (op) {
      case 'acquire':
        if (this.state === CircuitState.OPEN) {
          allowed = false;
          retryAfterMs = this.openRetryAfterMs(now);
        } else if (this.state === CircuitState.HALF_OPEN) {
          if (!allowProbe || this.probeExpiresAt > now) {
            allowed = false;
          } else {
            this.probeExpiresAt = now + this.options.halfOpenProbeLeaseMs;
          }
        }
        if (!allowed) {
          this.stats.rejected++;
        }
        break;

      case 'success':
        this.stats.successes++;
        if (this.state === CircuitState.HALF_OPEN) {
          this.probeExpiresAt = 0;
          this.halfOpenSuccesses++;
          if (this.halfOpenSuccesses >= this.options.halfOpenSuccessThreshold) {
            this.close();
          }
        } else if (this.state === CircuitState.CLOSED) {
          this.record(now, 'successes');
        }
        break;

      case 'failure':
        this.stats.failures++;
        if (this.state === CircuitState.HALF_OPEN) {
          this.open(now);
        } else if (this.state === CircuitState.CLOSED) {
          this.record(now, 'failures');
          if (shouldTrip(this.window(now), this.options)) {
            this.open(now);
          }
        }
        break;

      case 'ignore':
        this.stats.ignored++;
        if (this.state === CircuitState.HALF_OPEN) {
          this.probeExpiresAt = 0;
        }
        break;

      case 'reset':
        this.close();
        break;
    }

    return { allowed, retryAfterMs, change: toChange(initial, this.state) };
  }

  private record(now: number, outcome: keyof Bucket): void {
    const { current, oldest } = windowRange(now, this.options);
    for (const index of this.buckets.keys()) {
      if (index < oldest) {
        this.buckets.delete(index);
      }
    }
    const bucket = this.buckets.get(current) ?? { successes: 0, failures: 0 };
    bucket[outcome]++;
    this.buckets.set(current, bucket);
  }

  private window(now: number): CircuitWindow {
    const { oldest } = windowRange(now, this.options);
    let requests = 0;
    let failures = 0;
    for (const [index, bucket] of this.buckets) {
      if (index >= oldest) {
        requests += bucket.successes + bucket.failures;
        failures += bucket.failures;
      }
    }
    return toWindow(requests, failures);
  }

  private open(now: number): void {
    this.state = CircuitState.OPEN;
    this.openedAt = now;
    this.halfOpenSuccesses = 0;
    this.probeExpiresAt = 0;
  }

  private close(): void {
    this.state = CircuitState.CLOSED;
    this.halfOpenSuccesses = 0;
    this.openedAt = null;
    this.probeExpiresAt = 0;
    this.buckets.clear();
  }

  private isOpenTimeoutElapsed(now: number): boolean {
    return this.state === CircuitState.OPEN && this.openRetryAfterMs(now) === 0;
  }

  private openRetryAfterMs(now: number): number {
    if (this.state !== CircuitState.OPEN) {
      return 0;
    }
    return Math.max(0, this.openedAt! + this.options.openTimeoutMs - now);
  }
}

@Injectable()
export class MemoryCircuitBreakerStoreFactory extends CircuitBreakerStoreFactory {
  create(_name: string, options: CircuitBreakerOptions) {
    return new MemoryCircuitBreakerStore(options);
  }
}
