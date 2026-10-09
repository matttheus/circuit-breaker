import { z } from 'zod';
import { createZodDto } from '../../common/zod/create-zod-dto.js';
import { MOCK_MAX_LATENCY_MS } from '../../config/constants.js';

const MockBehaviorSchema = z
  .strictObject({
    errorRatePercent: z.number().min(0).max(100).optional(),
    latencyMs: z.number().int().min(0).max(MOCK_MAX_LATENCY_MS).optional(),
  })
  .refine(
    (behavior) =>
      behavior.errorRatePercent !== undefined ||
      behavior.latencyMs !== undefined,
    { message: 'Provide errorRatePercent and/or latencyMs' },
  );

export class MockBehaviorDto extends createZodDto(MockBehaviorSchema) {}
