import { check } from 'k6';
import {
  expectCircuitState,
  isOneOf,
  monitorCircuit,
  reportDependency,
  resetEnvironment,
  setBehavior,
  syncCall,
  statusBreakdown,
  TEARDOWN_CHECKS,
} from '../lib/api.js';

const DEPENDENCY = 'payments';
const HEALTHY = { errorRatePercent: 0, latencyMs: 100 };

export const options = {
  scenarios: {
    traffic: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 30,
      maxVUs: 150,
    },
    monitor: {
      executor: 'constant-vus',
      vus: 1,
      duration: '60s',
      exec: 'monitor',
    },
    break_dependency: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      startTime: '15s',
      exec: 'breakDependency',
    },
    restore_dependency: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      startTime: '35s',
      exec: 'restoreDependency',
    },
  },
  thresholds: {
    ...TEARDOWN_CHECKS,
    ...statusBreakdown('traffic', [200, 502, 503]),
    'checks{scenario:traffic}': ['rate==1'],
    'http_req_duration{scenario:traffic,status:503}': ['p(95)<50'],
    'http_reqs{scenario:traffic,status:503}': ['count>0'],
    'http_reqs{scenario:traffic,status:502}': ['count>0'],
    'http_reqs{scenario:traffic,status:200}': ['count>0'],
    'http_req_duration{scenario:traffic,status:200}': ['p(95)<250'],
    circuit_not_closed: ['rate>0'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  resetEnvironment([DEPENDENCY], { [DEPENDENCY]: HEALTHY });
}

export default function () {
  check(syncCall(DEPENDENCY), {
    'status 200, 502 ou 503': isOneOf(200, 502, 503),
  });
}

export const monitor = monitorCircuit(DEPENDENCY);

export function breakDependency() {
  setBehavior(DEPENDENCY, { errorRatePercent: 100 });
}

export function restoreDependency() {
  setBehavior(DEPENDENCY, HEALTHY);
}

export function teardown() {
  reportDependency(DEPENDENCY);
  expectCircuitState(DEPENDENCY, 'CLOSED');
}
