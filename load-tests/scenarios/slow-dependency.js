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
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
    monitor: {
      executor: 'constant-vus',
      vus: 1,
      duration: '60s',
      exec: 'monitor',
    },
    slow_down: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      startTime: '15s',
      exec: 'slowDown',
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
    ...statusBreakdown('traffic', [200, 503, 504]),
    'checks{scenario:traffic}': ['rate==1'],
    'http_req_duration{scenario:traffic}': ['max<2500'],
    'http_reqs{scenario:traffic,status:504}': ['count>0'],
    'http_req_duration{scenario:traffic,status:503}': ['p(95)<50'],
    circuit_not_closed: ['rate>0'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  resetEnvironment([DEPENDENCY], { [DEPENDENCY]: HEALTHY });
}

export default function () {
  check(syncCall(DEPENDENCY), {
    'status 200, 503 ou 504': isOneOf(200, 503, 504),
  });
}

export const monitor = monitorCircuit(DEPENDENCY);

export function slowDown() {
  setBehavior(DEPENDENCY, { latencyMs: 3_000 });
}

export function restoreDependency() {
  setBehavior(DEPENDENCY, HEALTHY);
}

export function teardown() {
  reportDependency(DEPENDENCY);
  expectCircuitState(DEPENDENCY, 'CLOSED');
}
