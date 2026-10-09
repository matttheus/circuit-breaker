import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  DEPENDENCIES,
  DEPENDENCY_NAMES,
  type DependencyName,
} from '../config/constants.js';
import type {
  MockBehavior,
  MockCallResponse,
  MockDependencyStats,
  MockHealthResponse,
  MockStats,
} from './mock-external-service.types.js';

@Injectable()
export class MockExternalService {
  private readonly behaviors = new Map<DependencyName, MockBehavior>();
  private readonly stats = new Map<DependencyName, MockStats>();

  constructor() {
    DEPENDENCY_NAMES.forEach((name) => this.reset(name));
  }

  getStats(): Record<DependencyName, MockDependencyStats> {
    return Object.fromEntries(
      DEPENDENCY_NAMES.map((name) => [name, this.statsOf(name)]),
    ) as Record<DependencyName, MockDependencyStats>;
  }

  setBehavior(
    dependency: DependencyName,
    changes: Partial<MockBehavior>,
  ): MockBehavior {
    const behavior = { ...this.behaviors.get(dependency)!, ...changes };
    this.behaviors.set(dependency, behavior);
    return behavior;
  }

  reset(dependency: DependencyName): MockDependencyStats {
    this.behaviors.set(dependency, { ...DEPENDENCIES[dependency].mock });
    this.stats.set(dependency, {
      received: 0,
      succeeded: 0,
      failed: 0,
      badRequests: 0,
      healthChecks: 0,
      inFlight: 0,
      maxInFlight: 0,
    });
    return this.statsOf(dependency);
  }

  async health(dependency: DependencyName): Promise<MockHealthResponse> {
    const behavior = this.behaviors.get(dependency)!;
    this.stats.get(dependency)!.healthChecks++;
    await sleep(behavior.latencyMs);
    if (Math.random() * 100 < behavior.errorRatePercent) {
      throw new ServiceUnavailableException(`${dependency} is unhealthy`);
    }
    return { status: 'ok' };
  }

  async handle(
    dependency: DependencyName,
    payload: Record<string, unknown>,
  ): Promise<MockCallResponse> {
    const behavior = this.behaviors.get(dependency)!;
    const stats = this.stats.get(dependency)!;
    stats.received++;
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);

    try {
      await sleep(behavior.latencyMs);
      if (payload.invalid === true) {
        stats.badRequests++;
        throw new BadRequestException('Invalid payload');
      }
      if (Math.random() * 100 < behavior.errorRatePercent) {
        stats.failed++;
        throw new InternalServerErrorException(
          `Simulated ${dependency} failure`,
        );
      }
      stats.succeeded++;
      return { ok: true, processedAt: new Date().toISOString(), payload };
    } finally {
      stats.inFlight--;
    }
  }

  private statsOf(dependency: DependencyName): MockDependencyStats {
    return {
      ...this.behaviors.get(dependency)!,
      ...this.stats.get(dependency)!,
    };
  }
}
