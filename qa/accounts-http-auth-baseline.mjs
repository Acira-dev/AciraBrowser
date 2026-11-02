import { _electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { poll } from "./native-helpers.mjs";

// Observe default cancellation only. Never prevent login or supply credentials.
const root = process.cwd(),
  run = Date.now();
const out = path.join(root, "qa/artifacts/accounts-http-auth-baseline-" + run);
const data = path.join(root, ".qa-profiles/accounts-http-auth-baseline-" + run);
await fs.mkdir(out, { recursive: true });
const sourceFiles = [
  "desktop/main.cjs",
  "desktop/ui-preload.cjs",
  "desktop/runtime.cjs",
  "dist/index.html",
];
const hashes = async () =>
  Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (file) => [
        file,
        createHash("sha256")
          .update(await fs.readFile(path.join(root, file)))
          .digest("hex"),
      ]),
    ),
  );
const before = await hashes();
let requests = 0,
  withAuthorization = 0,
  app;
const server = http.createServer((request, response) => {
  requests++;
  if (request.headers.authorization) withAuthorization++;
  response.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="Local fixture only"',
    "Cache-Control": "no-store",
    "Content-Type": "text/html",
  });
  response.end(
    "<!doctype html><title>Authentication required</title><h1>Local authentication required</h1>",
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port + "/protected";
try {
  app = await _electron.launch({
    executablePath:
      process.env.ACIRA_TEST_EXECUTABLE ||
      path.join(root, "node_modules/electron/dist/electron.exe"),
    args: [path.join(root, "desktop/main.cjs")],
    env: {
      ...process.env,
      ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data,
      ACIRA_BROWSER_TEST_HIDDEN: "1",
      ACIRA_MATERIAL: "none",
    },
  });
  const initial = await app.evaluate(({ app }) => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    appLoginListeners: app.listenerCount("login"),
  }));
  assert.equal(initial.electron, "44.9.3");
  assert.equal(
    initial.appLoginListeners,
    0,
    "Baseline is no longer missing the app login handler",
  );
  await app.evaluate(({ app }) => {
    globalThis.httpAuthBaseline = [];
    app.on("login", (_event, wc, details, authInfo) => {
      // Passive observer: default cancellation remains untouched.
      globalThis.httpAuthBaseline.push({
        webContentsId: wc?.id,
        url: details.url,
        firstAuthAttempt: details.firstAuthAttempt,
        isProxy: authInfo.isProxy,
        scheme: authInfo.scheme,
        host: authInfo.host,
        port: authInfo.port,
      });
    });
  });
  const ui = await poll(
    async () =>
      (
        await Promise.all(
          app
            .context()
            .pages()
            .map(async (page) =>
              page.url().startsWith("acira-browser-ui://ui/index.html")
                ? page
                : null,
            ),
        )
      ).find(Boolean),
    Boolean,
    "trusted browser chrome",
  );
  const status = await ui.evaluate(() =>
    window.acira.setup({ type: "status" }),
  );
  if (!status.progress.complete)
    await ui.getByRole("button", { name: "Skip setup", exact: true }).click();
  const state = await ui.evaluate(() => window.acira.getSnapshot());
  await ui.evaluate(
    ({ tabId, url }) =>
      window.acira.browserCommand({ type: "navigate", tabId, url }),
    { tabId: state.activeTabId, url },
  );
  const observed = await poll(
    () => app.evaluate(() => globalThis.httpAuthBaseline),
    (value) => value.length > 0,
    "actual unhandled Basic challenge",
  );
  await poll(
    () =>
      ui.evaluate(async () => {
        const snapshot = await window.acira.getSnapshot();
        return snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId)
          ?.loading;
      }),
    (value) => value === false,
    "cancelled challenge settles",
  );
  assert.equal(withAuthorization, 0);
  assert.ok(requests > 0);
  assert.equal(observed[0].isProxy, false);
  assert.equal(observed[0].scheme, "basic");
  const visible = await app.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows().some((window) => window.isVisible()),
  );
  assert.equal(visible, false);
  assert.deepEqual(
    await hashes(),
    before,
    "Baseline sources changed during the native run",
  );
  const result = {
    classification: "VERIFIED_MISSING_HTTP_AUTH_HANDLER",
    actual: initial,
    challenges: observed,
    requests,
    requestsWithAuthorization: withAuthorization,
    credentialsSupplied: false,
    eventPrevented: false,
    selectedSources: before,
    selectedSourcesStable: true,
    visibleWindows: false,
    native: true,
    scope:
      "Actual current Acira Basic challenge cancels by default; local fixture only, no product handler/credentials/dialog injected",
  };
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify(
      { classification: result.classification, artifacts: out, requests },
      null,
      2,
    ),
  );
} catch (error) {
  await fs.writeFile(
    path.join(out, "partial.json"),
    JSON.stringify(
      { failure: error.message, requests, withAuthorization },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await app?.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
