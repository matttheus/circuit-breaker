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

const DURATION = '40s';

export const options = {
  scenarios: {
    payments_sync: {
      executor: 'constant-arrival-rate',
      rate: 30,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 20,
      maxVUs: 100,
      exec: 'paymentsSync',
    },
    notifications_sync: {
      executor: 'constant-arrival-rate',
      rate: 2,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 5,
      maxVUs: 20,
      exec: 'notificationsSync',
    },
    monitor_payments: {
      executor: 'constant-vus',
      vus: 1,
      duration: DURATION,
      exec: 'monitorPayments',
    },
    monitor_notifications: {
      executor: 'constant-vus',
      vus: 1,
      duration: DURATION,
      exec: 'monitorNotifications',
    },
  },
  thresholds: {
    ...TEARDOWN_CHECKS,
    ...statusBreakdown('payments_sync', [502, 503]),
    ...statusBreakdown('notifications_sync', [200, 502]),
    'checks{scenario:payments_sync}': ['rate==1'],
    'http_req_duration{scenario:payments_sync,status:503}': ['p(95)<50'],
    'checks{scenario:notifications_sync}': ['rate==1'],
    'http_reqs{scenario:notifications_sync,status:503}': ['count==0'],
    'http_req_failed{scenario:notifications_sync}': ['rate<0.15'],
    'http_req_duration{scenario:notifications_sync}': ['p(95)<1800'],
    'circuit_not_closed{dependency:payments}': ['rate>0'],
    'circuit_not_closed{dependency:notifications}': ['rate==0'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  resetEnvironment(['payments', 'notifications'], {
    payments: { errorRatePercent: 100, latencyMs: 100 },
  });
}

export function paymentsSync() {
  check(syncCall('payments'), { 'status 502 ou 503': isOneOf(502, 503) });
}

export function notificationsSync() {
  check(syncCall('notifications'), {
    'status 200 ou 502 (nunca 503)': isOneOf(200, 502),
  });
}

export const monitorPayments = monitorCircuit('payments');
export const monitorNotifications = monitorCircuit('notifications');

export function teardown() {
  reportDependency('payments');
  reportDependency('notifications');
  expectCircuitState('notifications', 'CLOSED');
  resetEnvironment(['payments']);
}
