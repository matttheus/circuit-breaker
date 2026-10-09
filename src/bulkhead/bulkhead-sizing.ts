interface BulkheadSizing {
  peakRequestsPerSecond: number;
  p99LatencyMs: number;
  headroomPercent: number;
}

export function bulkheadSlots({
  peakRequestsPerSecond,
  p99LatencyMs,
  headroomPercent,
}: BulkheadSizing): number {
  const slots =
    (peakRequestsPerSecond * p99LatencyMs * (100 + headroomPercent)) /
    (1_000 * 100);
  return Math.max(1, Math.ceil(slots));
}
