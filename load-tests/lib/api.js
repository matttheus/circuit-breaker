import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

const JSON_HEADERS = { 'content-type': 'application/json' };

const ONLY_200 = http.expectedStatuses(200);

const circuitNotClosed = new Rate('circuit_not_closed');

const circuitState = new Counter('circuit_state');

const chaosEvents = new Counter('chaos_events');

export const TEARDOWN_CHECKS = { 'checks{phase:teardown}': ['rate==1'] };

export function syncCall(dependency, payload = {}) {
  return http.post(`${BASE_URL}/sync/${dependency}`, JSON.stringify(payload), {
    headers: JSON_HEADERS,
    responseCallback: ONLY_200,
    tags: { endpoint: `sync-${dependency}` },
  });
}

function admin(method, path, body) {
  const res = http.request(
    method,
    `${BASE_URL}${path}`,
    body === undefined ? null : JSON.stringify(body),
    { headers: JSON_HEADERS, tags: { endpoint: 'admin' } },
  );
  if (res.status >= 300) {
    throw new Error(`${method} ${path} -> ${res.status}: ${res.body}`);
  }
  return res.body ? res.json() : null;
}

export function setBehavior(dependency, behavior) {
  const result = admin('PUT', `/mock/${dependency}/behavior`, behavior);
  chaosEvents.add(1, {
    dependency,
    errorRatePercent: String(result.errorRatePercent),
    latencyMs: String(result.latencyMs),
  });
  console.log(`[chaos] ${dependency}: ${JSON.stringify(result)}`);
  return result;
}

export function getCircuit(name) {
  return admin('GET', `/circuit-breakers/${name}`);
}

export function resetEnvironment(dependencies, behaviors = {}) {
  for (const dependency of dependencies) {
    admin('POST', `/mock/${dependency}/reset`);
    if (behaviors[dependency]) {
      setBehavior(dependency, behaviors[dependency]);
    }
    admin('POST', `/circuit-breakers/${dependency}-sync/reset`);
  }
}

export function reportDependency(dependency) {
  const stats = admin('GET', '/mock/stats')[dependency];
  console.log(`[mock] ${dependency}: ${JSON.stringify(stats)}`);
  return stats;
}

export function expectCircuitState(dependency, expected) {
  const circuit = getCircuit(`${dependency}-sync`);
  console.log(
    `[circuit] ${circuit.name}: ${circuit.state} window=${JSON.stringify(circuit.window)} stats=${JSON.stringify(circuit.stats)}`,
  );
  checkTeardown(circuit, {
    [`circuito ${dependency}-sync termina ${expected}`]: (c) =>
      c.state === expected,
  });
  return circuit;
}

export function checkTeardown(value, checks) {
  return check(value, checks, { phase: 'teardown' });
}

export function monitorCircuit(dependency) {
  let previous = null;
  return function () {
    const { state, window } = getCircuit(`${dependency}-sync`);
    circuitNotClosed.add(state !== 'CLOSED', { dependency });
    circuitState.add(1, { dependency, state });
    if (state !== previous) {
      console.log(
        `[monitor] ${dependency}-sync -> ${state} (window ${JSON.stringify(window)})`,
      );
      previous = state;
    }
    sleep(1);
  };
}

export function isOneOf(...statuses) {
  return (res) => statuses.includes(res.status);
}

export function statusBreakdown(scenario, statuses) {
  const thresholds = {};
  for (const status of statuses) {
    thresholds[`http_reqs{scenario:${scenario},status:${status}}`] = [
      'count>=0',
    ];
    thresholds[`http_req_duration{scenario:${scenario},status:${status}}`] = [
      'max>=0',
    ];
  }
  return thresholds;
}
