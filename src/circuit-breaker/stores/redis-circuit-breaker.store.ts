import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import {
  CIRCUIT_BREAKER_REDIS_KEY_PREFIX,
  REDIS_HOST,
  REDIS_PORT,
} from '../../config/constants.js';
import {
  CircuitBreakerOptions,
  CircuitState,
  CircuitStateChange,
} from '../circuit-breaker.js';
import {
  CircuitBreakerStore,
  CircuitBreakerStoreFactory,
  CircuitOperation,
  CircuitPermit,
  CircuitRecord,
  toChange,
  toWindow,
  windowRange,
} from './circuit-breaker.store.js';

const TRANSITION_SCRIPT = `
local key = KEYS[1]
local windowKey = KEYS[2]
local op = ARGV[1]
local now = tonumber(ARGV[2])
local errorThreshold = tonumber(ARGV[3])
local minimumRequests = tonumber(ARGV[4])
local windowMs = tonumber(ARGV[5])
local windowBuckets = tonumber(ARGV[6])
local openTimeout = tonumber(ARGV[7])
local halfOpenSuccessThreshold = tonumber(ARGV[8])
local probeLease = tonumber(ARGV[9])
local allowProbe = ARGV[10] == '1'

local currentBucket = math.floor(now / (windowMs / windowBuckets))
local oldestBucket = currentBucket - windowBuckets + 1

local f = redis.call('HMGET', key, 'state', 'halfOpenSuccesses', 'openedAt',
  'probeExpiresAt')
local state = f[1] or 'CLOSED'
local halfOpenSuccesses = tonumber(f[2] or '0')
local openedAt = tonumber(f[3])
local probeExpiresAt = tonumber(f[4] or '0')
local initial = state

local function openCircuit()
  state = 'OPEN'
  openedAt = now
  halfOpenSuccesses = 0
  probeExpiresAt = 0
end

local function closeCircuit()
  state = 'CLOSED'
  halfOpenSuccesses = 0
  openedAt = nil
  probeExpiresAt = 0
  redis.call('DEL', windowKey)
end

local function windowCounts()
  local entries = redis.call('HGETALL', windowKey)
  local requests = 0
  local failures = 0
  for i = 1, #entries, 2 do
    local field = entries[i]
    local bucket = tonumber(string.match(field, '^(-?%d+):'))
    if bucket < oldestBucket then
      redis.call('HDEL', windowKey, field)
    else
      local count = tonumber(entries[i + 1])
      requests = requests + count
      if string.sub(field, -1) == 'f' then
        failures = failures + count
      end
    end
  end
  return requests, failures
end

local function recordInWindow(outcome)
  redis.call('HINCRBY', windowKey, currentBucket .. ':' .. outcome, 1)
  redis.call('PEXPIRE', windowKey, windowMs)
  return windowCounts()
end

if state == 'OPEN' and now >= openedAt + openTimeout then
  state = 'HALF_OPEN'
  halfOpenSuccesses = 0
  probeExpiresAt = 0
end

local allowed = 1
local retryAfter = 0

if op == 'acquire' then
  if state == 'OPEN' then
    allowed = 0
    retryAfter = openedAt + openTimeout - now
  elseif state == 'HALF_OPEN' then
    if not allowProbe or probeExpiresAt > now then
      allowed = 0
    else
      probeExpiresAt = now + probeLease
    end
  end
  if allowed == 0 then
    redis.call('HINCRBY', key, 'rejected', 1)
  end
elseif op == 'success' then
  redis.call('HINCRBY', key, 'successes', 1)
  if state == 'HALF_OPEN' then
    probeExpiresAt = 0
    halfOpenSuccesses = halfOpenSuccesses + 1
    if halfOpenSuccesses >= halfOpenSuccessThreshold then
      closeCircuit()
    end
  elseif state == 'CLOSED' then
    recordInWindow('s')
  end
elseif op == 'failure' then
  redis.call('HINCRBY', key, 'failures', 1)
  if state == 'HALF_OPEN' then
    openCircuit()
  elseif state == 'CLOSED' then
    local requests, failures = recordInWindow('f')
    if requests >= minimumRequests
      and failures * 100 >= errorThreshold * requests then
      openCircuit()
    end
  end
elseif op == 'ignore' then
  redis.call('HINCRBY', key, 'ignored', 1)
  if state == 'HALF_OPEN' then
    probeExpiresAt = 0
  end
elseif op == 'reset' then
  closeCircuit()
end

redis.call('HSET', key, 'state', state, 'halfOpenSuccesses', halfOpenSuccesses,
  'probeExpiresAt', probeExpiresAt)
if openedAt then
  redis.call('HSET', key, 'openedAt', openedAt)
else
  redis.call('HDEL', key, 'openedAt')
end

return { allowed, retryAfter, initial, state }
`;

type TransitionReply = [number, number, CircuitState, CircuitState];

export function circuitKeys(name: string) {
  const key = `${CIRCUIT_BREAKER_REDIS_KEY_PREFIX}{${name}}`;
  return { state: key, window: `${key}:window` };
}

export type RedisWithTransition = Redis & {
  circuitBreakerTransition(
    stateKey: string,
    windowKey: string,
    ...args: (string | number)[]
  ): Promise<TransitionReply>;
};

export function withTransitionCommand(redis: Redis): RedisWithTransition {
  redis.defineCommand('circuitBreakerTransition', {
    numberOfKeys: 2,
    lua: TRANSITION_SCRIPT,
  });
  return redis as RedisWithTransition;
}

export class RedisCircuitBreakerStore implements CircuitBreakerStore {
  readonly kind = 'redis';

  private readonly keys: { state: string; window: string };

  constructor(
    private readonly redis: RedisWithTransition,
    name: string,
    private readonly options: CircuitBreakerOptions,
  ) {
    this.keys = circuitKeys(name);
  }

  async acquire(now: number, allowProbe: boolean): Promise<CircuitPermit> {
    const { allowed, retryAfterMs, change } = await this.apply(
      'acquire',
      now,
      allowProbe,
    );
    return allowed ? { allowed, change } : { allowed, retryAfterMs, change };
  }

  async recordSuccess(now: number) {
    return (await this.apply('success', now)).change;
  }

  async recordFailure(now: number) {
    return (await this.apply('failure', now)).change;
  }

  async recordIgnored(now: number) {
    return (await this.apply('ignore', now)).change;
  }

  async reset(now: number) {
    return (await this.apply('reset', now)).change;
  }

  async read(now: number): Promise<CircuitRecord> {
    const [hash, windowHash] = await Promise.all([
      this.redis.hgetall(this.keys.state),
      this.redis.hgetall(this.keys.window),
    ]);
    const stored =
      (hash.state as CircuitState | undefined) ?? CircuitState.CLOSED;
    const openedAt = hash.openedAt ? Number(hash.openedAt) : null;
    const retryAfterMs =
      stored === CircuitState.OPEN && openedAt !== null
        ? Math.max(0, openedAt + this.options.openTimeoutMs - now)
        : 0;
    const halfOpenDue = stored === CircuitState.OPEN && retryAfterMs === 0;

    return {
      state: halfOpenDue ? CircuitState.HALF_OPEN : stored,
      window: this.window(windowHash, now),
      halfOpenSuccesses: halfOpenDue ? 0 : Number(hash.halfOpenSuccesses ?? 0),
      openedAt,
      retryAfterMs,
      stats: {
        successes: Number(hash.successes ?? 0),
        failures: Number(hash.failures ?? 0),
        rejected: Number(hash.rejected ?? 0),
        ignored: Number(hash.ignored ?? 0),
      },
    };
  }

  private window(windowHash: Record<string, string>, now: number) {
    const { oldest } = windowRange(now, this.options);
    let requests = 0;
    let failures = 0;
    for (const [field, value] of Object.entries(windowHash)) {
      const [bucket, outcome] = field.split(':');
      if (Number(bucket) >= oldest) {
        requests += Number(value);
        failures += outcome === 'f' ? Number(value) : 0;
      }
    }
    return toWindow(requests, failures);
  }

  private async apply(
    op: CircuitOperation,
    now: number,
    allowProbe = false,
  ): Promise<{
    allowed: boolean;
    retryAfterMs: number;
    change: CircuitStateChange | null;
  }> {
    const [allowed, retryAfterMs, from, to] =
      await this.redis.circuitBreakerTransition(
        this.keys.state,
        this.keys.window,
        op,
        now,
        this.options.errorThresholdPercent,
        this.options.minimumRequests,
        this.options.windowMs,
        this.options.windowBuckets,
        this.options.openTimeoutMs,
        this.options.halfOpenSuccessThreshold,
        this.options.halfOpenProbeLeaseMs,
        allowProbe ? 1 : 0,
      );
    return { allowed: allowed === 1, retryAfterMs, change: toChange(from, to) };
  }
}

@Injectable()
export class RedisCircuitBreakerStoreFactory
  extends CircuitBreakerStoreFactory
  implements OnApplicationShutdown
{
  private redis?: RedisWithTransition;

  create(name: string, options: CircuitBreakerOptions) {
    this.redis ??= withTransitionCommand(
      new Redis({ host: REDIS_HOST, port: REDIS_PORT }),
    );
    return new RedisCircuitBreakerStore(this.redis, name, options);
  }

  async onApplicationShutdown() {
    await this.redis?.quit();
  }
}
