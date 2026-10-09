import { Injectable } from '@nestjs/common';
import type { HealthStatus } from './health.types.js';

@Injectable()
export class HealthService {
  check(): HealthStatus {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }
}
