import type { Mock } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import {
  CircuitBreaker,
  CircuitBreakerHooks,
  CircuitBreakerOptions,
  CircuitOpenError,
  CircuitState,
} from './circuit-breaker.js';
import { CircuitBreakerStore } from './stores/circuit-breaker.store.js';
import { MemoryCircuitBreakerStore } from './stores/memory-circuit-breaker.store.js';
import {
  circuitKeys,
  RedisCircuitBreakerStore,
  RedisWithTransition,
  withTransitionCommand,
} from './stores/redis-circuit-breaker.store.js';

const ok = () => Promise.resolve('ok');
const fail = () => Promise.reject(new Error('boom'));

const OPTIONS: CircuitBreakerOptions = {
  errorThresholdPercent: 50,
  minimumRequests: 4,
  windowMs: 10_000,
  windowBuckets: 10,
  openTimeoutMs: 1_000,
  halfOpenSuccessThreshold: 2,
  halfOpenProbeLeaseMs: 500,
};

const container = await new RedisContainer('redis:7-alpine').start();
const redis: RedisWithTransition = withTransitionCommand(
  new Redis(container.getConnectionUrl()),
);

type StoreBuilder = (
  name: string,
  options: CircuitBreakerOptions,
) => CircuitBreakerStore;

const stores: { kind: string; build: StoreBuilder }[] = [
  {
    kind: 'memory',
    build: (_name, options) => new MemoryCircuitBreakerStore(options),
  },
  {
    kind: 'redis',
    build: (name, options) =>
      new RedisCircuitBreakerStore(redis, name, options),
  },
];

afterAll(async () => {
  await redis.quit();
  await container.stop();
});

describe.each(stores)('CircuitBreaker ($kind store)', ({ kind, build }) => {
  let now: number;
  let name: string;
  let breaker: CircuitBreaker;

  function createBreaker(
    options: CircuitBreakerOptions = OPTIONS,
    hooks: CircuitBreakerHooks = {},
  ) {
    return new CircuitBreaker(name, build(name, options), {
      now: () => now,
      ...hooks,
    });
  }

  beforeEach(() => {
    now = 1_000_000;
    name = `test-${randomUUID()}`;
    breaker = createBreaker();
  });

  afterEach(async () => {
    const keys = circuitKeys(name);
    await redis.del(keys.state, keys.window);
  });

  async function failTimes(times: number) {
    for (let i = 0; i < times; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow('boom');
    }
  }

  async function succeedTimes(times: number) {
    for (let i = 0; i < times; i++) {
      await breaker.execute(ok);
    }
  }

  const trip = () => failTimes(OPTIONS.minimumRequests);

  it('stays closed below the minimum volume, even with 100% errors', async () => {
    await failTimes(OPTIONS.minimumRequests - 1);
    expect(await breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it('opens when the error percentage reaches the threshold', async () => {
    await succeedTimes(2);
    await failTimes(2);

    const snapshot = await breaker.snapshot();
    expect(snapshot.state).toBe(CircuitState.OPEN);
    expect(snapshot.window).toEqual({
      requests: 4,
      failures: 2,
      errorPercent: 50,
    });
  });

  it('stays closed while the error percentage is below the threshold', async () => {
    await succeedTimes(3);
    await failTimes(2);

    const snapshot = await breaker.snapshot();
    expect(snapshot.state).toBe(CircuitState.CLOSED);
    expect(snapshot.window.errorPercent).toBe(40);
  });

  it('forgets calls that slid out of the window', async () => {
    await failTimes(3);
    now += OPTIONS.windowMs;
    await succeedTimes(3);
    await failTimes(1);

    const snapshot = await breaker.snapshot();
    expect(snapshot.state).toBe(CircuitState.CLOSED);
    expect(snapshot.window).toEqual({
      requests: 4,
      failures: 1,
      errorPercent: 25,
    });
  });

  it('rejects without calling the action while open', async () => {
    await trip();
    expect(await breaker.getState()).toBe(CircuitState.OPEN);

    const action = vi.fn(ok);
    now += 400;
    const error = await breaker.execute(action).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CircuitOpenError);
    expect((error as CircuitOpenError).retryAfterMs).toBe(600);
    expect(action).not.toHaveBeenCalled();
    expect((await breaker.snapshot()).stats).toEqual({
      successes: 0,
      failures: 4,
      rejected: 1,
      ignored: 0,
    });
  });

  it('goes half-open after the timeout and closes after enough successes', async () => {
    await trip();
    now += 1_000;
    expect(await breaker.getState()).toBe(CircuitState.HALF_OPEN);

    await breaker.execute(ok);
    expect(await breaker.getState()).toBe(CircuitState.HALF_OPEN);
    await breaker.execute(ok);

    const snapshot = await breaker.snapshot();
    expect(snapshot.state).toBe(CircuitState.CLOSED);
    expect(snapshot.window.requests).toBe(0);
  });

  it('reopens when the half-open probe fails', async () => {
    await trip();
    now += 1_000;
    await failTimes(1);

    const snapshot = await breaker.snapshot();
    expect(snapshot.state).toBe(CircuitState.OPEN);
    expect(snapshot.retryAfterMs).toBe(1_000);
  });

  it('allows only one probe at a time while half-open', async () => {
    await trip();
    now += 1_000;

    let release!: () => void;
    const probe = breaker.execute(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    await vi.waitFor(() => expect(release).toBeDefined());

    await expect(breaker.execute(ok)).rejects.toBeInstanceOf(CircuitOpenError);
    release();
    await probe;
  });

  it('lets another probe through when the previous one never finished', async () => {
    await trip();
    now += 1_000;

    void breaker.execute(() => new Promise(() => undefined));
    await vi.waitFor(async () =>
      expect(breaker.execute(ok)).rejects.toBeInstanceOf(CircuitOpenError),
    );

    now += OPTIONS.halfOpenProbeLeaseMs;
    await expect(breaker.execute(ok)).resolves.toBe('ok');
  });

  it('keeps the circuit open when a call admitted before the trip succeeds', async () => {
    let release!: () => void;
    const lateCall = breaker.execute(
      () => new Promise<string>((resolve) => (release = () => resolve('ok'))),
    );
    await vi.waitFor(() => expect(release).toBeDefined());
    await trip();

    release();
    await expect(lateCall).resolves.toBe('ok');

    const snapshot = await breaker.snapshot();
    expect(snapshot.state).toBe(CircuitState.OPEN);
    expect(snapshot.window).toEqual({
      requests: 4,
      failures: 4,
      errorPercent: 100,
    });
    expect(snapshot.stats.successes).toBe(1);
  });

  it('does not restart the open timeout when a call admitted before the trip fails', async () => {
    let fail!: (error: Error) => void;
    const lateCall = breaker.execute(
      () => new Promise((_resolve, reject) => (fail = reject)),
    );
    await vi.waitFor(() => expect(fail).toBeDefined());
    await trip();
    now += 400;

    fail(new Error('late'));
    await expect(lateCall).rejects.toThrow('late');

    const snapshot = await breaker.snapshot();
    expect(snapshot.state).toBe(CircuitState.OPEN);
    expect(snapshot.retryAfterMs).toBe(600);
    expect(snapshot.window.requests).toBe(4);
    expect(snapshot.stats.failures).toBe(5);
  });

  it('can be reset manually', async () => {
    await trip();
    await breaker.reset();
    expect(await breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it('notifies state changes', async () => {
    const onStateChange = vi.fn();
    breaker = createBreaker(
      { ...OPTIONS, minimumRequests: 1, halfOpenSuccessThreshold: 1 },
      { onStateChange },
    );

    await failTimes(1);
    now += 1_000;
    await breaker.execute(ok);

    expect(onStateChange.mock.calls).toEqual([
      [{ from: CircuitState.CLOSED, to: CircuitState.OPEN }],
      [{ from: CircuitState.OPEN, to: CircuitState.HALF_OPEN }],
      [{ from: CircuitState.HALF_OPEN, to: CircuitState.CLOSED }],
    ]);
  });

  describe('with errors classified as non-failures', () => {
    const clientError = new Error('bad request');
    const rejectWithClientError = () => Promise.reject(clientError);

    beforeEach(() => {
      breaker = createBreaker(OPTIONS, { isFailure: (e) => e !== clientError });
    });

    it('rethrows them without counting them in the window', async () => {
      for (let i = 0; i < OPTIONS.minimumRequests * 2; i++) {
        await expect(breaker.execute(rejectWithClientError)).rejects.toBe(
          clientError,
        );
      }

      const snapshot = await breaker.snapshot();
      expect(snapshot.state).toBe(CircuitState.CLOSED);
      expect(snapshot.window.requests).toBe(0);
      expect(snapshot.stats.ignored).toBe(OPTIONS.minimumRequests * 2);
    });

    it('does not dilute the error percentage', async () => {
      for (let i = 0; i < 10; i++) {
        await expect(breaker.execute(rejectWithClientError)).rejects.toThrow();
      }
      await trip();

      expect(await breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('releases the half-open probe without closing the circuit', async () => {
      await trip();
      now += OPTIONS.openTimeoutMs;

      await expect(breaker.execute(rejectWithClientError)).rejects.toThrow();
      expect(await breaker.getState()).toBe(CircuitState.HALF_OPEN);
      await expect(breaker.execute(ok)).resolves.toBe('ok');
    });
  });

  describe('with a background health check', () => {
    let healthCheck: Mock<() => Promise<unknown>>;

    beforeEach(async () => {
      healthCheck = vi.fn<() => Promise<unknown>>(ok);
      breaker = createBreaker(OPTIONS, { healthCheck });
      await trip();
      now += OPTIONS.openTimeoutMs;
    });

    it('never uses a real call as the half-open probe', async () => {
      const action = vi.fn(ok);
      await expect(breaker.execute(action)).rejects.toBeInstanceOf(
        CircuitOpenError,
      );
      expect(action).not.toHaveBeenCalled();
      expect(await breaker.getState()).toBe(CircuitState.HALF_OPEN);
    });

    it('closes after enough successful health checks', async () => {
      await breaker.probe();
      await breaker.probe();

      expect(healthCheck).toHaveBeenCalledTimes(2);
      expect(await breaker.getState()).toBe(CircuitState.CLOSED);
      await expect(breaker.execute(ok)).resolves.toBe('ok');
    });

    it('reopens when the health check fails', async () => {
      healthCheck.mockRejectedValueOnce(new Error('unhealthy'));
      await expect(breaker.probe()).rejects.toThrow('unhealthy');
      expect(await breaker.getState()).toBe(CircuitState.OPEN);
    });
  });

  if (kind === 'redis') {
    it('keeps the window hash bounded when there are only successes', async () => {
      for (let i = 0; i < OPTIONS.windowBuckets * 5; i++) {
        await breaker.execute(ok);
        now += OPTIONS.windowMs / OPTIONS.windowBuckets;
      }
      expect(await redis.hlen(circuitKeys(name).window)).toBeLessThanOrEqual(
        OPTIONS.windowBuckets * 2,
      );
    });

    it('shares state between breakers with the same name', async () => {
      await trip();
      const otherWorker = createBreaker();
      await expect(otherWorker.execute(ok)).rejects.toBeInstanceOf(
        CircuitOpenError,
      );
    });
  }
});

describe('CircuitBreaker without a health check', () => {
  it('refuses to probe', async () => {
    const breaker = new CircuitBreaker(
      'no-health-check',
      new MemoryCircuitBreakerStore(OPTIONS),
    );
    await expect(breaker.probe()).rejects.toThrow('has no health check');
  });
});
