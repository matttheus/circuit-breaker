import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import {
  DEPENDENCIES,
  DEPENDENCY_NAMES,
  JOB_ATTEMPTS,
  JOB_BACKOFF_DELAY_MS,
  JOB_KEEP_COMPLETED,
  JOB_KEEP_FAILED,
} from '../config/constants.js';
import { ExternalServiceClient } from '../external-service/external-service.client.js';
import {
  NotificationsProcessor,
  PaymentsProcessor,
} from './dependency-processors.js';
import { dependencyQueuesProvider } from './dependency-queues.js';
import { ProcessingController } from './processing.controller.js';
import { ProcessingService } from './processing.service.js';

@Module({
  imports: [
    BullModule.registerQueue(
      ...DEPENDENCY_NAMES.map((name) => ({
        name: DEPENDENCIES[name].queue,
        defaultJobOptions: {
          attempts: JOB_ATTEMPTS,
          backoff: { type: 'exponential', delay: JOB_BACKOFF_DELAY_MS },
          removeOnComplete: JOB_KEEP_COMPLETED,
          removeOnFail: JOB_KEEP_FAILED,
        },
      })),
    ),
  ],
  controllers: [ProcessingController],
  providers: [
    ExternalServiceClient,
    dependencyQueuesProvider,
    ProcessingService,
    PaymentsProcessor,
    NotificationsProcessor,
  ],
})
export class ProcessingModule {}
