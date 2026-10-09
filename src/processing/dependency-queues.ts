import { getQueueToken } from '@nestjs/bullmq';
import { Provider } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  DEPENDENCIES,
  DEPENDENCY_NAMES,
  DependencyName,
} from '../config/constants.js';
import { ExternalCallJobData } from './external-call.job.js';

export class DependencyQueues {
  constructor(
    private readonly queues: Map<DependencyName, Queue<ExternalCallJobData>>,
  ) {}

  get(dependency: DependencyName): Queue<ExternalCallJobData> {
    return this.queues.get(dependency)!;
  }

  entries() {
    return [...this.queues.entries()];
  }
}

export const dependencyQueuesProvider: Provider = {
  provide: DependencyQueues,
  inject: DEPENDENCY_NAMES.map((name) =>
    getQueueToken(DEPENDENCIES[name].queue),
  ),
  useFactory: (...queues: Queue<ExternalCallJobData>[]) =>
    new DependencyQueues(
      new Map(DEPENDENCY_NAMES.map((name, index) => [name, queues[index]])),
    ),
};
