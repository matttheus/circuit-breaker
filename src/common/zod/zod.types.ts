import type { z } from 'zod';

export interface ZodDto<TSchema extends z.ZodType = z.ZodType> {
  new (): z.output<TSchema>;
  readonly schema: TSchema;
}

interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationErrorBody {
  message: string;
  errors: ValidationIssue[];
}
