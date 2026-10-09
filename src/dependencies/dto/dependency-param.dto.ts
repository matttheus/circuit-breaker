import { z } from 'zod';
import { createZodDto } from '../../common/zod/create-zod-dto.js';
import { DEPENDENCY_NAMES } from '../../config/constants.js';

const DependencyParamSchema = z.strictObject({
  dependency: z.enum(DEPENDENCY_NAMES),
});

export class DependencyParamDto extends createZodDto(DependencyParamSchema) {}
