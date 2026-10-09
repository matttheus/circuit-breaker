import { Processor } from '@nestjs/bullmq';
import { CircuitBreakerRegistry } from '../circuit-breaker/circuit-breaker.registry.js';
import { DEPENDENCIES } from '../config/constants.js';
import { ExternalServiceClient } from '../external-service/external-service.client.js';
import { DependencyCallProcessor } from './dependency-call.processor.js';

@Processor(DEPENDENCIES.payments.queue, {
  concurrency: DEPENDENCIES.payments.concurrency,
})
export class PaymentsProcessor extends DependencyCallProcessor {
  constructor(registry: CircuitBreakerRegistry, client: ExternalServiceClient) {
    super('payments', registry, client);
  }
}

@Processor(DEPENDENCIES.notifications.queue, {
  concurrency: DEPENDENCIES.notifications.concurrency,
})
export class NotificationsProcessor extends DependencyCallProcessor {
  constructor(registry: CircuitBreakerRegistry, client: ExternalServiceClient) {
    super('notifications', registry, client);
  }
}
