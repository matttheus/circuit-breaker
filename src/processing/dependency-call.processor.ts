import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { DelayedError, Job, UnrecoverableError } from 'bullmq';
import {
  CircuitBreaker,
  CircuitOpenError,
} from '../circuit-breaker/circuit-breaker.js';
import { CircuitBreakerRegistry } from '../circuit-breaker/circuit-breaker.registry.js';
import {
  CIRCUIT_BREAKER_OPTIONS,
  DependencyName,
  JOB_BACKOFF_DELAY_MS,
  JOB_MAX_AGE_MS,
  JOB_POSTPONE_JITTER_MS,
} from '../config/constants.js';
import {
  DependencyHttpError,
  isDependencyFailure,
} from '../external-service/dependency.errors.js';
import { ExternalServiceClient } from '../external-service/external-service.client.js';
import { ExternalCallJobData } from './external-call.job.js';

export abstract class DependencyCallProcessor
  extends WorkerHost
  implements OnModuleDestroy
{
  private readonly logger: Logger;
  private readonly breaker: CircuitBreaker;

  protected constructor(
    private readonly dependency: DependencyName,
    registry: CircuitBreakerRegistry,
    private readonly client: ExternalServiceClient,
  ) {
    super();
    this.logger = new Logger(`${dependency}-worker`);
    this.breaker = registry.getOrCreate(dependency, CIRCUIT_BREAKER_OPTIONS, {
      isFailure: isDependencyFailure,
    });
  }

  async onModuleDestroy() {
    await this.worker.close();
  }

  async process(job: Job<ExternalCallJobData>, token?: string) {
    try {
      return await this.breaker.execute(() =>
        this.client.send(this.dependency, job.data),
      );
    } catch (error) {
      if (error instanceof DependencyHttpError && error.isClientError) {
        throw new UnrecoverableError(error.message);
      }
      if (!(error instanceof CircuitOpenError)) {
        throw error;
      }

      const age = Date.now() - job.timestamp;
      if (age >= JOB_MAX_AGE_MS) {
        throw new UnrecoverableError(
          `Job expired after ${Math.round(age / 1000)}s waiting for the ${this.dependency} circuit to close`,
        );
      }
      const delay =
        Math.max(error.retryAfterMs, JOB_BACKOFF_DELAY_MS) +
        Math.floor(Math.random() * JOB_POSTPONE_JITTER_MS);
      this.logger.debug(`Job ${job.id} postponed ${delay}ms (circuit open)`);
      await job.moveToDelayed(Date.now() + delay, token);
      throw new DelayedError();
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<ExternalCallJobData>) {
    this.logger.log(`Job ${job.id} completed (attempt ${job.attemptsMade})`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ExternalCallJobData> | undefined, error: Error) {
    if (!job) {
      return;
    }
    const attempts = job.opts.attempts ?? 1;
    const reason =
      error instanceof UnrecoverableError
        ? ' - giving up (not retryable)'
        : job.attemptsMade >= attempts
          ? ' - giving up (attempts exhausted)'
          : '';
    this.logger.warn(
      `Job ${job.id} failed (attempt ${job.attemptsMade}/${attempts})${reason}: ${error.message}`,
    );
  }
}
