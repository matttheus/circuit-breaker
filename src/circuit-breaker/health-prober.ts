import { Logger } from '@nestjs/common';
import { CircuitBreaker, CircuitState } from './circuit-breaker.js';

export class HealthProber {
  private readonly logger: Logger;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly breaker: CircuitBreaker,
    private readonly intervalMs: number,
  ) {
    this.logger = new Logger(`HealthProber:${breaker.name}`);
  }

  start(): void {
    this.timer ??= setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      if ((await this.breaker.getState()) === CircuitState.HALF_OPEN) {
        await this.breaker.probe();
        this.logger.log('Health check passed');
      }
    } catch (error) {
      this.logger.warn(`Health check failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
