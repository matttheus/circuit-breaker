#!/usr/bin/env bash
set -uo pipefail

export LC_ALL=C

cd "$(dirname "$0")/.."
ALL=(baseline spike outage slow-dependency client-errors isolation)
if [ $# -gt 0 ]; then SCENARIOS=("$@"); else SCENARIOS=("${ALL[@]}"); fi

APP_CONTAINER="circuit-breaker-app-1"
if [ "$(docker inspect -f '{{.State.Health.Status}}' "$APP_CONTAINER" 2>/dev/null)" != "healthy" ]; then
  echo "O container da aplicação não está rodando ou não está saudável. Suba com: docker compose --profile app up -d --build" >&2
  exit 1
fi
sample_stats() {
  echo "timestamp,cpu_percent,memory_mib"
  while :; do
    docker stats --no-stream --format '{{.CPUPerc}},{{.MemUsage}}' "$APP_CONTAINER" |
      awk -F'[,/ ]+' -v ts="$(date +%s)" '{
        cpu = $1; sub("%", "", cpu)
        mem = $2; unit = mem; gsub(/[0-9.]/, "", unit); sub(/[A-Za-z]+/, "", mem)
        if (unit == "GiB") mem *= 1024; else if (unit == "KiB") mem /= 1024
        printf "%s,%s,%.1f\n", ts, cpu, mem
      }'
  done
}

mkdir -p load-tests/reports
declare -A RESULTS

for scenario in "${SCENARIOS[@]}"; do
  echo "=== $scenario"
  stats_file="$(mktemp)"
  sample_stats >"$stats_file" &
  stats_pid=$!

  docker compose --profile load-test run --rm --user "$(id -u):$(id -g)" \
    -e "K6_WEB_DASHBOARD_EXPORT=reports/$scenario.html" \
    k6 run --out "csv=reports/$scenario.samples.csv.gz" "scenarios/$scenario.js"

  RESULTS[$scenario]=$?

  kill "$stats_pid" 2>/dev/null
  wait "$stats_pid" 2>/dev/null
  awk -F, 'NR > 1 { if ($2 > cpu) cpu = $2; if ($3 > mem) mem = $3 }
    END { printf "  pico do container: CPU %.0f%% de 1 core, memória %.0f MiB\n", cpu, mem }' \
    "$stats_file"
  rm -f "$stats_file"
done

echo
echo "=== Resultado"
status=0
for scenario in "${SCENARIOS[@]}"; do
  if [ "${RESULTS[$scenario]}" -eq 0 ]; then
    echo "  ✓ $scenario  (load-tests/reports/$scenario.html)"
  else
    echo "  ✗ $scenario  (exit ${RESULTS[$scenario]}, load-tests/reports/$scenario.html)"
    status=1
  fi
done
exit $status
