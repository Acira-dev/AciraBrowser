import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { _electron } from "playwright";
import { poll } from "./native-helpers.mjs";
import { completeLocalSetup } from "./release-local-setup.mjs";
import { initializeReleaseProfile } from "./release-initialize-profile.mjs";
import {
  selectQualifiedPackages,
  launchQualifiedPackage,
  qualifyPackage,
} from "./accounts-qualified-packages.mjs";

const root = process.cwd(),
  stamp = Date.now(),
  data = path.resolve(".qa-profiles/accounts-private-worker-" + stamp),
  out = path.resolve("qa/artifacts/accounts-private-worker-" + stamp),
  { candidates } = await selectQualifiedPackages({ root, limit: 1 }),
  candidate = candidates[0];
assert.ok(candidate, "A current fully qualified portable is required");
await fs.mkdir(data, { recursive: true });
await fs.mkdir(out, { recursive: true });
let app,
  held,
  closedAt = null;
const traffic = [],
  report = {
    checks: [],
    candidateSource: candidate.sourceDigest,
    native: true,
    scope:
      "Actual qualified portable private-window close with a proven active worker; native observations retain no Session reference across close. No cleanup, request, worker or auth implementation is replaced.",
  };
const worker = `self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>event.waitUntil((async()=>{
  try{await fetch('/hold',{cache:'no-store'});}catch{}
  try{await cookieStore.set({name:'private-worker-late',value:'fixture',path:'/'});}catch{}
  try{await fetch('/after-private-close',{cache:'no-store'});}catch{}
})()));`;
const server = http.createServer((request, response) => {
  const route = new URL(request.url, "http://fixture").pathname;
  traffic.push({
    route,
    afterClose: closedAt !== null,
    privateSeed: /private-seed=fixture/.test(request.headers.cookie || ""),
    lateCookie: /private-worker-late=fixture/.test(
      request.headers.cookie || "",
    ),
  });
  response.setHeader("Cache-Control", "no-store");
  if (route === "/worker.js") {
    response.setHeader("Content-Type", "application/javascript");
    return response.end(worker);
  }
  if (route === "/hold") {
    held = response;
    return;
  }
  if (route === "/private")
    response.setHeader(
      "Set-Cookie",
      "private-seed=fixture; Path=/; SameSite=Lax",
    );
  if (route === "/ordinary")
    response.setHeader(
      "Set-Cookie",
      "ordinary-only=kept; Path=/; SameSite=Lax; Max-Age=3600",
    );
  response.setHeader("Content-Type", "text/html");
  response.end(
    "<!doctype html><title>Private worker fixture</title><h1>Controlled worker fixture</h1>",
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const snapshot = (page) => page.evaluate(() => window.acira.getSnapshot());
async function chrome(privateMode) {
  return poll(
    async () => {
      for (const page of app.context().pages())
        if (page.url() === "acira-browser-ui://ui/index.html") {
          try {
            const state = await snapshot(page);
            if (
              state.browserProfiles.some(
                (profile) =>
                  profile.id === state.activeBrowserProfileId &&
                  !!profile.private === privateMode,
              )
            )
              return page;
          } catch {}
        }
    },
    Boolean,
    "Actual owning private/ordinary chrome",
    15000,
  );
}
async function navigate(ui, route) {
  const state = await snapshot(ui);
  await ui.evaluate(
    ({ tabId, url }) =>
      window.acira.browserCommand({ type: "navigate", tabId, url }),
    { tabId: state.activeTabId, url: base + route },
  );
  return poll(
    async () =>
      app
        .context()
        .pages()
        .find((page) => page.url() === base + route),
    Boolean,
    "Controlled website loaded",
    10000,
  );
}
try {
  report.initialization = await launchQualifiedPackage({
    root,
    candidate,
    launch: (options) =>
      initializeReleaseProfile({
        candidate: path.join(
          path.dirname(options.executablePath),
          "resources/app",
        ),
        data,
        executablePath: options.executablePath,
        packaged: true,
      }),
  });
  app = await launchQualifiedPackage({
    root,
    candidate,
    launch: (options) => _electron.launch(options),
    options: {
      args: [],
      env: {
        ...process.env,
        ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data,
        ACIRA_BROWSER_TEST_HIDDEN: "1",
        LOCALAPPDATA: path.join(data, "empty-import-sources"),
      },
    },
  });
  const ordinaryUI = await chrome(false);
  await completeLocalSetup(ordinaryUI);
  await navigate(ordinaryUI, "/ordinary");
  const normalState = await snapshot(ordinaryUI),
    normalPartition = normalState.browserProfiles.find(
      (profile) => profile.id === normalState.activeBrowserProfileId,
    ).partition;
  await ordinaryUI.evaluate(() => window.acira.openWindow("private"));
  const privateUI = await chrome(true),
    privatePage = await navigate(privateUI, "/private"),
    privateState = await snapshot(privateUI),
    partition = privateState.browserProfiles.find(
      (profile) => profile.id === privateState.activeBrowserProfileId,
    ).partition;
  await privatePage
    .getByRole("heading", { name: "Controlled worker fixture" })
    .waitFor();
  await privatePage.evaluate(async () => {
    await navigator.serviceWorker.register("/worker.js");
    const registration = await navigator.serviceWorker.ready;
    registration.active.postMessage("hold");
  });
  await poll(
    () => !!held,
    Boolean,
    "Positive active worker HTTP request",
    10000,
  );
  report.before = await app.evaluate(({ session }, partition) => {
    return {
      running: Object.keys(
        session.fromPartition(partition).serviceWorkers.getAllRunning(),
      ).length,
    };
  }, partition);
  assert.ok(report.before.running > 0);
  report.checks.push(
    "Actual private worker is running and has issued a held HTTP request before window closure",
  );
  await Promise.all([
    privateUI.waitForEvent("close"),
    privateUI.evaluate(() => window.acira.windowControl("close")),
  ]);
  closedAt = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (!held.writableEnded && !held.destroyed)
    held.end("release after private window closed");
  await new Promise((resolve) => setTimeout(resolve, 2000));
  report.after = await app.evaluate(
    async ({ session }, { normalPartition, partition, base }) => {
      const old = session.fromPartition(partition);
      return {
        running: Object.keys(old.serviceWorkers.getAllRunning()).length,
        privateCookieNames: (await old.cookies.get({ url: base })).map(
          (cookie) => cookie.name,
        ),
        ordinaryRetained: (
          await session
            .fromPartition(normalPartition)
            .cookies.get({ url: base })
        ).some(
          (cookie) =>
            cookie.name === "ordinary-only" && cookie.value === "kept",
        ),
      };
    },
    { normalPartition, partition, base },
  );
  report.lateRequests = traffic.filter(
    (item) => item.route === "/after-private-close" && item.afterClose,
  ).length;
  assert.equal(
    report.lateRequests,
    0,
    "A private worker must not continue HTTP after its window closes",
  );
  assert.equal(report.after.running, 0, "Private worker must stop on close");
  assert.deepEqual(report.after.privateCookieNames, []);
  assert.equal(report.after.ordinaryRetained, true);
  report.checks.push(
    "Private close stops worker continuation and clears its old native cookie store while ordinary profile remains intact",
  );
  assert.equal(
    await app.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows().some((window) => window.isVisible()),
    ),
    false,
  );
  const current = await qualifyPackage({ root, reportName: candidate.report });
  assert.equal(current.packageManifestSha256, candidate.packageManifestSha256);
  report.packageManifestSha256 = current.packageManifestSha256;
  report.status = "PASS";
} catch (error) {
  report.status = "FINDING_OR_FIXTURE_FAILURE";
  report.failure = error.stack || error.message;
  process.exitCode = 1;
} finally {
  if (held && !held.writableEnded && !held.destroyed) held.end("cleanup");
  try {
    await app?.close();
  } catch {}
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  report.traffic = traffic;
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        status: report.status,
        checks: report.checks,
        before: report.before,
        after: report.after,
        lateRequests: report.lateRequests,
        failure: report.failure,
        out,
      },
      null,
      2,
    ),
  );
}
