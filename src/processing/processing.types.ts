import type { DependencyName } from '../config/constants.js';

export interface EnqueueResult {
  dependency: DependencyName;
  enqueued: number;
}

export type QueueCounts = Record<
  DependencyName,
  Record<'waiting' | 'active' | 'delayed' | 'completed' | 'failed', number>
>;
