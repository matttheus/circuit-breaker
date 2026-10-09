import { check } from 'k6';
import {
  expectCircuitState,
  isOneOf,
  monitorCircuit,
  reportDependency,
  resetEnvironment,
  syncCall,
  statusBreakdown,
  TEARDOWN_CHECKS,
  checkTeardown,
} from '../lib/api.js';

const DEPENDENCY = 'payments';

export const options = {
  scenarios: {
    traffic: {
      executor: 'ramping-arrival-rate',
      startRate: 20,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 400,
      stages: [
        { target: 20, duration: '10s' },
        { target: 300, duration: '5s' }, // pico
        { target: 300, duration: '10s' },
        { target: 20, duration: '5s' },
        { target: 20, duration: '10s' },
      ],
    },
    monitor: {
      executor: 'constant-vus',
      vus: 1,
      duration: '40s',
      exec: 'monitor',
    },
  },
  thresholds: {
    ...TEARDOWN_CHECKS,
    ...statusBreakdown('traffic', [200, 502, 503]),
    'checks{scenario:traffic}': ['rate==1'],
    'http_reqs{scenario:traffic,status:503}': ['count>0'],
    'http_req_duration{scenario:traffic,status:503}': ['p(95)<50'],
    'http_req_duration{scenario:traffic,status:200}': ['p(95)<250'],
    circuit_not_closed: ['rate==0'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  resetEnvironment([DEPENDENCY], {
    [DEPENDENCY]: { errorRatePercent: 0, latencyMs: 100 },
  });
}

export default function () {
  check(syncCall(DEPENDENCY), { 'status 200 ou 503': isOneOf(200, 503) });
}

export const monitor = monitorCircuit(DEPENDENCY);

export function teardown() {
  const stats = reportDependency(DEPENDENCY);
  checkTeardown(stats, {
    'mock nunca recebeu mais chamadas simultâneas que os slots (13)': (s) =>
      s.maxInFlight <= 13,
  });
  expectCircuitState(DEPENDENCY, 'CLOSED');
}
