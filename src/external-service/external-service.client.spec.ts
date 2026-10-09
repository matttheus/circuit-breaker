import type { Mock } from 'vitest';
import {
  EXTERNAL_SERVICE_BASE_URL,
  EXTERNAL_SERVICE_TIMEOUT_MS,
} from '../config/constants.js';
import {
  DependencyHttpError,
  DependencyNetworkError,
  DependencyTimeoutError,
} from './dependency.errors.js';
import { ExternalServiceClient } from './external-service.client.js';

describe('ExternalServiceClient', () => {
  let fetchMock: Mock<typeof fetch>;
  const client = new ExternalServiceClient();
  const timeoutError = () =>
    new DOMException(
      'The operation was aborted due to timeout',
      'TimeoutError',
    );

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the payload as JSON and returns the parsed body', async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true }));

    await expect(client.send('payments', { amount: 10 })).resolves.toEqual({
      ok: true,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect((url as URL).href).toBe(`${EXTERNAL_SERVICE_BASE_URL}/payments`);
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"amount":10}',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('calls the health endpoint with GET', async () => {
    fetchMock.mockResolvedValue(Response.json({ status: 'ok' }));

    await client.healthCheck('notifications');

    const [url, init] = fetchMock.mock.calls[0];
    expect((url as URL).href).toBe(
      `${EXTERNAL_SERVICE_BASE_URL}/notifications/health`,
    );
    expect(init?.method).toBe('GET');
  });

  it('returns a body that is not JSON as text, and an empty body as null', async () => {
    fetchMock.mockResolvedValueOnce(new Response('plain text'));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(client.send('payments', {})).resolves.toBe('plain text');
    await expect(client.send('payments', {})).resolves.toBeNull();
  });

  it('turns a non-2xx response into a DependencyHttpError with the body and Retry-After', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { message: 'slow down' },
        { status: 429, headers: { 'retry-after': '30' } },
      ),
    );

    const error = await client.send('payments', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DependencyHttpError);
    expect(error).toMatchObject({
      dependency: 'payments',
      status: 429,
      body: { message: 'slow down' },
      retryAfterSeconds: 30,
    });
  });

  it('turns a timeout into a DependencyTimeoutError', async () => {
    fetchMock.mockRejectedValue(timeoutError());

    await expect(client.send('payments', {})).rejects.toThrow(
      new DependencyTimeoutError('payments', EXTERNAL_SERVICE_TIMEOUT_MS),
    );
  });

  it('turns a timeout while reading the body into a DependencyTimeoutError', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      headers: new Headers(),
      text: () => Promise.reject(timeoutError()),
    } as Response);

    await expect(client.send('payments', {})).rejects.toBeInstanceOf(
      DependencyTimeoutError,
    );
  });

  it('turns any other fetch failure into a DependencyNetworkError', async () => {
    const cause = new TypeError('fetch failed');
    fetchMock.mockRejectedValue(cause);

    const error = await client.send('payments', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DependencyNetworkError);
    expect((error as Error).cause).toBe(cause);
  });
});
