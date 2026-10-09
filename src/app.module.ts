import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from './common/zod/zod-validation.pipe.js';
import { CircuitBreakerModule } from './circuit-breaker/circuit-breaker.module.js';
import {
  CIRCUIT_BREAKER_STORE,
  REDIS_HOST,
  REDIS_PORT,
} from './config/constants.js';
import { HealthModule } from './health/health.module.js';
import { MockExternalServiceModule } from './mock-external-service/mock-external-service.module.js';
import { ProcessingModule } from './processing/processing.module.js';
import { SyncModule } from './sync/sync.module.js';

@Module({
  imports: [
    BullModule.forRoot({
      connection: { host: REDIS_HOST, port: REDIS_PORT },
    }),
    CircuitBreakerModule.forRoot({ store: CIRCUIT_BREAKER_STORE }),
    HealthModule,
    MockExternalServiceModule,
    ProcessingModule,
    SyncModule,
  ],
  providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }],
})
export class AppModule {}
