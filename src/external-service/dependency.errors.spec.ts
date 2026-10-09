import {
  DependencyHttpError,
  DependencyNetworkError,
  DependencyTimeoutError,
  isDependencyFailure,
  parseRetryAfter,
} from './dependency.errors.js';

describe('isDependencyFailure', () => {
  it.each([400, 401, 403, 404, 409, 422])(
    'ignores HTTP %i (client error)',
    (status) => {
      expect(
        isDependencyFailure(new DependencyHttpError('payments', status, null)),
      ).toBe(false);
    },
  );

  it.each([408, 429, 500, 502, 503, 504])('counts HTTP %i', (status) => {
    expect(
      isDependencyFailure(new DependencyHttpError('payments', status, null)),
    ).toBe(true);
  });

  it.each([
    ['timeouts', new DependencyTimeoutError('payments', 2_000)],
    ['network errors', new DependencyNetworkError('payments', new Error())],
  ])('counts %s', (_label, error) => {
    expect(isDependencyFailure(error)).toBe(true);
  });
});

describe('isDependencyFailure with errors from our own code', () => {
  it.each([
    ['a serialization bug', new TypeError('Converting circular structure')],
    ['a generic error', new Error('boom')],
    ['a non-error value', 'oops'],
  ])('ignores %s', (_label, error) => {
    expect(isDependencyFailure(error)).toBe(false);
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-10-03T12:00:00Z');

  it.each([
    [null, undefined],
    ['', undefined],
    ['120', 120],
    [' 5 ', 5],
    ['Sat, 03 Oct 2026 12:00:30 GMT', 30],
    ['Sat, 03 Oct 2026 11:00:00 GMT', 0],
    ['amanhã', undefined],
  ])('parses %j as %j', (value, expected) => {
    expect(parseRetryAfter(value, now)).toBe(expected);
  });
});
