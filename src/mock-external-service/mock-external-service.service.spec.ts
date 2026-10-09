import {
  BadRequestException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DEPENDENCIES } from '../config/constants.js';
import { MockExternalService } from './mock-external-service.service.js';

vi.mock('node:timers/promises', () => ({
  setTimeout: () => Promise.resolve(),
}));

const { errorRatePercent } = DEPENDENCIES.payments.mock;

describe('MockExternalService', () => {
  let mock: MockExternalService;

  beforeEach(() => {
    mock = new MockExternalService();
  });

  afterEach(() => vi.restoreAllMocks());

  it('fails when the random roll falls inside the error rate', async () => {
    vi.spyOn(Math, 'random').mockReturnValue((errorRatePercent - 1) / 100);
    await expect(mock.handle('payments', {})).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(mock.getStats().payments).toMatchObject({
      received: 1,
      failed: 1,
      inFlight: 0,
    });
  });

  it('succeeds when the random roll falls outside the error rate', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(errorRatePercent / 100);
    await expect(mock.handle('payments', { a: 1 })).resolves.toMatchObject({
      ok: true,
      payload: { a: 1 },
    });
    expect(mock.getStats().payments).toMatchObject({
      received: 1,
      succeeded: 1,
    });
  });

  it('tracks concurrent requests per dependency', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    await Promise.all([
      mock.handle('payments', {}),
      mock.handle('payments', {}),
      mock.handle('notifications', {}),
    ]);

    const stats = mock.getStats();
    expect(stats.payments).toMatchObject({ maxInFlight: 2, inFlight: 0 });
    expect(stats.notifications).toMatchObject({ maxInFlight: 1 });
  });

  it('answers 400 to invalid payloads, regardless of the error rate', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    await expect(
      mock.handle('payments', { invalid: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mock.getStats().payments).toMatchObject({ badRequests: 1 });
  });

  it('fails the health check with the same error rate', async () => {
    vi.spyOn(Math, 'random').mockReturnValue((errorRatePercent - 1) / 100);
    await expect(mock.health('payments')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    vi.spyOn(Math, 'random').mockReturnValue(errorRatePercent / 100);
    await expect(mock.health('payments')).resolves.toEqual({ status: 'ok' });
    expect(mock.getStats().payments).toMatchObject({ healthChecks: 2 });
  });

  it('changes the behavior at runtime and resets it back', async () => {
    expect(mock.setBehavior('payments', { errorRatePercent: 100 })).toEqual({
      ...DEPENDENCIES.payments.mock,
      errorRatePercent: 100,
    });
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    await expect(mock.handle('payments', {})).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );

    mock.reset('payments');
    expect(mock.getStats().payments).toMatchObject({
      ...DEPENDENCIES.payments.mock,
      received: 0,
      failed: 0,
    });
  });
});
