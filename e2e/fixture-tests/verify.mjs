import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = path.join(root, "node_modules/@playwright/test/cli.js");

function specs(suite) {
  return [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(specs)];
}

for (const parallel of [false, true]) {
  const mode = parallel ? "parallel" : "serial";
  const output = path.join(root, "test-results/fixture-contract", mode);
  const reportPath = `${output}.json`;
  const html = `${output}-html`;
  const args = [cli, "test", "-c", "fixture-tests/playwright.config.ts", "--workers=2", `--output=${output}`];
  if (parallel) args.push("--fully-parallel");
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, RECORDING_REPORT: reportPath, RECORDING_HTML: html },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  assert.equal(code, 1, "only the intentional failures should fail the child runner");
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.stats.expected, 1);
  assert.equal(report.stats.unexpected, 2);
  const paths = new Set();
  for (const spec of report.suites.flatMap(specs)) {
    const [result] = spec.tests[0].results;
    if (spec.title === "discards recordings after success") {
      assert.equal(result.status, "passed");
      assert.equal(result.attachments.filter(a => a.contentType === "video/webm").length, 0);
      continue;
    }
    const marker = spec.title.endsWith("alpha") ? "alpha" : "beta";
    assert.equal(result.status, "failed");
    assert.equal(result.errors.length, 1, "no additional setup/teardown error");
    assert.match(result.errors[0].message, new RegExp(`intentional recording failure: ${marker}`));
    const videos = result.attachments.filter(a => a.contentType === "video/webm");
    assert.equal(videos.length, 3, "initial, closed, and open pages must all be attached");
    for (const video of videos) {
      assert.ok(!paths.has(video.path), "recordings must belong to distinct tests/pages");
      paths.add(video.path);
      const data = await readFile(video.path);
      assert.ok(data.length > 4);
      assert.equal(data.subarray(0, 4).toString("hex"), "1a45dfa3", "WebM header");
    }
    const trace = result.attachments.find(a => a.name === "trace");
    assert.ok(trace);
    assert.ok((await stat(trace.path)).size > 0);
  }
  const files = await readdir(output, { recursive: true });
  assert.equal(files.filter(f => f.includes("discards-recordings-after-success") && f.endsWith(".webm")).length, 0, "success recordings must be deleted");
  assert.ok((await stat(path.join(html, "index.html"))).size > 0);
  assert.equal((await readdir(path.join(html, "data"))).filter(f => f.endsWith(".webm")).length, 6);
  console.log(`${mode}: recording attachments, closed pages, isolation, trace, HTML and success cleanup verified`);
}
