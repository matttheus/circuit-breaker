import { z } from 'zod';
import { createZodDto } from '../../common/zod/create-zod-dto.js';

const CircuitNameParamSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
});

export class CircuitNameParamDto extends createZodDto(CircuitNameParamSchema) {}
