import type { z } from 'zod';
import type { ZodDto } from './zod.types.js';

export function createZodDto<TSchema extends z.ZodType>(
  schema: TSchema,
): ZodDto<TSchema> {
  class ZodDtoClass {
    static readonly schema = schema;
  }
  return ZodDtoClass as unknown as ZodDto<TSchema>;
}

export function isZodDto(metatype: unknown): metatype is ZodDto {
  return (
    typeof metatype === 'function' &&
    'schema' in metatype &&
    typeof (metatype as { schema?: { safeParse?: unknown } }).schema
      ?.safeParse === 'function'
  );
}
