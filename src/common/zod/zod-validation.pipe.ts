import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  NotFoundException,
  PipeTransform,
} from '@nestjs/common';
import type { z } from 'zod';
import { isZodDto } from './create-zod-dto.js';
import type { ValidationErrorBody } from './zod.types.js';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, { metatype, type }: ArgumentMetadata): unknown {
    if (!isZodDto(metatype)) {
      return value;
    }

    const result = metatype.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }

    if (type === 'param') {
      throw new NotFoundException(toErrorBody('Not found', result.error));
    }
    throw new BadRequestException(
      toErrorBody('Validation failed', result.error),
    );
  }
}

function toErrorBody(message: string, error: z.ZodError): ValidationErrorBody {
  return {
    message,
    errors: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}
