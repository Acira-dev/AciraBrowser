import { _electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { poll } from "./native-helpers.mjs";

// Reuse an already completed synthetic old-engine fixture at its EXACT userData
// path. Never launches the withdrawn old runtime or accepts personal data paths.
const root = process.cwd(),
  fixtureReport = path.resolve(
    process.argv[2] ||
      "qa/artifacts/accounts-upgrade-1792796931420/result.json",
  );
assert.equal(
  fixtureReport.startsWith(path.join(root, "qa/artifacts") + path.sep),
  true,
);
const baseline = JSON.parse(await fs.readFile(fixtureReport, "utf8")),
  data = path.resolve(baseline.actual[0].userData);
assert.equal(path.dirname(data), path.join(root, ".qa-profiles"));
assert.match(path.basename(data), /^accounts-upgrade-\d+$/);
assert.equal(baseline.checks.length, 4);
const receipt = path.join(data, "acira-qa-engine-upgrade.json");
try {
  await fs.access(receipt);
  throw new Error(
    "This fixture was already opened by the engine-migration test. Supply untouched old data or restore the recorded pre-upgrade backup before claiming another old-engine migration.",
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const database = new DatabaseSync(path.join(data, "browser.sqlite"), {
  readOnly: true,
});
const before = JSON.parse(
  database.prepare("SELECT payload FROM windows WHERE id=?").get("main")
    .payload,
);
database.close();
const profileA = before.browserProfiles.find(
    (profile) => profile.id === before.activeBrowserProfileId,
  ),
  profileB = before.browserProfiles.find(
    (profile) => profile.name === "Handoff B",
  ),
  bookmark = before.bookmarkNodes.find((item) =>
    item.url.endsWith("/bookmark"),
  );
assert.ok(profileA);
assert.ok(profileB);
assert.ok(bookmark);
const origin = new URL(bookmark.url);
assert.equal(origin.protocol, "http:");
assert.equal(origin.hostname, "127.0.0.1");
assert.ok(origin.port);
const run = Date.now(),
  out = path.join(root, "qa/artifacts/accounts-engine-upgrade-" + run);
await fs.mkdir(out, { recursive: true });
const backup = path.join(out, "before-engine-upgrade-profile");
await fs.cp(data, backup, {
  recursive: true,
  force: false,
  errorOnExist: true,
});
const checks = [],
  actual = [],
  requests = [];
const storage = `
function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open('binary-handoff',1);r.onupgradeneeded=()=>r.result.createObjectStore('identity');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
window.readSite=async()=>{const db=await database();const request=db.transaction('identity').objectStore('identity').get('current');const indexed=await new Promise((r,j)=>{request.onsuccess=()=>r(request.result||null);request.onerror=j;});db.close();return {local:localStorage.getItem('identity'),indexed,cookie:await(await fetch('/cookies')).text(),bridgeAbsent:typeof window.acira==='undefined'};};
`;
const server = http.createServer((request, response) => {
  requests.push({ path: request.url, cookie: request.headers.cookie || "" });
  response.setHeader("Cache-Control", "no-store");
  if (request.url.split("?")[0] === "/cookies")
    return response.end(request.headers.cookie || "");
  // This server NEVER issues or renews cookies/storage, including restored old
  // /seed URLs. Therefore a passing identity can only come from the old data.
  response.setHeader("Content-Type", "text/html");
  response.end(
    "<!doctype html><title>Engine upgrade identity probe</title><h1>Local data continuity</h1><script>" +
      storage +
      "</script>",
  );
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(Number(origin.port), "127.0.0.1", resolve);
});
const executablePath =
    process.env.ACIRA_TEST_EXECUTABLE ||
    path.join(root, ".bootstrap/electron-v44.9.3-win32-x64/electron.exe"),
  executableSha256 = createHash("sha256")
    .update(await fs.readFile(executablePath))
    .digest("hex");
let app;
await fs.writeFile(
  receipt,
  JSON.stringify(
    {
      phase: "started",
      backup,
      fixtureReport,
      executablePath,
      executableSha256,
      at: new Date().toISOString(),
    },
    null,
    2,
  ),
  { flag: "wx" },
);
async function chrome(id) {
  return poll(
    async () => {
      for (const page of app.context().pages())
        try {
          if (!page.url().startsWith("acira-browser-ui:")) continue;
          const state = await page.evaluate(() => window.acira?.getSnapshot());
          if (state && (!id || state.activeBrowserProfileId === id))
            return page;
        } catch {}
    },
    Boolean,
    "migrated native chrome",
    15000,
  );
}
const snapshot = (ui) => ui.evaluate(() => window.acira.getSnapshot());
async function launch() {
  app = await _electron.launch({
    executablePath,
    args: [path.join(root, "desktop/main.cjs")],
    env: {
      ...process.env,
      ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data,
      ACIRA_BROWSER_TEST_HIDDEN: "1",
      ACIRA_MATERIAL: "none",
    },
  });
  const runtime = await app.evaluate(({ app }) => ({
    pid: process.pid,
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    exe: app.getPath("exe"),
    userData: app.getPath("userData"),
  }));
  assert.equal(runtime.electron, process.env.ACIRA_EXPECT_ELECTRON || "44.9.3");
  assert.equal(path.resolve(runtime.userData), data);
  actual.push(runtime);
  return chrome();
}
async function choose(ui, id) {
  if ((await snapshot(ui)).activeBrowserProfileId !== id)
    await ui.evaluate(
      (id) => window.acira.dispatch({ type: "browser.profile.select", id }),
      id,
    );
  return chrome(id);
}
async function read(ui, profile, suffix) {
  const state = await snapshot(ui),
    url = origin.origin + suffix;
  await ui.evaluate(
    ({ tabId, url }) =>
      window.acira.browserCommand({ type: "navigate", tabId, url }),
    { tabId: state.activeTabId, url },
  );
  return poll(
    () =>
      app.evaluate(
        async ({ webContents, session }, { url, partition }) => {
          for (const wc of webContents.getAllWebContents())
            if (
              !wc.isDestroyed() &&
              wc.getURL() === url &&
              wc.session === session.fromPartition(partition)
            )
              try {
                return await wc.executeJavaScript(
                  'typeof window.readSite==="function"?window.readSite():null',
                );
              } catch {}
          return null;
        },
        { url, partition: profile.partition },
      ),
    Boolean,
    "old identity from native profile",
    15000,
  );
}
function signedB(value) {
  assert.equal(value.local, "handoff-b");
  assert.equal(value.indexed, "handoff-b");
  assert.match(value.cookie, /session=handoff-b/);
  assert.match(value.cookie, /persistent=handoff-b/);
  assert.doesNotMatch(value.cookie, /handoff-a/);
  assert.equal(value.bridgeAbsent, true);
}
async function hidden() {
  assert.equal(
    await app.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows().every((window) => !window.isVisible()),
    ),
    true,
  );
}
try {
  let uiA = await launch();
  uiA = await choose(uiA, profileA.id);
  const setup = await uiA.evaluate(() =>
    window.acira.setup({ type: "status" }),
  );
  assert.equal(setup.ok, true);
  assert.equal(setup.progress.complete, true);
  assert.equal(await uiA.locator(".acira-onboarding").count(), 0);
  const after = await snapshot(uiA);
  assert.deepEqual(
    after.browserProfiles.map(({ id, name, partition }) => ({
      id,
      name,
      partition,
    })),
    before.browserProfiles.map(({ id, name, partition }) => ({
      id,
      name,
      partition,
    })),
  );
  assert.equal(after.settings.appearance, "dark");
  assert.equal(after.settings.searchEngine, "duckduckgo");
  assert.equal(
    after.bookmarkNodes.some((item) => item.url === bookmark.url),
    true,
  );
  checks.push(
    "patched runtime reuses the exact old44.7portable test-data path, preserves profiles/settings/bookmark and skips completed setup",
  );
  const clearedA = await read(uiA, profileA, "/engine-upgrade-a");
  assert.equal(clearedA.local, null);
  assert.equal(clearedA.indexed, null);
  assert.equal(clearedA.cookie, "");
  let uiB = await choose(uiA, profileB.id);
  signedB(await read(uiB, profileB, "/engine-upgrade-b"));
  checks.push(
    "old protected session/persistent cookies and localStorage/IndexedDB for profileB restore on44.9.3 without any cookie-issuing endpoint; old profileA logout stays cleared",
  );
  await hidden();
  await app.close();
  app = null;
  uiA = await launch();
  uiA = await choose(uiA, profileA.id);
  assert.equal(
    (await read(uiA, profileA, "/engine-upgrade-a-restart")).cookie,
    "",
  );
  uiB = await choose(uiA, profileB.id);
  signedB(await read(uiB, profileB, "/engine-upgrade-b-restart"));
  checks.push(
    "a second actual patched-engine restart retains B and does not resurrect A after the engine migration",
  );
  await hidden();
  const result = {
    checks,
    actual,
    fixtureReport,
    oldSource: baseline.next.sourceDigest,
    oldEngine: "44.7.0 per withdrawn package/runtime provenance",
    executablePath,
    executableSha256,
    backup,
    serverNeverSetsCookies: true,
    requests,
    visibleWindows: false,
    scope:
      "Actual engine migration from existing isolated old portable data to source app44.9.3 at the same userData override; installer/natural installed-path/version migration and live Google are not claimed",
  };
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(result, null, 2),
  );
  await fs.writeFile(
    receipt,
    JSON.stringify(
      {
        phase: "completed",
        backup,
        fixtureReport,
        result: path.join(out, "result.json"),
        executablePath,
        executableSha256,
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      { checks, artifacts: out, electron: actual[0].electron },
      null,
      2,
    ),
  );
} catch (error) {
  await fs.writeFile(
    path.join(out, "partial.json"),
    JSON.stringify(
      { checks, actual, backup, requests, failure: error.message },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await app?.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
