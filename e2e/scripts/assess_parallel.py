"""Measure complete Playwright process trees on Linux without extra dependencies."""
import json
import os
from pathlib import Path
import platform
import statistics
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "test-results" / "parallel-assessment"
CLI = ROOT / "node_modules" / "@playwright" / "test" / "cli.js"


def tree_rss(pid):
    processes = {}
    for entry in Path("/proc").iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            fields = dict(line.split(":", 1) for line in (entry / "status").read_text().splitlines() if ":" in line)
            processes[int(entry.name)] = (int(fields["PPid"]), int(fields.get("VmRSS", "0 kB").split()[0]))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
    descendants = {pid}
    while True:
        expanded = descendants | {child for child, (parent, _) in processes.items() if parent in descendants}
        if expanded == descendants:
            return sum(rss for child, (_, rss) in processes.items() if child in descendants) / 1024
        descendants = expanded


def measure(scope, parallel, iteration):
    mode = "fully-parallel" if parallel else "file-parallel"
    name = f"{scope}-{iteration}-{mode}"
    command = ["node", str(CLI), "test", "--workers=2", "--retries=0", "--reporter=json", f"--output={OUTPUT / name}"]
    if scope == "single":
        command.append("auth-page.spec.ts")
    if parallel:
        command.append("--fully-parallel")
    env = {**os.environ, "CI": "true", "E2E_DIAGNOSTICS": "0"}
    env.pop("DEBUG", None)
    start = time.perf_counter()
    peak = 0
    with (OUTPUT / f"{name}.json").open("w") as report, (OUTPUT / f"{name}.stderr").open("w") as stderr:
        child = subprocess.Popen(command, cwd=ROOT, env=env, stdout=report, stderr=stderr)
        while child.poll() is None:
            peak = max(peak, tree_rss(child.pid))
            time.sleep(0.1)
        elapsed = time.perf_counter() - start
    report = json.loads((OUTPUT / f"{name}.json").read_text())
    result = dict(scope=scope, mode=mode, iteration=iteration, seconds=round(elapsed, 3),
                  peakRssMiB=round(peak, 1), exitCode=child.returncode, stats=report["stats"])
    print(json.dumps(result), flush=True)
    if child.returncode or report["stats"]["unexpected"] or report["stats"]["flaky"]:
        raise RuntimeError(f"{name} failed; no performance conclusion is valid")
    return result


def main():
    if sys.platform != "linux":
        raise SystemExit("This measurement uses /proc and must run on Linux.")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    environment = dict(os=platform.platform(), node=subprocess.check_output(["node", "--version"], text=True).strip(),
                       playwright=subprocess.check_output(["node", str(CLI), "--version"], text=True).strip(),
                       cpuCount=os.cpu_count(), sampleIntervalMs=100,
                       memoryMethod="sum of sampled process-tree VmRSS; shared pages may be counted multiple times")
    (OUTPUT / "environment.json").write_text(json.dumps(environment, indent=2))
    results = []
    for scope in ["single", "suite"]:
        # Warm up each scheduling mode separately; omit these from medians.
        for parallel in [False, True]:
            measure(scope, parallel, "warmup")
        for iteration, parallel in enumerate([False, True, True, False, False, True, True, False, False, True], 1):
            results.append(measure(scope, parallel, iteration))
            (OUTPUT / "metrics.json").write_text(json.dumps(results, indent=2))
    lines = ["## Ubuntu E2E assessment", "", "| Scope | Mode | Median seconds | Range seconds | Median peak RSS MiB |", "| --- | --- | ---: | --- | ---: |"]
    for scope in ["single", "suite"]:
        for mode in ["file-parallel", "fully-parallel"]:
            rows = [row for row in results if row["scope"] == scope and row["mode"] == mode]
            times = [row["seconds"] for row in rows]
            lines.append(f"| {scope} | {mode} | {statistics.median(times):.3f} | {min(times):.3f}–{max(times):.3f} | {statistics.median(row['peakRssMiB'] for row in rows):.1f} |")
    lines += ["", "Five measured runs per mode; two workers, zero retries, original timeouts. Warmups excluded. Diagnostic logging disabled during measurement.", ""]
    summary = "\n".join(lines)
    (OUTPUT / "summary.md").write_text(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as step_summary:
            step_summary.write(summary)
    print(summary)


if __name__ == "__main__":
    main()
