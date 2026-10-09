import { DelayedError, Job, UnrecoverableError } from 'bullmq';
import { CircuitBreakerRegistry } from '../circuit-breaker/circuit-breaker.registry.js';
import { MemoryCircuitBreakerStoreFactory } from '../circuit-breaker/stores/memory-circuit-breaker.store.js';
import { RedisCircuitBreakerStoreFactory } from '../circuit-breaker/stores/redis-circuit-breaker.store.js';
import {
  CIRCUIT_BREAKER_OPTIONS,
  JOB_MAX_AGE_MS,
  JOB_POSTPONE_JITTER_MS,
} from '../config/constants.js';
import { DependencyHttpError } from '../external-service/dependency.errors.js';
import { ExternalServiceClient } from '../external-service/external-service.client.js';
import { PaymentsProcessor } from './dependency-processors.js';
import { ExternalCallJobData } from './external-call.job.js';

describe('DependencyCallProcessor', () => {
  let client: { send: ReturnType<typeof vi.fn> };
  let processor: PaymentsProcessor;
  let job: Job<ExternalCallJobData>;
  let moveToDelayed: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const registry = new CircuitBreakerRegistry(
      new MemoryCircuitBreakerStoreFactory(),
      new RedisCircuitBreakerStoreFactory(),
      'memory',
    );
    client = { send: vi.fn() };
    processor = new PaymentsProcessor(
      registry,
      client as unknown as ExternalServiceClient,
    );
    moveToDelayed = vi.fn();
    job = {
      id: '1',
      timestamp: Date.now(),
      data: { requestId: 'r', createdAt: '' },
      moveToDelayed,
    } as unknown as Job<ExternalCallJobData>;
  });

  it('fails a job with a 4xx response without retrying it', async () => {
    client.send.mockRejectedValue(
      new DependencyHttpError('payments', 400, null),
    );
    await expect(processor.process(job, 'token')).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('rethrows 5xx so BullMQ retries with backoff', async () => {
    client.send.mockRejectedValue(
      new DependencyHttpError('payments', 500, null),
    );
    await expect(processor.process(job, 'token')).rejects.toBeInstanceOf(
      DependencyHttpError,
    );
  });

  async function openCircuit() {
    client.send.mockRejectedValue(
      new DependencyHttpError('payments', 500, null),
    );
    for (let i = 0; i < CIRCUIT_BREAKER_OPTIONS.minimumRequests; i++) {
      await processor.process(job, 'token').catch(() => undefined);
    }
    client.send.mockClear();
  }

  it('postpones the job with jitter, without calling the dependency, when the circuit is open', async () => {
    await openCircuit();
    const before = Date.now();

    await expect(processor.process(job, 'token')).rejects.toBeInstanceOf(
      DelayedError,
    );
    expect(client.send).not.toHaveBeenCalled();
    expect(moveToDelayed).toHaveBeenCalledOnce();

    const delay = (moveToDelayed.mock.calls[0][0] as number) - before;
    expect(delay).toBeGreaterThan(
      CIRCUIT_BREAKER_OPTIONS.openTimeoutMs - 1_000,
    );
    expect(delay).toBeLessThanOrEqual(
      CIRCUIT_BREAKER_OPTIONS.openTimeoutMs + JOB_POSTPONE_JITTER_MS + 100,
    );
  });

  it('fails a postponed job that is older than the max age', async () => {
    await openCircuit();
    job.timestamp = Date.now() - JOB_MAX_AGE_MS;

    await expect(processor.process(job, 'token')).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(moveToDelayed).not.toHaveBeenCalled();
  });

  it('logs non-retryable failures as final', () => {
    const warn = vi
      .spyOn(processor['logger'], 'warn')
      .mockImplementation(() => undefined);
    job.opts = { attempts: 5 };
    job.attemptsMade = 1;

    processor.onFailed(job, new UnrecoverableError('HTTP 400'));
    processor.onFailed(job, new Error('HTTP 500'));

    expect(warn.mock.calls[0][0]).toContain('giving up (not retryable)');
    expect(warn.mock.calls[1][0]).not.toContain('giving up');
  });

  it('logs the attempt number of a completed job as reported by BullMQ', () => {
    const log = vi
      .spyOn(processor['logger'], 'log')
      .mockImplementation(() => undefined);
    job.attemptsMade = 1;

    processor.onCompleted(job);

    expect(log.mock.calls[0][0]).toContain('attempt 1');
  });
});
