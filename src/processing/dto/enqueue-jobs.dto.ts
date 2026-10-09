import { z } from 'zod';
import { createZodDto } from '../../common/zod/create-zod-dto.js';
import { JOBS_MAX_PER_REQUEST } from '../../config/constants.js';

const EnqueueJobsSchema = z
  .strictObject({
    count: z.number().int().min(1).max(JOBS_MAX_PER_REQUEST).default(1),
  })
  .prefault({});

export class EnqueueJobsDto extends createZodDto(EnqueueJobsSchema) {}
