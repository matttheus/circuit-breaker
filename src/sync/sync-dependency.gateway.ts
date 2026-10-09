import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Bulkhead } from '../bulkhead/bulkhead.js';
import { CircuitBreaker } from '../circuit-breaker/circuit-breaker.js';
import { CircuitBreakerRegistry } from '../circuit-breaker/circuit-breaker.registry.js';
import { HealthProber } from '../circuit-breaker/health-prober.js';
import {
  CIRCUIT_BREAKER_HEALTH_PROBE_INTERVAL_MS,
  CIRCUIT_BREAKER_OPTIONS,
  DEPENDENCIES,
  DEPENDENCY_NAMES,
  DependencyName,
  SYNC_BULKHEAD_HEADROOM_PERCENT,
  SYNC_CIRCUIT_BREAKER_STORE,
  syncBulkheadSlots,
} from '../config/constants.js';
import { isDependencyFailure } from '../external-service/dependency.errors.js';
import { ExternalServiceClient } from '../external-service/external-service.client.js';

interface SyncDependency {
  breaker: CircuitBreaker;
  bulkhead: Bulkhead;
  prober: HealthProber;
}

export const syncCircuitName = (dependency: DependencyName) =>
  `${dependency}-sync`;

@Injectable()
export class SyncDependencyGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncDependencyGateway.name);
  private readonly dependencies: Map<DependencyName, SyncDependency>;

  constructor(
    registry: CircuitBreakerRegistry,
    private readonly client: ExternalServiceClient,
  ) {
    this.dependencies = new Map(
      DEPENDENCY_NAMES.map((name) => {
        const breaker = registry.getOrCreate(
          syncCircuitName(name),
          CIRCUIT_BREAKER_OPTIONS,
          {
            store: SYNC_CIRCUIT_BREAKER_STORE,
            isFailure: isDependencyFailure,
            healthCheck: () => client.healthCheck(name),
          },
        );
        return [
          name,
          {
            breaker,
            bulkhead: new Bulkhead(name, syncBulkheadSlots(name)),
            prober: new HealthProber(
              breaker,
              CIRCUIT_BREAKER_HEALTH_PROBE_INTERVAL_MS,
            ),
          },
        ];
      }),
    );
  }

  call(dependency: DependencyName, payload: unknown): Promise<unknown> {
    const { breaker, bulkhead } = this.dependencies.get(dependency)!;
    return bulkhead.execute(() =>
      breaker.execute(() => this.client.send(dependency, payload)),
    );
  }

  onModuleInit() {
    this.dependencies.forEach(({ bulkhead, prober }, name) => {
      const { peakRequestsPerSecond, p99LatencyMs } = DEPENDENCIES[name].sync;
      this.logger.log(
        `Bulkhead "${name}": ${bulkhead.maxConcurrent} slots ` +
          `(${peakRequestsPerSecond} req/s × ${p99LatencyMs}ms + ${SYNC_BULKHEAD_HEADROOM_PERCENT}%)`,
      );
      prober.start();
    });
  }

  onModuleDestroy() {
    this.dependencies.forEach(({ prober }) => prober.stop());
  }
}
