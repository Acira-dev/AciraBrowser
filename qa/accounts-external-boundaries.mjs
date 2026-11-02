import { _electron } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { poll } from "./native-helpers.mjs";

// Native entrypoint/profile qualification only. No OS registration or user data.
const root = process.cwd(),
  run = Date.now(),
  data = path.join(root, ".qa-profiles/accounts-external-boundaries-" + run),
  out = path.join(root, "qa/artifacts/accounts-external-boundaries-" + run),
  executablePath = path.join(root, "node_modules/electron/dist/electron.exe"),
  entry = path.join(root, "desktop/main.cjs");
await fs.mkdir(data, { recursive: true });
await fs.mkdir(out, { recursive: true });
const env = {
  ...process.env,
  ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data,
  ACIRA_BROWSER_TEST_HIDDEN: "1",
  ACIRA_MATERIAL: "none",
};
const checks = [],
  visits = [],
  sourcePaths = [
    "desktop/main.cjs",
    "desktop/preload.cjs",
    "desktop/runtime.cjs",
    "desktop/accounts/external-links.cjs",
    "desktop/accounts/default-browser.cjs",
    "desktop/browser-services/session-cookie-restore.cjs",
    "dist/index.html",
  ];
async function hashes() {
  return Object.fromEntries(
    await Promise.all(
      sourcePaths.map(async (file) => [
        file,
        createHash("sha256")
          .update(await fs.readFile(path.join(root, file)))
          .digest("hex"),
      ]),
    ),
  );
}
const checkedSources = await hashes();
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://fixture");
  visits.push({ path: request.url, cookie: request.headers.cookie || "" });
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "text/html");
  const name = url.searchParams.get("identity");
  if (url.pathname === "/seed" && name)
    response.setHeader(
      "Set-Cookie",
      "identity=" +
        encodeURIComponent(name) +
        "; HttpOnly; SameSite=Lax; Path=/",
    );
  response.end(
    "<!doctype html><title>External profile boundary fixture</title><h1>Local website fixture</h1><script>window.fixtureCookies=" +
      JSON.stringify(request.headers.cookie || "") +
      ";</script>",
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
let app;
async function launch(args = []) {
  app = await _electron.launch({ executablePath, args: [entry, ...args], env });
  return chrome();
}
async function chrome({ profileId, privateMode = false } = {}) {
  return poll(
    async () => {
      for (const page of app.context().pages())
        try {
          if (!page.url().startsWith("acira-browser-ui:")) continue;
          const state = await page.evaluate(() => window.acira?.getSnapshot());
          if (!state) continue;
          const profile = state.browserProfiles.find(
            (item) => item.id === state.activeBrowserProfileId,
          );
          if (
            !!profile?.private === privateMode &&
            (!profileId || profile.id === profileId)
          )
            return page;
        } catch {}
    },
    Boolean,
    "owned ordinary/private chrome",
    15000,
  );
}
const snapshot = (ui) => ui.evaluate(() => window.acira.getSnapshot());
async function delivered(profileId, url) {
  const ui = await chrome({ profileId });
  return poll(
    async () => {
      const state = await snapshot(ui),
        profile = state.browserProfiles.find((item) => item.id === profileId);
      if (!state.tabs.some((tab) => tab.url === url)) return null;
      return app.evaluate(
        async ({ webContents, session }, { partition, url }) => {
          for (const wc of webContents.getAllWebContents())
            if (
              !wc.isDestroyed() &&
              wc.session === session.fromPartition(partition) &&
              wc.getURL() === url
            )
              try {
                return await wc.executeJavaScript(
                  'typeof window.fixtureCookies === "string" ? {cookie:window.fixtureCookies,bridgeAbsent:typeof window.acira==="undefined"} : null',
                );
              } catch {}
          return null;
        },
        { partition: profile.partition, url },
      );
    },
    Boolean,
    "external route in exact originating profile",
    15000,
  );
}
async function navigate(ui, suffix) {
  const state = await snapshot(ui),
    url = base + suffix;
  await ui.evaluate(
    ({ tabId, url }) =>
      window.acira.browserCommand({ type: "navigate", tabId, url }),
    { tabId: state.activeTabId, url },
  );
  // Includes private profiles; chrome selection below accepts their explicit id.
  await poll(
    () => snapshot(ui),
    (value) => value.tabs.some((tab) => tab.url === url && !tab.loading),
    "fixture navigation",
    15000,
  );
  return url;
}
async function secondary(args, allowEngineRejection = false) {
  const child = spawn(executablePath, [entry, ...args], {
    env,
    windowsHide: true,
    stdio: "ignore",
  });
  const exit = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve("timeout");
    }, 7000);
    child.once("error", () => {
      clearTimeout(timer);
      resolve("spawn-error");
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  if (allowEngineRejection)
    assert.equal(
      Number.isInteger(exit),
      true,
      "Owned rejected launch must terminate",
    );
  else assert.equal(exit, 0, "Owned secondary launch must exit after delivery");
  return exit;
}
try {
  let uiA = await launch();
  await uiA.getByRole("button", { name: "Skip setup", exact: true }).click();
  const profileA = (await snapshot(uiA)).activeBrowserProfileId;
  await navigate(uiA, "/seed?identity=normal-a");
  const preserved = await navigate(uiA, "/preserved");
  assert.match(
    (await delivered(profileA, preserved)).cookie,
    /identity=normal-a/,
  );
  await app.close();
  app = null;

  const cold = base + "/cold-restored?state=opaque%2Bvalue#retained";
  uiA = await launch([cold]);
  assert.match((await delivered(profileA, cold)).cookie, /identity=normal-a/);
  assert.equal(
    (await snapshot(uiA)).tabs.some((tab) => tab.url === preserved),
    true,
  );
  checks.push(
    "cold URL waits for session restore, preserves old tabs and retains query/fragment in the correct profile",
  );

  await uiA.evaluate(() =>
    window.acira.dispatch({
      type: "browser.profile.create",
      name: "Boundary B",
    }),
  );
  const profileB = (await snapshot(uiA)).browserProfiles.find(
    (profile) => profile.name === "Boundary B",
  ).id;
  await uiA.evaluate(
    (id) => window.acira.dispatch({ type: "browser.profile.select", id }),
    profileB,
  );
  let uiB = await chrome({ profileId: profileB });
  const emptyB = await navigate(uiB, "/empty-b");
  assert.equal((await delivered(profileB, emptyB)).cookie, "");
  await navigate(uiB, "/seed?identity=normal-b");

  await uiB.evaluate(() => window.acira.openWindow("private"));
  const privateUI = await chrome({ privateMode: true }),
    privateBefore = await snapshot(privateUI),
    privateProfile = privateBefore.browserProfiles.find(
      (profile) => profile.id === privateBefore.activeBrowserProfileId,
    );
  await navigate(privateUI, "/seed?identity=private-only");
  const privateTabs = (await snapshot(privateUI)).tabs.map((tab) => tab.url);
  const warm = base + "/warm-normal-b?opaque=kept#anchor";
  await secondary([warm]);
  const warmState = await delivered(profileB, warm);
  assert.match(warmState.cookie, /identity=normal-b/);
  assert.doesNotMatch(warmState.cookie, /normal-a|private-only/);
  assert.equal(warmState.bridgeAbsent, true);
  assert.deepEqual(
    (await snapshot(privateUI)).tabs.map((tab) => tab.url),
    privateTabs,
  );
  checks.push(
    "warm URL uses last normal profile B while a private window is open, with no A/private cookie or privileged bridge leakage",
  );

  const beforeUnsupported = (await snapshot(uiB)).tabs.map((tab) => tab.url);
  const unsupportedExit = await secondary(
    [
      "javascript:globalThis.unsafe=true",
      "file:///not-opened",
      "--profile=foreign",
    ],
    true,
  );
  assert.deepEqual(
    (await snapshot(uiB)).tabs.map((tab) => tab.url),
    beforeUnsupported,
  );
  assert.deepEqual(
    (await snapshot(privateUI)).tabs.map((tab) => tab.url),
    privateTabs,
  );
  checks.push(
    "unsupported arguments produce no new tab or private-session mutation, including engine-rejected launches",
  );
  await secondary([]);
  assert.deepEqual(
    (await snapshot(uiB)).tabs.map((tab) => tab.url),
    beforeUnsupported,
  );
  assert.deepEqual(
    (await snapshot(privateUI)).tabs.map((tab) => tab.url),
    privateTabs,
  );
  checks.push(
    "plain second-instance activation preserves ordinary tabs and private state",
  );

  await Promise.all([
    uiA.waitForEvent("close"),
    uiA.evaluate(() => window.acira.windowControl("close")),
  ]);
  await Promise.all([
    uiB.waitForEvent("close"),
    uiB.evaluate(() => window.acira.windowControl("close")),
  ]);
  assert.equal(privateUI.isClosed(), false);
  const privateOnly = base + "/from-private-only";
  await secondary([privateOnly]);
  uiB = await chrome({ profileId: profileB });
  const recreated = await delivered(profileB, privateOnly);
  assert.match(recreated.cookie, /identity=normal-b/);
  assert.doesNotMatch(recreated.cookie, /private-only/);
  assert.deepEqual(
    (await snapshot(privateUI)).tabs.map((tab) => tab.url),
    privateTabs,
  );
  checks.push(
    "private-only app creates a fresh normal window using the previous normal profile and leaves the private window untouched",
  );

  await Promise.all([
    privateUI.waitForEvent("close"),
    privateUI.evaluate(() => window.acira.windowControl("close")),
  ]);
  await poll(
    () =>
      app.evaluate(
        async ({ session }, partition) =>
          (await session.fromPartition(partition).cookies.get({})).length,
        privateProfile.partition,
      ),
    (length) => length === 0,
    "temporary private cookies cleared after close",
    10000,
  );
  const afterPrivateClose = await navigate(uiB, "/normal-after-private-close");
  assert.match(
    (await delivered(profileB, afterPrivateClose)).cookie,
    /identity=normal-b/,
  );
  checks.push(
    "closing private window clears its temporary cookies without deleting the normal profile's external-link session",
  );
  assert.equal(
    await app.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows().every((window) => !window.isVisible()),
    ),
    true,
  );
  assert.deepEqual(
    await hashes(),
    checkedSources,
    "Selected entrypoint sources changed during the run; qualify the coherent candidate again",
  );
  const result = {
    checks,
    checkedSources,
    selectedSourcesStable: true,
    unsupportedExit,
    visits,
    visibleWindows: false,
    osDefaultsChanged: false,
    liveProvider: false,
  };
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ checks, artifacts: out }, null, 2));
} catch (error) {
  await fs.writeFile(
    path.join(out, "partial.json"),
    JSON.stringify(
      { checks, visits, checkedSources, failure: error.message },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await app?.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
