import { Module } from '@nestjs/common';
import { ExternalServiceClient } from '../external-service/external-service.client.js';
import { SyncDependencyGateway } from './sync-dependency.gateway.js';
import { SyncController } from './sync.controller.js';

@Module({
  controllers: [SyncController],
  providers: [ExternalServiceClient, SyncDependencyGateway],
})
export class SyncModule {}
