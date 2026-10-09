import { BadRequestException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { createZodDto } from './create-zod-dto.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

class PageDto extends createZodDto(
  z.strictObject({ size: z.number().int().min(1).default(10) }),
) {}

class IdParamDto extends createZodDto(z.strictObject({ id: z.enum(['a']) })) {}

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe();

  it('returns the parsed value, with defaults applied', () => {
    expect(pipe.transform({}, { type: 'body', metatype: PageDto })).toEqual({
      size: 10,
    });
  });

  it('rejects an invalid body with 400 and the list of issues', () => {
    const run = () =>
      pipe.transform(
        { size: 0, extra: true },
        { type: 'body', metatype: PageDto },
      );

    expect(run).toThrow(BadRequestException);
    try {
      run();
    } catch (error) {
      const body = (error as BadRequestException).getResponse();
      expect(body).toMatchObject({ message: 'Validation failed' });
      expect(
        (body as { errors: { path: string }[] }).errors.map((e) => e.path),
      ).toEqual(expect.arrayContaining(['size', '']));
    }
  });

  it('rejects an invalid route param with 404', () => {
    expect(() =>
      pipe.transform({ id: 'b' }, { type: 'param', metatype: IdParamDto }),
    ).toThrow(NotFoundException);
  });

  it('passes values without a zod DTO through untouched', () => {
    const value = { anything: true };
    expect(pipe.transform(value, { type: 'body', metatype: Object })).toBe(
      value,
    );
    expect(pipe.transform('42', { type: 'param', metatype: String })).toBe(
      '42',
    );
  });
});
