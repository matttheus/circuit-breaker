import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CircuitBreakerStoreType } from '../config/constants.js';
import {
  CircuitBreaker,
  CircuitBreakerHooks,
  CircuitBreakerOptions,
  CircuitBreakerSnapshot,
} from './circuit-breaker.js';
import { CircuitBreakerStoreFactory } from './stores/circuit-breaker.store.js';
import { MemoryCircuitBreakerStoreFactory } from './stores/memory-circuit-breaker.store.js';
import { RedisCircuitBreakerStoreFactory } from './stores/redis-circuit-breaker.store.js';

export const DEFAULT_CIRCUIT_BREAKER_STORE = Symbol(
  'DEFAULT_CIRCUIT_BREAKER_STORE',
);

interface CircuitBreakerSettings extends Pick<
  CircuitBreakerHooks,
  'isFailure' | 'healthCheck'
> {
  store?: CircuitBreakerStoreType;
}

@Injectable()
export class CircuitBreakerRegistry {
  private readonly logger = new Logger(CircuitBreakerRegistry.name);
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly factories: Record<
    CircuitBreakerStoreType,
    CircuitBreakerStoreFactory
  >;

  constructor(
    memory: MemoryCircuitBreakerStoreFactory,
    redis: RedisCircuitBreakerStoreFactory,
    @Inject(DEFAULT_CIRCUIT_BREAKER_STORE)
    private readonly defaultStore: CircuitBreakerStoreType,
  ) {
    this.factories = { memory, redis };
  }

  getOrCreate(
    name: string,
    options: CircuitBreakerOptions,
    { store = this.defaultStore, ...hooks }: CircuitBreakerSettings = {},
  ): CircuitBreaker {
    let breaker = this.breakers.get(name);
    if (!breaker) {
      breaker = new CircuitBreaker(
        name,
        this.factories[store].create(name, options),
        {
          ...hooks,
          onStateChange: ({ from, to }) =>
            this.logger.warn(`Circuit "${name}": ${from} -> ${to}`),
        },
      );
      this.breakers.set(name, breaker);
    }
    return breaker;
  }

  get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  snapshots(): Promise<CircuitBreakerSnapshot[]> {
    return Promise.all(
      [...this.breakers.values()].map((breaker) => breaker.snapshot()),
    );
  }
}
