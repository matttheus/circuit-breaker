import { check } from 'k6';
import {
  expectCircuitState,
  getCircuit,
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
const INVALID_RATIO = 0.8;

export const options = {
  scenarios: {
    traffic: {
      executor: 'constant-arrival-rate',
      rate: 50,
      timeUnit: '1s',
      duration: '55s',
      preAllocatedVUs: 30,
      maxVUs: 150,
    },
    monitor: {
      executor: 'constant-vus',
      vus: 1,
      duration: '55s',
      exec: 'monitor',
    },
    break_dependency: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      startTime: '20s',
      exec: 'breakDependency',
    },
    restore_dependency: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      startTime: '40s',
      exec: 'restoreDependency',
    },
  },
  thresholds: {
    ...TEARDOWN_CHECKS,
    ...statusBreakdown('traffic', [200, 400, 502, 503]),
    'checks{scenario:traffic}': ['rate==1'],
    'checks{scenario:break_dependency}': ['rate==1'],
    'http_reqs{scenario:traffic,status:400}': ['count>0'],
    'http_reqs{scenario:traffic,status:503}': ['count>0'],
    circuit_not_closed: ['rate>0'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  resetEnvironment([DEPENDENCY], { [DEPENDENCY]: HEALTHY });
}

export default function () {
  const invalid = Math.random() < INVALID_RATIO;
  const res = syncCall(DEPENDENCY, invalid ? { invalid: true } : {});
  check(res, {
    'status esperado (200, 400, 502 ou 503)': isOneOf(200, 400, 502, 503),
  });
}

export const monitor = monitorCircuit(DEPENDENCY);

export function breakDependency() {
  const circuit = getCircuit(`${DEPENDENCY}-sync`);
  console.log(`[check] antes da queda: ${JSON.stringify(circuit)}`);
  check(circuit, {
    'antes da queda: circuito CLOSED': (c) => c.state === 'CLOSED',
    'antes da queda: 400s ignorados (nenhuma falha na janela)': (c) =>
      c.window.failures === 0 && c.stats.ignored > 0,
  });
  setBehavior(DEPENDENCY, { errorRatePercent: 100 });
}

export function restoreDependency() {
  setBehavior(DEPENDENCY, HEALTHY);
}

export function teardown() {
  reportDependency(DEPENDENCY);
  expectCircuitState(DEPENDENCY, 'CLOSED');
}
