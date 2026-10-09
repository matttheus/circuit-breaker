import { z } from 'zod';
import { createZodDto } from '../../common/zod/create-zod-dto.js';

const DependencyPayloadSchema = z.record(z.string(), z.unknown()).prefault({});

export class DependencyPayloadDto extends createZodDto(
  DependencyPayloadSchema,
) {}
