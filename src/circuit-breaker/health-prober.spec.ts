import type { Mock } from 'vitest';
import { CircuitBreaker, CircuitState } from './circuit-breaker.js';
import { HealthProber } from './health-prober.js';
import { MemoryCircuitBreakerStore } from './stores/memory-circuit-breaker.store.js';

describe('HealthProber', () => {
  let now: number;
  let healthCheck: Mock<() => Promise<void>>;
  let breaker: CircuitBreaker;
  let prober: HealthProber;

  beforeEach(() => {
    now = 1_000_000;
    healthCheck = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const store = new MemoryCircuitBreakerStore({
      errorThresholdPercent: 50,
      minimumRequests: 1,
      windowMs: 10_000,
      windowBuckets: 10,
      openTimeoutMs: 1_000,
      halfOpenSuccessThreshold: 1,
      halfOpenProbeLeaseMs: 500,
    });
    breaker = new CircuitBreaker('test', store, {
      now: () => now,
      healthCheck,
    });
    prober = new HealthProber(breaker, 1_000);
  });

  it('does nothing while the circuit is closed or still open', async () => {
    await prober.tick();
    await expect(
      breaker.execute(() => Promise.reject(new Error())),
    ).rejects.toThrow();
    await prober.tick();

    expect(healthCheck).not.toHaveBeenCalled();
    expect(await breaker.getState()).toBe(CircuitState.OPEN);
  });

  it('runs the health check once the circuit is half-open', async () => {
    await expect(
      breaker.execute(() => Promise.reject(new Error())),
    ).rejects.toThrow();
    now += 1_000;

    await prober.tick();

    expect(healthCheck).toHaveBeenCalledOnce();
    expect(await breaker.getState()).toBe(CircuitState.CLOSED);
  });

  async function makeHalfOpen() {
    await expect(
      breaker.execute(() => Promise.reject(new Error())),
    ).rejects.toThrow();
    now += 1_000;
  }

  describe('with the timer', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      prober.stop();
      vi.useRealTimers();
    });

    it('runs the health check on every interval until stopped', async () => {
      await makeHalfOpen();
      prober.start();
      prober.start();
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(999);
      expect(healthCheck).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(healthCheck).toHaveBeenCalledOnce();
      expect(await breaker.getState()).toBe(CircuitState.CLOSED);

      prober.stop();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('does not keep the process alive', () => {
      prober.start();
      expect(prober['timer']?.hasRef()).toBe(false);
    });

    it('skips a tick while the previous health check is still running', async () => {
      await makeHalfOpen();
      healthCheck.mockReturnValue(new Promise(() => undefined));
      prober.start();

      await vi.advanceTimersByTimeAsync(3_000);

      expect(healthCheck).toHaveBeenCalledOnce();
    });
  });

  it('logs a failed health check and leaves the circuit open', async () => {
    const warn = vi
      .spyOn(prober['logger'], 'warn')
      .mockImplementation(() => undefined);
    await makeHalfOpen();
    healthCheck.mockRejectedValue(new Error('still down'));

    await expect(prober.tick()).resolves.toBeUndefined();

    expect(await breaker.getState()).toBe(CircuitState.OPEN);
    expect(warn).toHaveBeenCalledWith('Health check failed: still down');
  });
});
