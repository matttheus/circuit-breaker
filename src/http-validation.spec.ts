import { INestApplication } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { CircuitBreakerController } from './circuit-breaker/circuit-breaker.controller.js';
import { CircuitBreakerService } from './circuit-breaker/circuit-breaker.service.js';
import { ZodValidationPipe } from './common/zod/zod-validation.pipe.js';
import { MockExternalServiceController } from './mock-external-service/mock-external-service.controller.js';
import { MockExternalService } from './mock-external-service/mock-external-service.service.js';
import { ProcessingController } from './processing/processing.controller.js';
import { ProcessingService } from './processing/processing.service.js';
import { SyncDependencyGateway } from './sync/sync-dependency.gateway.js';
import { SyncController } from './sync/sync.controller.js';

describe('HTTP input validation', () => {
  let app: INestApplication<App>;
  const processing = { enqueue: vi.fn(), counts: vi.fn() };
  const gateway = { call: vi.fn() };
  const mock = { setBehavior: vi.fn(), handle: vi.fn() };
  const circuitBreakers = { get: vi.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        ProcessingController,
        SyncController,
        MockExternalServiceController,
        CircuitBreakerController,
      ],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: ProcessingService, useValue: processing },
        { provide: SyncDependencyGateway, useValue: gateway },
        { provide: MockExternalService, useValue: mock },
        { provide: CircuitBreakerService, useValue: circuitBreakers },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(() => vi.resetAllMocks());

  describe('POST /jobs/:dependency', () => {
    it('enqueues one job when there is no body', async () => {
      processing.enqueue.mockResolvedValue({
        dependency: 'payments',
        enqueued: 1,
      });

      await request(app.getHttpServer()).post('/jobs/payments').expect(202);
      expect(processing.enqueue).toHaveBeenCalledWith('payments', 1);
    });

    it('passes a valid count to the service', async () => {
      await request(app.getHttpServer())
        .post('/jobs/payments')
        .send({ count: 30 })
        .expect(202);
      expect(processing.enqueue).toHaveBeenCalledWith('payments', 30);
    });

    it.each([
      [{ count: 0 }, 'count'],
      [{ count: 1_001 }, 'count'],
      [{ count: 2.5 }, 'count'],
      [{ count: '10' }, 'count'],
      [{ count: 1, extra: true }, ''],
    ])('rejects %j with 400', async (body, path) => {
      const res = await request(app.getHttpServer())
        .post('/jobs/payments')
        .send(body)
        .expect(400);

      expect(res.body.message).toBe('Validation failed');
      expect(res.body.errors.map((e: { path: string }) => e.path)).toContain(
        path,
      );
      expect(processing.enqueue).not.toHaveBeenCalled();
    });

    it('answers 404 to an unknown dependency', async () => {
      const res = await request(app.getHttpServer())
        .post('/jobs/billing')
        .send({ count: 1 })
        .expect(404);

      expect(res.body.errors[0].path).toBe('dependency');
    });
  });

  describe('POST /sync/:dependency', () => {
    it('forwards a JSON object payload', async () => {
      gateway.call.mockResolvedValue({ ok: true });

      await request(app.getHttpServer())
        .post('/sync/notifications')
        .send({ to: 'someone' })
        .expect(200);
      expect(gateway.call).toHaveBeenCalledWith('notifications', {
        to: 'someone',
      });
    });

    it('uses an empty object when there is no body', async () => {
      gateway.call.mockResolvedValue({ ok: true });

      await request(app.getHttpServer()).post('/sync/payments').expect(200);
      expect(gateway.call).toHaveBeenCalledWith('payments', {});
    });

    it('rejects a payload that is not an object', async () => {
      await request(app.getHttpServer())
        .post('/sync/payments')
        .send([1, 2])
        .expect(400);
      expect(gateway.call).not.toHaveBeenCalled();
    });

    it('answers 404 to an unknown dependency', async () => {
      await request(app.getHttpServer()).post('/sync/billing').expect(404);
    });
  });

  describe('PUT /mock/:dependency/behavior', () => {
    it('accepts a partial behavior', async () => {
      mock.setBehavior.mockReturnValue({ errorRatePercent: 0, latencyMs: 50 });

      await request(app.getHttpServer())
        .put('/mock/payments/behavior')
        .send({ latencyMs: 50 })
        .expect(200);
      expect(mock.setBehavior).toHaveBeenCalledWith('payments', {
        latencyMs: 50,
      });
    });

    it.each([
      [{}],
      [{ errorRatePercent: 101 }],
      [{ errorRatePercent: -1 }],
      [{ latencyMs: 60_001 }],
      [{ latencyMs: 1.5 }],
      [{ latencyMs: 10, unknown: 1 }],
    ])('rejects %j with 400', async (body) => {
      await request(app.getHttpServer())
        .put('/mock/payments/behavior')
        .send(body)
        .expect(400);
      expect(mock.setBehavior).not.toHaveBeenCalled();
    });
  });

  describe('GET /circuit-breakers/:name', () => {
    it('passes the trimmed name to the service', async () => {
      circuitBreakers.get.mockResolvedValue({ name: 'payments' });

      await request(app.getHttpServer())
        .get('/circuit-breakers/%20payments%20')
        .expect(200);
      expect(circuitBreakers.get).toHaveBeenCalledWith('payments');
    });
  });
});
