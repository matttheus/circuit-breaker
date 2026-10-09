import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RedisContainer } from '@testcontainers/redis';
import { Job, JobState, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Mock } from 'vitest';
import { CircuitBreakerModule } from '../circuit-breaker/circuit-breaker.module.js';
import { CircuitBreakerRegistry } from '../circuit-breaker/circuit-breaker.registry.js';
import {
  RedisCircuitBreakerStoreFactory,
  withTransitionCommand,
} from '../circuit-breaker/stores/redis-circuit-breaker.store.js';
import {
  CIRCUIT_BREAKER_OPTIONS,
  DEPENDENCIES,
  JOB_MAX_AGE_MS,
} from '../config/constants.js';
import { DependencyHttpError } from '../external-service/dependency.errors.js';
import { ExternalServiceClient } from '../external-service/external-service.client.js';
import { ExternalCallJobData } from './external-call.job.js';
import { ProcessingModule } from './processing.module.js';
import { ProcessingService } from './processing.service.js';

const container = await new RedisContainer('redis:7-alpine').start();
const connection = { host: container.getHost(), port: container.getPort() };
const redis = new Redis(connection);
const queueName = DEPENDENCIES.payments.queue;
const inspector = new Queue<ExternalCallJobData>(queueName, { connection });

afterAll(async () => {
  await inspector.close();
  await redis.quit();
  await container.stop();
});

describe('ProcessingModule with BullMQ', () => {
  let app: INestApplication | undefined;
  let client: { send: Mock; healthCheck: Mock };

  beforeEach(async () => {
    await redis.flushall();
    client = { send: vi.fn(), healthCheck: vi.fn() };
    const circuitStores = new RedisCircuitBreakerStoreFactory();
    circuitStores['redis'] = withTransitionCommand(
      new Redis(container.getConnectionUrl()),
    );

    const moduleRef = await Test.createTestingModule({
      imports: [
        BullModule.forRoot({ connection }),
        CircuitBreakerModule.forRoot({ store: 'redis' }),
        ProcessingModule,
      ],
    })
      .overrideProvider(ExternalServiceClient)
      .useValue(client)
      .overrideProvider(RedisCircuitBreakerStoreFactory)
      .useValue(circuitStores)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const service = () => app!.get(ProcessingService);

  async function onlyJob(): Promise<Job<ExternalCallJobData>> {
    const [job] = await inspector.getJobs();
    expect(job).toBeDefined();
    return job;
  }

  async function waitForJob(
    state: JobState,
  ): Promise<Job<ExternalCallJobData>> {
    await vi.waitFor(
      async () => expect(await (await onlyJob()).getState()).toBe(state),
      { timeout: 5_000, interval: 50 },
    );
    return onlyJob();
  }

  async function openCircuit() {
    const breaker = app!.get(CircuitBreakerRegistry).get('payments')!;
    for (let i = 0; i < CIRCUIT_BREAKER_OPTIONS.minimumRequests; i++) {
      await breaker
        .execute(() =>
          Promise.reject(new DependencyHttpError('payments', 500, null)),
        )
        .catch(() => undefined);
    }
  }

  it('completes a job and reports it in the queue counts', async () => {
    client.send.mockResolvedValue({ ok: true });

    await expect(service().enqueue('payments', 1)).resolves.toEqual({
      dependency: 'payments',
      enqueued: 1,
    });
    await waitForJob('completed');

    expect(client.send).toHaveBeenCalledWith(
      'payments',
      expect.objectContaining({ requestId: expect.any(String) }),
    );
    expect((await service().counts()).payments).toMatchObject({
      completed: 1,
      failed: 0,
    });
  });

  it('retries a 5xx with backoff and completes on the next attempt', async () => {
    client.send
      .mockRejectedValueOnce(new DependencyHttpError('payments', 500, null))
      .mockResolvedValue({ ok: true });

    await service().enqueue('payments', 1);
    const job = await waitForJob('completed');

    expect(client.send).toHaveBeenCalledTimes(2);
    expect(job.attemptsMade).toBe(2);
  });

  it('fails a 4xx at once, without retrying', async () => {
    client.send.mockRejectedValue(
      new DependencyHttpError('payments', 400, null),
    );

    await service().enqueue('payments', 1);
    const job = await waitForJob('failed');

    expect(client.send).toHaveBeenCalledOnce();
    expect(job.attemptsMade).toBe(1);
    expect(job.failedReason).toBe('payments responded with HTTP 400');
  });

  it('postpones a job while the circuit is open, without spending an attempt', async () => {
    await openCircuit();

    await service().enqueue('payments', 1);
    const job = await waitForJob('delayed');

    expect(client.send).not.toHaveBeenCalled();
    expect(job.attemptsMade).toBe(0);
  });

  it('fails a postponed job older than JOB_MAX_AGE_MS', async () => {
    await openCircuit();

    await app!
      .get<Queue<ExternalCallJobData>>(getQueueToken(queueName))
      .add(
        'call-payments',
        { requestId: 'old', createdAt: '' },
        { timestamp: Date.now() - JOB_MAX_AGE_MS },
      );
    const job = await waitForJob('failed');

    expect(client.send).not.toHaveBeenCalled();
    expect(job.failedReason).toMatch(/^Job expired after \d+s waiting/);
  });

  it('finishes the active job before the HTTP server and the circuit Redis close', async () => {
    client.send.mockImplementation(async () => {
      await sleep(300);
      return { ok: true };
    });
    const httpAdapter = app!.getHttpAdapter();
    const closeHttp = httpAdapter.close.bind(httpAdapter);
    let stateWhenHttpCloses: JobState | 'unknown' | undefined;
    vi.spyOn(httpAdapter, 'close').mockImplementation(async () => {
      stateWhenHttpCloses = await (await onlyJob()).getState();
      return closeHttp();
    });

    await service().enqueue('payments', 1);
    await vi.waitFor(() => expect(client.send).toHaveBeenCalledOnce());
    await app!.close();
    app = undefined;

    expect(stateWhenHttpCloses).toBe('completed');
    expect(await (await onlyJob()).getState()).toBe('completed');
    expect(client.send).toHaveBeenCalledOnce();
    expect(await redis.hget('circuit-breaker:{payments}', 'successes')).toBe(
      '1',
    );
  });
});
