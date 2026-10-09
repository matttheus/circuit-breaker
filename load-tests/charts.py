#!/usr/bin/env python3
"""Generates the load test charts (SVG) from load-tests/reports/*.samples.csv.gz.

Usage: python3 load-tests/charts.py <output directory>

Run ./load-tests/run.sh outage slow-dependency spike first: each run saves the
k6 samples next to the HTML report, including the simulated failures
(chaos_events) and the circuit state sampled every second (circuit_state).
"""

import csv
import gzip
import math
import sys
from collections import defaultdict
from html import escape
from pathlib import Path

REPORTS = Path(__file__).parent / "reports"

SURFACE = "#181818"
BORDER = "#2b2b2b"
TEXT_PRIMARY = "#e7e7e7"
TEXT_SECONDARY = "#cccccc"
TEXT_MUTED = "#9d9d9d"
GRID = "#2c2c2a"
BASELINE = "#383835"
FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

SUCCESS = "#3987e5"
DEPENDENCY_ERROR = "#d95926"
FAIL_FAST = "#199e70"
LATENCY_LINE = "#cccccc"

STATE_STYLE = {
    "CLOSED": ("#262626", "#9d9d9d"),
    "OPEN": ("#3a2323", "#fca5a5"),
    "HALF_OPEN": ("#3a3220", "#fcd34d"),
}
STATE_LABEL = {"CLOSED": "CLOSED", "OPEN": "OPEN", "HALF_OPEN": "HALF"}

WIDTH = 960
PLOT_LEFT = 76
PLOT_RIGHT = WIDTH - 36
PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT


def parse_tags(extra):
    return dict(pair.split("=", 1) for pair in extra.split("&") if "=" in pair)


class Samples:
    def __init__(self, scenario, traffic="traffic", dependency="payments"):
        self.by_second = defaultdict(lambda: defaultdict(int))
        self.durations = defaultdict(list)
        self.by_status = defaultdict(list)
        self.chaos = []
        states = []
        traffic_rows = []
        with gzip.open(REPORTS / f"{scenario}.samples.csv.gz", "rt") as file:
            for row in csv.DictReader(file):
                name, timestamp = row["metric_name"], int(row["timestamp"])
                if name == "http_req_duration" and row["scenario"] == traffic:
                    traffic_rows.append((timestamp, float(row["metric_value"]), row["status"]))
                elif name == "chaos_events" and row["scenario"]:
                    self.chaos.append(timestamp)
                elif name == "circuit_state":
                    tags = parse_tags(row["extra_tags"])
                    if tags.get("dependency") == dependency:
                        states.append((timestamp, tags["state"]))
        self.start = min(t for t, _, _ in traffic_rows)
        for timestamp, value, status in traffic_rows:
            second = timestamp - self.start
            self.by_second[second][status] += 1
            self.durations[second].append(value)
            self.by_status[status].append(value)
        self.chaos = sorted(t - self.start for t in self.chaos)
        self.states = []
        for timestamp, state in sorted(states):
            if not self.states or self.states[-1][1] != state:
                self.states.append((max(timestamp - self.start, 0), state))

    def first(self, state, after=0):
        return next(s for s, st in self.states if st == state and s >= after)

    def last(self, state):
        return [s for s, st in self.states if st == state][-1]


def percentile(values, p):
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(p / 100 * len(ordered)) - 1))
    return ordered[index]


class Svg:
    def __init__(self, height, title, desc):
        self.parts = [
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {height}" '
            f'role="img" aria-labelledby="t d" font-family="{FONT}">',
            f'<title id="t">{escape(title)}</title><desc id="d">{escape(desc)}</desc>',
            f'<rect width="{WIDTH}" height="{height}" rx="20" fill="{SURFACE}"/>',
            f'<rect x="0.5" y="0.5" width="{WIDTH - 1}" height="{height - 1}" rx="20" '
            f'fill="none" stroke="{BORDER}"/>',
        ]

    def add(self, markup):
        self.parts.append(markup)

    def text(self, x, y, content, size=13, fill=TEXT_MUTED, anchor="start", weight=400):
        self.add(
            f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}" '
            f'text-anchor="{anchor}" font-weight="{weight}">{escape(content)}</text>'
        )

    def save(self, path):
        self.add("</svg>")
        Path(path).write_text("\n".join(self.parts) + "\n")


def x_of(second, duration):
    return PLOT_LEFT + second / duration * PLOT_WIDTH


def heading(svg, title, subtitle):
    svg.text(36, 44, title, size=21, fill=TEXT_PRIMARY, weight=700)
    svg.text(36, 68, subtitle, size=14, fill=TEXT_MUTED)


def legend(svg, y, items):
    x = 36
    for color, label in items:
        svg.add(f'<rect x="{x}" y="{y - 10}" width="12" height="12" rx="3" fill="{color}"/>')
        svg.text(x + 18, y, label, size=13, fill=TEXT_SECONDARY)
        x += 18 + len(label) * 7.2 + 26


def state_strip(svg, y, states, duration):
    svg.text(PLOT_LEFT - 10, y + 15, "circuit", size=12, anchor="end")
    for index, (start, state) in enumerate(states):
        end = states[index + 1][0] if index + 1 < len(states) else duration
        end = min(end, duration)
        if end <= start:
            continue
        x0, x1 = x_of(start, duration), x_of(end, duration)
        fill, ink = STATE_STYLE[state]
        svg.add(
            f'<rect x="{x0 + 1:.1f}" y="{y}" width="{max(x1 - x0 - 2, 1):.1f}" '
            f'height="22" rx="5" fill="{fill}"/>'
        )
        label = STATE_LABEL[state]
        if x1 - x0 > len(label) * 7.5 + 10:
            svg.text((x0 + x1) / 2, y + 15.5, label, size=11.5, fill=ink, anchor="middle", weight=700)


def failure_window(svg, top, bottom, start, end, duration, label):
    x0, x1 = x_of(start, duration), x_of(end, duration)
    svg.add(
        f'<rect x="{x0:.1f}" y="{top}" width="{x1 - x0:.1f}" height="{bottom - top}" '
        f'fill="#ffffff" fill-opacity="0.045"/>'
    )
    for x in (x0, x1):
        svg.add(f'<line x1="{x:.1f}" y1="{top}" x2="{x:.1f}" y2="{bottom}" stroke="#555" stroke-width="1"/>')
    if label:
        svg.text((x0 + x1) / 2, top + 16, label, size=12, fill=TEXT_SECONDARY, anchor="middle", weight=600)


def y_grid(svg, top, height, maximum, ticks):
    for tick in ticks:
        y = top + height - tick / maximum * height
        stroke = BASELINE if tick == 0 else GRID
        svg.add(f'<line x1="{PLOT_LEFT}" y1="{y:.1f}" x2="{PLOT_RIGHT}" y2="{y:.1f}" stroke="{stroke}"/>')
        svg.text(PLOT_LEFT - 10, y + 4, f"{tick:,}", size=12, anchor="end")


def x_axis(svg, y, duration, step=10):
    for second in range(0, duration + 1, step):
        svg.text(x_of(second, duration), y, f"{second}s", size=12, anchor="middle")


def stacked_columns(svg, top, height, maximum, by_second, duration, order):
    slot = PLOT_WIDTH / duration
    width = min(slot - 2, 24)
    for second in range(duration):
        counts = by_second.get(second, {})
        x = x_of(second, duration) + (slot - width) / 2
        base = top + height
        present = [(status, color) for status, color in order if counts.get(status)]
        for index, (status, color) in enumerate(present):
            h = counts[status] / maximum * height
            y = base - h
            visible = h - (2 if index > 0 else 0)
            if visible <= 0:
                continue
            if index == len(present) - 1:
                r = min(4, visible / 2, width / 2)
                path = (
                    f"M{x:.1f} {base:.1f} L{x:.1f} {y + r:.1f} Q{x:.1f} {y:.1f} {x + r:.1f} {y:.1f} "
                    f"L{x + width - r:.1f} {y:.1f} Q{x + width:.1f} {y:.1f} {x + width:.1f} {y + r:.1f} "
                    f"L{x + width:.1f} {base:.1f} Z"
                )
                svg.add(f'<path d="{path}" fill="{color}"/>')
            else:
                svg.add(f'<rect x="{x:.1f}" y="{y:.1f}" width="{width:.1f}" height="{visible:.1f}" fill="{color}"/>')
            base = y - 2


def line(svg, points, color, top, height, scale):
    coords = " ".join(f"{x:.1f},{top + height - scale(v) * height:.1f}" for x, v in points)
    svg.add(
        f'<polyline points="{coords}" fill="none" stroke="{color}" stroke-width="2" '
        f'stroke-linejoin="round" stroke-linecap="round"/>'
    )


def callout(svg, x, y, lines, anchor="start"):
    width = max(len(content) for content in lines) * 6.9 + 16
    left = x - 8 if anchor == "start" else x - width + 8
    svg.add(
        f'<rect x="{left:.1f}" y="{y - 15:.1f}" width="{width:.1f}" height="{len(lines) * 17 + 8}" '
        f'rx="8" fill="{SURFACE}" fill-opacity="0.92" stroke="{BORDER}"/>'
    )
    for index, content in enumerate(lines):
        svg.text(x, y + index * 17, content, size=12.5,
                 fill=TEXT_PRIMARY if index == 0 else TEXT_MUTED,
                 anchor=anchor, weight=600 if index == 0 else 400)


def dot(svg, x, y):
    svg.add(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4.5" fill="{TEXT_PRIMARY}" stroke="{SURFACE}" stroke-width="2"/>')


def log_scale(minimum, maximum):
    low, high = math.log10(minimum), math.log10(maximum)
    return lambda v: (math.log10(max(v, minimum)) - low) / (high - low)


def chart_outage(out):
    data = Samples("outage")
    duration = 60
    down, up = data.chaos[0], data.chaos[1]
    opened = data.first("OPEN")
    closed = data.last("CLOSED")

    svg = Svg(600, "Load test: the dependency goes down for 20 seconds",
              "Responses per second by status and p95 latency over 60 seconds at 50 requests per second. "
              f"The dependency fails between {down} and {up} seconds. The circuit opens after about "
              f"{opened - down} seconds, turning slow 502 errors into 503 responses in about 1 ms, and "
              "closes after the dependency recovers.")
    heading(svg, "The dependency goes down for 20 seconds",
            "50 requests/s to POST /sync/payments. The circuit turns slow errors into instant ones.")
    legend(svg, 100, [(SUCCESS, "200 OK"), (DEPENDENCY_ERROR, "502 error from the dependency"),
                      (FAIL_FAST, "503 fail fast (circuit open)")])
    state_strip(svg, 120, data.states, duration)

    top, height = 184, 210
    failure_window(svg, top, top + height, down, up, duration, "dependency down")
    y_grid(svg, top, height, 70, [0, 20, 40, 60])
    svg.text(PLOT_LEFT, top - 12, "responses per second", size=12)
    stacked_columns(svg, top, height, 70, data.by_second, duration,
                    [("200", SUCCESS), ("502", DEPENDENCY_ERROR), ("503", FAIL_FAST)])

    ltop, lheight = 446, 100
    scale = log_scale(0.5, 1000)
    failure_window(svg, ltop, ltop + lheight, down, up, duration, "")
    for tick in [1, 10, 100, 1000]:
        y = ltop + lheight - scale(tick) * lheight
        svg.add(f'<line x1="{PLOT_LEFT}" y1="{y:.1f}" x2="{PLOT_RIGHT}" y2="{y:.1f}" stroke="{GRID}"/>')
        svg.text(PLOT_LEFT - 10, y + 4, f"{tick:,} ms", size=12, anchor="end")
    svg.text(PLOT_LEFT, ltop - 12, "p95 latency (log scale)", size=12)
    slot = PLOT_WIDTH / duration
    points = [(x_of(s, duration) + slot / 2, percentile(data.durations[s], 95))
              for s in range(duration) if data.durations.get(s)]
    line(svg, points, LATENCY_LINE, ltop, lheight, scale)
    x_axis(svg, ltop + lheight + 22, duration)

    fast = [percentile(data.durations[s], 95) for s in range(opened + 1, up) if data.durations.get(s)]
    fast_p95 = sum(fast) / len(fast)
    xo = x_of(opened, duration)
    dot(svg, xo + slot, ltop + lheight - scale(fast_p95) * lheight)
    callout(svg, xo + slot + 16, ltop + 26,
            [f"circuit opens {opened - down} s after the outage:",
             f"failures answer in ~{fast_p95:.0f} ms instead of ~100 ms"])
    callout(svg, x_of(closed, duration) + 10, top + 22,
            [f"closes {closed - up} s after recovery", "(open timeout + 2 health checks)"])
    svg.save(Path(out) / "load-test-outage.svg")


def chart_slow(out):
    data = Samples("slow-dependency")
    duration = 60
    slow, back = data.chaos[0], data.chaos[1]
    opened = data.first("OPEN")

    svg = Svg(600, "Load test: the dependency becomes slow",
              "Responses per second by status and the slowest response per second over 60 seconds at 50 "
              f"requests per second. Between {slow} and {back} seconds the dependency takes 3 seconds to "
              "answer. Requests are cut at the 2-second timeout, the extra ones are rejected by the "
              "semaphore, and the circuit opens.")
    heading(svg, "The dependency becomes slow (3 s per call)",
            "50 requests/s to POST /sync/payments, with a 2-second timeout and 13 slots.")
    legend(svg, 100, [(SUCCESS, "200 OK"), (DEPENDENCY_ERROR, "504 timeout"),
                      (FAIL_FAST, "503 fail fast (semaphore full or circuit open)")])
    state_strip(svg, 120, data.states, duration)

    top, height = 184, 210
    failure_window(svg, top, top + height, slow, back, duration, "dependency slow")
    y_grid(svg, top, height, 70, [0, 20, 40, 60])
    svg.text(PLOT_LEFT, top - 12, "responses per second", size=12)
    stacked_columns(svg, top, height, 70, data.by_second, duration,
                    [("200", SUCCESS), ("504", DEPENDENCY_ERROR), ("503", FAIL_FAST)])

    ltop, lheight = 446, 100
    maximum = 3500

    def scale(v):
        return min(v, maximum) / maximum

    failure_window(svg, ltop, ltop + lheight, slow, back, duration, "")
    for tick in [0, 1000, 2000, 3000]:
        y = ltop + lheight - scale(tick) * lheight
        svg.add(f'<line x1="{PLOT_LEFT}" y1="{y:.1f}" x2="{PLOT_RIGHT}" y2="{y:.1f}" '
                f'stroke="{BASELINE if tick == 0 else GRID}"/>')
        svg.text(PLOT_LEFT - 10, y + 4, f"{tick / 1000:g} s", size=12, anchor="end")
    for value, label in [(3000, "dependency takes 3 s"), (2000, "our timeout: 2 s")]:
        y = ltop + lheight - scale(value) * lheight
        svg.add(f'<line x1="{x_of(slow, duration):.1f}" y1="{y:.1f}" x2="{x_of(back, duration):.1f}" '
                f'y2="{y:.1f}" stroke="{TEXT_MUTED}" stroke-dasharray="4 4"/>')
        svg.text(x_of(back, duration) + 6, y + 4, label, size=12, fill=TEXT_MUTED)
    svg.text(PLOT_LEFT, ltop - 12, "slowest response in each second", size=12)
    slot = PLOT_WIDTH / duration
    points = [(x_of(s, duration) + slot / 2, max(data.durations[s]))
              for s in range(duration) if data.durations.get(s)]
    line(svg, points, LATENCY_LINE, ltop, lheight, scale)
    x_axis(svg, ltop + lheight + 22, duration)

    worst = max(max(v) for v in data.durations.values())
    callout(svg, x_of(opened, duration) + 10, top + 62,
            [f"circuit opens {opened - slow} s in", "(timeouts count as failures)"])
    callout(svg, x_of(slow, duration) - 10, ltop + 18,
            [f"worst case: {worst / 1000:.2f} s", "nobody waits 3 s"], anchor="end")
    svg.save(Path(out) / "load-test-slow-dependency.svg")


def chart_spike(out):
    data = Samples("spike")
    duration = 40

    svg = Svg(500, "Load test: traffic spike to a healthy dependency",
              "Responses per second by status over 40 seconds while traffic ramps from 20 to 300 requests "
              "per second. Around 130 requests per second are served (13 slots at 100 ms each); the rest "
              "are rejected in under 1 ms. The circuit stays closed the whole time.")
    heading(svg, "Traffic spike: 20 → 300 requests/s to a healthy dependency",
            "The semaphore (13 slots ≈ 130 requests/s at 100 ms each) rejects only the extra traffic.")
    legend(svg, 100, [(SUCCESS, "200 OK (served)"), (FAIL_FAST, "503 fail fast (semaphore full)")])
    state_strip(svg, 120, data.states, duration)

    top, height = 184, 240
    maximum = 320
    y_grid(svg, top, height, maximum, [0, 100, 200, 300])
    svg.text(PLOT_LEFT, top - 12, "responses per second", size=12)
    stacked_columns(svg, top, height, maximum, data.by_second, duration,
                    [("200", SUCCESS), ("503", FAIL_FAST)])

    capacity = 130
    y = top + height - capacity / maximum * height
    svg.add(f'<line x1="{PLOT_LEFT}" y1="{y:.1f}" x2="{PLOT_RIGHT}" y2="{y:.1f}" '
            f'stroke="{TEXT_PRIMARY}" stroke-opacity="0.7" stroke-dasharray="5 4"/>')
    svg.text(PLOT_LEFT + 6, y - 7, "capacity ≈ 130 req/s", size=12, fill=TEXT_SECONDARY, weight=600)
    x_axis(svg, top + height + 22, duration)

    never_opened = all(state == "CLOSED" for _, state in data.states)
    callout(svg, PLOT_RIGHT, top + 22,
            [f"served: p95 {percentile(data.by_status['200'], 95):.0f} ms",
             f"rejected: p95 {percentile(data.by_status['503'], 95):.2f} ms",
             "circuit never opens" if never_opened else "circuit opened"], anchor="end")
    svg.save(Path(out) / "load-test-spike.svg")


if __name__ == "__main__":
    output = sys.argv[1] if len(sys.argv) > 1 else "."
    Path(output).mkdir(parents=True, exist_ok=True)
    chart_outage(output)
    chart_slow(output)
    chart_spike(output)
    print(f"charts written to {output}")
