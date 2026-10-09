import { Module } from '@nestjs/common';
import { MockExternalServiceController } from './mock-external-service.controller.js';
import { MockExternalService } from './mock-external-service.service.js';

@Module({
  controllers: [MockExternalServiceController],
  providers: [MockExternalService],
})
export class MockExternalServiceModule {}
