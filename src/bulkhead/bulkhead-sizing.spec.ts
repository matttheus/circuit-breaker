import { bulkheadSlots } from './bulkhead-sizing.js';

describe('bulkheadSlots', () => {
  it.each([
    [100, 100, 0, 10],
    [100, 100, 25, 13],
    [2, 1_500, 25, 4],
    [30, 100, 0, 3],
    [200, 50, 20, 12],
  ])('%i req/s × %ims + %i%% = %i slots', (rps, p99, headroom, expected) => {
    expect(
      bulkheadSlots({
        peakRequestsPerSecond: rps,
        p99LatencyMs: p99,
        headroomPercent: headroom,
      }),
    ).toBe(expected);
  });

  it('never returns less than one slot', () => {
    expect(
      bulkheadSlots({
        peakRequestsPerSecond: 1,
        p99LatencyMs: 1,
        headroomPercent: 0,
      }),
    ).toBe(1);
  });
});
