import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DependencyName } from '../config/constants.js';
import { DependencyQueues } from './dependency-queues.js';
import type { EnqueueResult, QueueCounts } from './processing.types.js';

@Injectable()
export class ProcessingService {
  constructor(private readonly queues: DependencyQueues) {}

  async enqueue(
    dependency: DependencyName,
    count: number,
  ): Promise<EnqueueResult> {
    const jobs = await this.queues.get(dependency).addBulk(
      Array.from({ length: count }, () => ({
        name: `call-${dependency}`,
        data: { requestId: randomUUID(), createdAt: new Date().toISOString() },
      })),
    );
    return { dependency, enqueued: jobs.length };
  }

  async counts(): Promise<QueueCounts> {
    const entries = await Promise.all(
      this.queues
        .entries()
        .map(async ([dependency, queue]) => [
          dependency,
          await queue.getJobCounts(
            'waiting',
            'active',
            'delayed',
            'completed',
            'failed',
          ),
        ]),
    );
    return Object.fromEntries(entries) as QueueCounts;
  }
}
