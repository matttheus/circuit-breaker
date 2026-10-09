import { Bulkhead, BulkheadRejectedError } from './bulkhead.js';

describe('Bulkhead', () => {
  function pending() {
    let release!: () => void;
    let fail!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      release = resolve;
      fail = reject;
    });
    return { promise, release, fail };
  }

  it('rejects immediately when all slots are taken', async () => {
    const bulkhead = new Bulkhead('test', 2);
    const first = pending();
    const second = pending();
    const calls = [
      bulkhead.execute(() => first.promise),
      bulkhead.execute(() => second.promise),
    ];

    const action = vi.fn();
    await expect(bulkhead.execute(action)).rejects.toBeInstanceOf(
      BulkheadRejectedError,
    );
    expect(action).not.toHaveBeenCalled();

    first.release();
    second.release();
    await Promise.all(calls);
  });

  it('frees the slot when the call succeeds or fails', async () => {
    const bulkhead = new Bulkhead('test', 1);
    const call = pending();
    const running = bulkhead.execute(() => call.promise);
    await expect(bulkhead.execute(async () => 'ok')).rejects.toBeInstanceOf(
      BulkheadRejectedError,
    );

    call.fail(new Error('boom'));
    await expect(running).rejects.toThrow('boom');
    await expect(bulkhead.execute(async () => 'ok')).resolves.toBe('ok');
    await expect(bulkhead.execute(async () => 'ok')).resolves.toBe('ok');
  });
});
