import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CircuitBreaker,
  CircuitBreakerSnapshot,
} from './circuit-breaker.js';
import { CircuitBreakerRegistry } from './circuit-breaker.registry.js';

@Injectable()
export class CircuitBreakerService {
  constructor(private readonly registry: CircuitBreakerRegistry) {}

  list(): Promise<CircuitBreakerSnapshot[]> {
    return this.registry.snapshots();
  }

  get(name: string): Promise<CircuitBreakerSnapshot> {
    return this.findOrFail(name).snapshot();
  }

  async reset(name: string): Promise<CircuitBreakerSnapshot> {
    const breaker = this.findOrFail(name);
    await breaker.reset();
    return breaker.snapshot();
  }

  private findOrFail(name: string): CircuitBreaker {
    const breaker = this.registry.get(name);
    if (!breaker) {
      throw new NotFoundException(`Circuit breaker "${name}" not found`);
    }
    return breaker;
  }
}
