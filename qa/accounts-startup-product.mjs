import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { chromium } from "playwright";
import { qualifiedElectron } from "./release-runtime.mjs";
import { completeLocalSetup } from "./release-local-setup.mjs";
import { poll } from "./native-helpers.mjs";

const stamp = Date.now(),
  nonce = randomUUID(),
  data = path.resolve(".qa-profiles/accounts-startup-product-" + stamp),
  out = path.resolve("qa/artifacts/accounts-startup-product-" + stamp),
  entry = path.resolve("qa/accounts-startup-product-host.cjs"),
  runtime = await qualifiedElectron();
await fs.mkdir(data, { recursive: true });
await fs.mkdir(out, { recursive: true });
const selected = [
  "desktop/main.cjs",
  "desktop/startup-gate.cjs",
  "desktop/accounts/external-links.cjs",
  "desktop/browser-services/encryption-bootstrap.cjs",
  "desktop/preload.cjs",
  "desktop/ui-preload.cjs",
  "desktop/runtime.cjs",
  "dist/index.html",
];
const hashes = async () =>
  Object.fromEntries(
    await Promise.all(
      selected.map(async (file) => [
        file,
        createHash("sha256")
          .update(await fs.readFile(file))
          .digest("hex"),
      ]),
    ),
  );
const before = await hashes(),
  children = [],
  hits = [],
  errors = [];
const read = (name) =>
  fs
    .readFile(path.join(data, name + ".json"), "utf8")
    .then(JSON.parse)
    .catch(() => null);
const report = {
  checks: [],
  native: true,
  qualification:
    "Actual product main with an observation wrapper and deterministic first bootstrap cancelled-Quit barrier; no injected URL parser, queue, session, credential or encryption warmup",
  limitations: [
    "Windows genuine cold/second-instance delivery; open-url is emitted at the actual native app listener because Windows does not provide macOS OS open-url delivery",
    "Disposable hidden profile, controlled HTTP documents and no user desktop input; no package/installer or first-credential crash claim",
  ],
};
let browser, context, ui, initial;
const server = http.createServer(async (request, response) => {
  const build = await read("preview-build");
  hits.push({
    label: new URL(request.url, "http://fixture").pathname,
    afterReady:
      build?.events.some(
        (event) => event.event === "secure-startup" && event.ready === true,
      ) === true,
  });
  response.setHeader("Content-Type", "text/html");
  response.end(
    "<!doctype html><title>Controlled startup link</title><h1>Ready</h1>",
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`,
  cold = base + "/cold?opaque=first#preserved",
  second = base + "/second?opaque=second#preserved",
  late = base + "/late?opaque=late#preserved",
  open = base + "/open?opaque=open#preserved",
  warm = base + "/warm?opaque=warm#preserved",
  largeQueue = process.argv.includes("--large-queue"),
  long = base + "/large?opaque=" + "x".repeat(6900) + "#preserved",
  secondaryEvents = [
    second,
    late,
    cold,
    ...Array(largeQueue ? 5 : 0).fill(long),
  ],
  expected = [cold, ...secondaryEvents, open];
const env = {
  ...process.env,
  ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data,
  ACIRA_BROWSER_TEST_HIDDEN: "1",
  ACIRA_PREVIEW_RECORD: "1",
  ACIRA_ACCOUNTS_STARTUP_NONCE: nonce,
  ACIRA_ACCOUNTS_OPEN_URL: open,
  LOCALAPPDATA: path.join(data, "empty-import-sources"),
};
delete env.ACIRA_DEV;
delete env.NODE_OPTIONS;
delete env.ELECTRON_RUN_AS_NODE;
const launch = (url, owner = false) => {
  const child = spawn(
    runtime.executablePath,
    [
      "--remote-debugging-port=0",
      entry,
      ...(owner ? ["--accounts-startup-owner=" + nonce] : []),
      ...(url ? [url] : []),
    ],
    { env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  child.stderr.on("data", (chunk) => {
    report.diagnostics = (String(report.diagnostics || "") + chunk).slice(
      -6000,
    );
  });
  children.push(child);
  return child;
};
const exited = async (child) =>
  (
    await poll(
      () => (child.exitCode === null ? null : { code: child.exitCode }),
      Boolean,
      "Owned native child exit " + child.pid,
      20000,
    )
  ).code;
const wait = (name) =>
  poll(
    () => read(name),
    (value) => value?.nonce === nonce,
    name,
    25000,
  );
const state = () => ui.evaluate(() => window.acira.getSnapshot());
try {
  await assert.rejects(fs.stat(path.join(data, "Local State")), {
    code: "ENOENT",
  });
  initial = launch(cold, true);
  const barrier = await wait("barrier");
  assert.equal(barrier.pid, initial.pid);
  assert.equal(barrier.windows, 0);
  assert.equal(barrier.contents, 0);
  assert.equal(barrier.protected, true);
  assert.equal(hits.length, 0);
  for (const url of secondaryEvents) assert.equal(await exited(launch(url)), 0);
  await fs.writeFile(path.join(data, "open.signal"), "go");
  assert.equal((await wait("open-event")).prevented, true);
  report.eventCount = expected.length;
  report.canonicalURLCharacters = expected.reduce(
    (sum, url) => sum + url.length,
    0,
  );
  if (largeQueue) {
    assert.ok(report.canonicalURLCharacters > 32767);
    report.protectedHandoffBytes = await poll(
      async () => (await fs.stat(path.join(data, "startup-links.bin"))).size,
      (bytes) => bytes > 32767,
      "Real protected handoff exceeds Windows command-line capacity",
    );
    assert.equal(
      (await fs.readFile(path.join(data, "startup-links.bin"))).includes(
        Buffer.from("opaque="),
      ),
      false,
    );
  }
  assert.equal(hits.length, 0);
  report.checks.push(
    "Actual product cold/second-instance/duplicate and native open-url events arrive during the first-key quit barrier with zero native windows, web contents or controlled website requests",
  );
  await fs.writeFile(path.join(data, "release.signal"), "go");
  assert.equal(await exited(initial), 0);
  const built = await poll(
    () => read("preview-build"),
    (value) =>
      value?.pid !== initial.pid &&
      value?.events.some(
        (event) =>
          event.event === "secure-startup" && event.ready && event.resumed,
      ),
    "Actual resumed product ready",
    25000,
  );
  const endpoint = await poll(
    async () => {
      try {
        const [port, suffix] = (
          await fs.readFile(path.join(data, "DevToolsActivePort"), "utf8")
        )
          .trim()
          .split("\n");
        const value = await fetch(
          "http://127.0.0.1:" + port + "/json/version",
        ).then((response) => response.json());
        return value.webSocketDebuggerUrl?.endsWith(suffix)
          ? value.webSocketDebuggerUrl
          : null;
      } catch {
        return null;
      }
    },
    Boolean,
    "Own relaunched debugger",
    15000,
  );
  browser = await chromium.connectOverCDP(endpoint);
  context = browser.contexts()[0];
  ui = await poll(
    async () =>
      context
        .pages()
        .find((page) => page.url() === "acira-browser-ui://ui/index.html"),
    Boolean,
    "Actual chrome",
    15000,
  );
  ui.on("pageerror", (error) => errors.push(error.message));
  await ui.waitForFunction(() => !!window.acira);
  await completeLocalSetup(ui);
  const saved = await poll(
    state,
    (value) =>
      value.tabs.filter((tab) => tab.url.startsWith(base)).length ===
      expected.length,
    "All startup tabs",
    15000,
  );
  assert.deepEqual(
    saved.tabs.filter((tab) => tab.url.startsWith(base)).map((tab) => tab.url),
    expected,
  );
  const observed = await poll(
    () => read("observed"),
    (value) => value?.pid === built.pid && value.windows > 0,
    "Owned native observation",
  );
  assert.equal(observed.hidden, true);
  assert.equal(observed.httpArgCount, 0);
  assert.equal(observed.handoffRemoved, true);
  assert.equal(observed.resumed, true);
  report.runtime = observed.runtime;
  report.initialPid = initial.pid;
  report.resumedPid = built.pid;
  report.checks.push(
    `Product-owned normal relaunch delivers ${expected.length} chronological events exactly once, retaining duplicate URL/query/fragment with zero HTTP relaunch arguments and consumed encrypted handoff; native windows stay hidden`,
  );
  assert.equal(await exited(launch(warm)), 0);
  await poll(
    state,
    (value) => value.tabs.some((tab) => tab.url === warm),
    "Ordinary running second-instance link",
  );
  assert.equal(
    (await state()).tabs.filter((tab) => tab.url === warm).length,
    1,
  );
  assert.equal((await read("preview-build")).pid, built.pid);
  assert.ok(hits.length > 0);
  assert.ok(hits.every((hit) => hit.afterReady));
  assert.deepEqual(errors, []);
  report.checks.push(
    "Running second-instance delivery remains in the same primary; every observed controlled HTTP request follows native secure readiness and no renderer errors occur",
  );
  assert.deepEqual(await hashes(), before);
  report.sources = before;
  report.sourcesStable = true;
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.failure = error.stack || error.message;
  process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(data, "release.signal"), "go");
  await fs.writeFile(path.join(data, "quit.signal"), "quit");
  try {
    await poll(
      async () => (await read("observed"))?.pid,
      Boolean,
      "Owned cleanup identity",
      1000,
    );
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 700));
  try {
    const exited = await poll(
      () => read("exit-" + (report.resumedPid || initial?.pid)),
      (value) => value?.nonce === nonce && value.normal,
      "Owned graceful native cleanup",
      12000,
    );
    report.cleanup = { pid: exited.pid, normalQuit: true };
  } catch (error) {
    report.cleanupError = error.message;
    report.status = "FAIL";
    process.exitCode = 1;
  }
  try {
    await browser?.close();
  } catch {}
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  report.hits = hits;
  report.errors = errors;
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        status: report.status,
        checks: report.checks,
        failure: report.failure,
        out,
      },
      null,
      2,
    ),
  );
}
