import { DynamicModule, Module } from '@nestjs/common';
import type { CircuitBreakerStoreType } from '../config/constants.js';
import { CircuitBreakerController } from './circuit-breaker.controller.js';
import { CircuitBreakerService } from './circuit-breaker.service.js';
import {
  CircuitBreakerRegistry,
  DEFAULT_CIRCUIT_BREAKER_STORE,
} from './circuit-breaker.registry.js';
import { MemoryCircuitBreakerStoreFactory } from './stores/memory-circuit-breaker.store.js';
import { RedisCircuitBreakerStoreFactory } from './stores/redis-circuit-breaker.store.js';

const STORES: CircuitBreakerStoreType[] = ['memory', 'redis'];

interface CircuitBreakerModuleOptions {
  store: CircuitBreakerStoreType;
}

@Module({})
export class CircuitBreakerModule {
  static forRoot({ store }: CircuitBreakerModuleOptions): DynamicModule {
    if (!STORES.includes(store)) {
      throw new Error(
        `Invalid circuit breaker store "${store}". Use: ${STORES.join(', ')}`,
      );
    }

    return {
      module: CircuitBreakerModule,
      global: true,
      controllers: [CircuitBreakerController],
      providers: [
        { provide: DEFAULT_CIRCUIT_BREAKER_STORE, useValue: store },
        MemoryCircuitBreakerStoreFactory,
        RedisCircuitBreakerStoreFactory,
        CircuitBreakerRegistry,
        CircuitBreakerService,
      ],
      exports: [CircuitBreakerRegistry],
    };
  }
}
