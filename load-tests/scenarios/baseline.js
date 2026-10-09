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
} from '../lib/api.js';

const DEPENDENCY = 'payments';

export const options = {
  scenarios: {
    traffic: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 20,
      maxVUs: 100,
    },
    monitor: {
      executor: 'constant-vus',
      vus: 1,
      duration: '30s',
      exec: 'monitor',
    },
  },
  thresholds: {
    ...TEARDOWN_CHECKS,
    ...statusBreakdown('traffic', [200, 502, 503]),
    'http_req_failed{scenario:traffic}': ['rate<0.01'],
    'http_req_duration{scenario:traffic}': ['p(95)<200', 'p(99)<300'],
    'checks{scenario:traffic}': ['rate>0.99'],
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
  check(syncCall(DEPENDENCY), { 'status 200': isOneOf(200) });
}

export const monitor = monitorCircuit(DEPENDENCY);

export function teardown() {
  reportDependency(DEPENDENCY);
  expectCircuitState(DEPENDENCY, 'CLOSED');
}
