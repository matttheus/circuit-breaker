import { INestApplication } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { BulkheadRejectedError } from '../bulkhead/bulkhead.js';
import { CircuitOpenError } from '../circuit-breaker/circuit-breaker.js';
import {
  DependencyHttpError,
  DependencyNetworkError,
  DependencyTimeoutError,
} from '../external-service/dependency.errors.js';
import { ZodValidationPipe } from '../common/zod/zod-validation.pipe.js';
import { toHttpErrorResponse } from './dependency-error.filter.js';
import { SyncDependencyGateway } from './sync-dependency.gateway.js';
import { SyncController } from './sync.controller.js';

describe('toHttpErrorResponse', () => {
  it('maps an open circuit to 503 with Retry-After', () => {
    expect(
      toHttpErrorResponse(new CircuitOpenError('payments-sync', 4_200)),
    ).toMatchObject({ status: 503, retryAfterSeconds: 5 });
  });

  it('never sends Retry-After: 0 while half-open', () => {
    expect(
      toHttpErrorResponse(new CircuitOpenError('payments-sync', 0)),
    ).toMatchObject({ status: 503, retryAfterSeconds: 1 });
  });

  it('maps a full bulkhead to 503', () => {
    expect(
      toHttpErrorResponse(new BulkheadRejectedError('payments', 10)),
    ).toMatchObject({ status: 503, retryAfterSeconds: 1 });
  });

  it('maps a 429 to 503, forwarding the dependency Retry-After', () => {
    expect(
      toHttpErrorResponse(new DependencyHttpError('payments', 429, null, 30)),
    ).toMatchObject({ status: 503, retryAfterSeconds: 30 });
    expect(
      toHttpErrorResponse(new DependencyHttpError('payments', 429, null)),
    ).toMatchObject({ status: 503, retryAfterSeconds: 1 });
  });

  it('forwards client errors with their original status', () => {
    const error = new DependencyHttpError('payments', 400, {
      message: 'Invalid payload',
    });
    expect(toHttpErrorResponse(error)).toEqual({
      status: 400,
      body: {
        message: 'Dependency rejected the request',
        dependency: 'payments',
        details: { message: 'Invalid payload' },
      },
    });
  });

  it.each([
    [new DependencyHttpError('payments', 500, null), 502],
    [new DependencyNetworkError('payments', new Error()), 502],
    [new DependencyTimeoutError('payments', 2_000), 504],
  ])('maps %s to %i', (error, status) => {
    const response = toHttpErrorResponse(error);
    expect(response.status).toBe(status);
    expect(response.retryAfterSeconds).toBeUndefined();
  });
});

describe('DependencyErrorFilter on POST /sync/:dependency', () => {
  let app: INestApplication<App>;
  const gateway = { call: vi.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SyncController],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: SyncDependencyGateway, useValue: gateway },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  it('answers 503 with the Retry-After header when the circuit is open', async () => {
    gateway.call.mockRejectedValue(
      new CircuitOpenError('payments-sync', 4_200),
    );

    const res = await request(app.getHttpServer())
      .post('/sync/payments')
      .expect(503);

    expect(res.headers['retry-after']).toBe('5');
    expect(res.body).toEqual({
      message: 'Dependency temporarily unavailable (circuit open)',
    });
  });

  it('answers 503 with Retry-After: 1 when the semaphore is full', async () => {
    gateway.call.mockRejectedValue(new BulkheadRejectedError('payments', 13));

    const res = await request(app.getHttpServer())
      .post('/sync/payments')
      .expect(503);

    expect(res.headers['retry-after']).toBe('1');
  });

  it('answers 504 without Retry-After on a timeout', async () => {
    gateway.call.mockRejectedValue(
      new DependencyTimeoutError('payments', 2_000),
    );

    const res = await request(app.getHttpServer())
      .post('/sync/payments')
      .expect(504);

    expect(res.headers['retry-after']).toBeUndefined();
    expect(res.body.message).toBe('payments did not respond within 2000ms');
  });

  it('forwards the status and details of a client error', async () => {
    gateway.call.mockRejectedValue(
      new DependencyHttpError('payments', 400, { message: 'Invalid payload' }),
    );

    const res = await request(app.getHttpServer())
      .post('/sync/payments')
      .send({ invalid: true })
      .expect(400);

    expect(res.body.details).toEqual({ message: 'Invalid payload' });
  });
});
