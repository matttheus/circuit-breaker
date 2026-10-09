import { BulkheadRejectedError } from '../bulkhead/bulkhead.js';
import {
  CircuitOpenError,
  CircuitState,
} from '../circuit-breaker/circuit-breaker.js';
import { CircuitBreakerRegistry } from '../circuit-breaker/circuit-breaker.registry.js';
import { MemoryCircuitBreakerStoreFactory } from '../circuit-breaker/stores/memory-circuit-breaker.store.js';
import { RedisCircuitBreakerStoreFactory } from '../circuit-breaker/stores/redis-circuit-breaker.store.js';
import {
  CIRCUIT_BREAKER_HEALTH_PROBE_INTERVAL_MS,
  CIRCUIT_BREAKER_OPTIONS,
  syncBulkheadSlots,
} from '../config/constants.js';
import { DependencyHttpError } from '../external-service/dependency.errors.js';
import { ExternalServiceClient } from '../external-service/external-service.client.js';
import {
  syncCircuitName,
  SyncDependencyGateway,
} from './sync-dependency.gateway.js';

describe('SyncDependencyGateway', () => {
  let registry: CircuitBreakerRegistry;
  let client: {
    send: ReturnType<typeof vi.fn>;
    healthCheck: ReturnType<typeof vi.fn>;
  };
  let gateway: SyncDependencyGateway;

  function createGateway() {
    registry = new CircuitBreakerRegistry(
      new MemoryCircuitBreakerStoreFactory(),
      new RedisCircuitBreakerStoreFactory(),
      'redis',
    );
    client = { send: vi.fn(), healthCheck: vi.fn() };
    gateway = new SyncDependencyGateway(
      registry,
      client as unknown as ExternalServiceClient,
    );
  }

  beforeEach(createGateway);

  const state = () => registry.get(syncCircuitName('payments'))!.getState();

  it('uses the memory store, regardless of the default store', async () => {
    const snapshot = await registry
      .get(syncCircuitName('payments'))!
      .snapshot();
    expect(snapshot.store).toBe('memory');
  });

  it('calls the dependency exactly once when it fails (no retry)', async () => {
    client.send.mockRejectedValue(
      new DependencyHttpError('payments', 500, null),
    );

    await expect(gateway.call('payments', {})).rejects.toBeInstanceOf(
      DependencyHttpError,
    );
    expect(client.send).toHaveBeenCalledOnce();
  });

  it('does not open the circuit on 4xx responses', async () => {
    client.send.mockRejectedValue(
      new DependencyHttpError('payments', 400, null),
    );

    for (let i = 0; i < CIRCUIT_BREAKER_OPTIONS.minimumRequests * 2; i++) {
      await expect(gateway.call('payments', {})).rejects.toThrow();
    }
    expect(await state()).toBe(CircuitState.CLOSED);
  });

  it('opens the circuit on 5xx and then fails fast without calling the dependency', async () => {
    client.send.mockRejectedValue(
      new DependencyHttpError('payments', 500, null),
    );
    for (let i = 0; i < CIRCUIT_BREAKER_OPTIONS.minimumRequests; i++) {
      await expect(gateway.call('payments', {})).rejects.toThrow();
    }
    expect(await state()).toBe(CircuitState.OPEN);

    client.send.mockClear();
    await expect(gateway.call('payments', {})).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
    expect(client.send).not.toHaveBeenCalled();
  });

  function holdCalls(dependency: 'payments' | 'notifications', count: number) {
    let release!: () => void;
    const blocked = new Promise((resolve) => (release = () => resolve({})));
    client.send.mockReturnValue(blocked);
    const calls = Array.from({ length: count }, () =>
      gateway.call(dependency, {}),
    );
    return { calls, release };
  }

  it('rejects calls above the slots computed for the dependency', async () => {
    const slots = syncBulkheadSlots('notifications');
    const { calls, release } = holdCalls('notifications', slots);
    await vi.waitFor(() => expect(client.send).toHaveBeenCalledTimes(slots));

    await expect(gateway.call('notifications', {})).rejects.toBeInstanceOf(
      BulkheadRejectedError,
    );
    release();
    await Promise.all(calls);
  });

  it('does not open the circuit on a traffic spike to a healthy dependency', async () => {
    const slots = syncBulkheadSlots('payments');
    const { calls, release } = holdCalls('payments', slots);
    await vi.waitFor(() => expect(client.send).toHaveBeenCalledTimes(slots));

    const excess = CIRCUIT_BREAKER_OPTIONS.minimumRequests * 3;
    for (let i = 0; i < excess; i++) {
      await expect(gateway.call('payments', {})).rejects.toBeInstanceOf(
        BulkheadRejectedError,
      );
    }
    release();
    await Promise.all(calls);

    const snapshot = await registry
      .get(syncCircuitName('payments'))!
      .snapshot();
    expect(snapshot.state).toBe(CircuitState.CLOSED);
    expect(snapshot.window).toMatchObject({ requests: slots, failures: 0 });
    expect(client.send).toHaveBeenCalledTimes(slots);
  });

  describe('lifecycle', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      createGateway();
    });

    afterEach(() => {
      gateway.onModuleDestroy();
      vi.useRealTimers();
    });

    it('closes a half-open circuit with background health checks once the module starts', async () => {
      client.send.mockRejectedValue(
        new DependencyHttpError('payments', 500, null),
      );
      for (let i = 0; i < CIRCUIT_BREAKER_OPTIONS.minimumRequests; i++) {
        await expect(gateway.call('payments', {})).rejects.toThrow();
      }
      client.healthCheck.mockResolvedValue(undefined);

      gateway.onModuleInit();
      await vi.advanceTimersByTimeAsync(
        CIRCUIT_BREAKER_OPTIONS.openTimeoutMs +
          CIRCUIT_BREAKER_HEALTH_PROBE_INTERVAL_MS *
            CIRCUIT_BREAKER_OPTIONS.halfOpenSuccessThreshold,
      );

      expect(client.healthCheck).toHaveBeenCalledTimes(
        CIRCUIT_BREAKER_OPTIONS.halfOpenSuccessThreshold,
      );
      expect(client.healthCheck).toHaveBeenCalledWith('payments');
      expect(await state()).toBe(CircuitState.CLOSED);
    });

    it('stops the health checks when the module is destroyed', () => {
      gateway.onModuleInit();
      expect(vi.getTimerCount()).toBe(2);

      gateway.onModuleDestroy();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
