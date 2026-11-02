import { launchPreparedNative } from "./prepared-native.mjs";
import { qualifiedElectron } from "./release-runtime.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { poll } from "./native-helpers.mjs";

// Actual native UI/website/iframe/private isolation after the combined sandbox
// UI preload change. No extensions, live credentials, popups or desktop input.
const root = process.cwd(),
  run = Date.now(),
  data = path.join(root, ".qa-profiles/accounts-preload-isolation-" + run),
  out = path.join(root, "qa/artifacts/accounts-preload-isolation-" + run),
  checks = [];
await fs.mkdir(data, { recursive: true });
await fs.mkdir(out, { recursive: true });
const sourceFiles = [
  "desktop/main.cjs",
  "desktop/preload.cjs",
  "desktop/ui-preload-entry.cjs",
  "desktop/ui-preload.cjs",
  "desktop/page-input-preload.cjs",
  "desktop/browser-services/extension-toolbar-preload.cjs",
  "desktop/startup-gate.cjs",
  "desktop/browser-services/encryption-bootstrap.cjs",
  "dist/index.html",
];
const html = await fs.readFile(path.join(root, "dist/index.html"), "utf8");
for (const asset of new Set(
  html.match(/assets\/[A-Za-z0-9._-]+\.(?:js|css)/g) || [],
))
  sourceFiles.push("dist/" + asset);
async function hashes() {
  return Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (file) => [
        file,
        createHash("sha256")
          .update(await fs.readFile(path.join(root, file)))
          .digest("hex"),
      ]),
    ),
  );
}
const before = await hashes();
const runtime = await qualifiedElectron();
const probe =
  'window.probe=()=>({acira:typeof window.acira,browserAction:typeof window.browserAction,require:typeof window.require,process:typeof window.process,actionElement:!!customElements.get("browser-action-list")});';
const server = http.createServer((request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.setHeader("Cache-Control", "no-store");
  response.end(
    "<!doctype html><title>Website bridge isolation fixture</title><h1>Local website</h1><script>" +
      probe +
      "</script>" +
      (request.url === "/child"
        ? ""
        : '<iframe title="Same-origin website frame" src="/child"></iframe>'),
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
let app;
const snapshot = (ui) => ui.evaluate(() => window.acira.getSnapshot());
async function chrome(privateMode = false) {
  return poll(
    async () => {
      for (const page of app.context().pages())
        try {
          const url = new URL(page.url());
          if (
            url.protocol !== "acira-browser-ui:" ||
            url.searchParams.has("view")
          )
            continue;
          const state = await page.evaluate(() => window.acira?.getSnapshot());
          if (
            state &&
            !!state.browserProfiles.find(
              (profile) => profile.id === state.activeBrowserProfileId,
            )?.private === privateMode
          )
            return page;
        } catch {}
    },
    Boolean,
    "actual ordinary/private trusted UI",
    15000,
  );
}
async function site(ui, suffix) {
  const state = await snapshot(ui),
    profile = state.browserProfiles.find(
      (profile) => profile.id === state.activeBrowserProfileId,
    ),
    url = base + suffix;
  await ui.evaluate(
    ({ tabId, url }) =>
      window.acira.browserCommand({ type: "navigate", tabId, url }),
    { tabId: state.activeTabId, url },
  );
  return poll(
    () =>
      app.evaluate(
        async ({ webContents, session }, { url, partition }) => {
          const contents = webContents
            .getAllWebContents()
            .find(
              (wc) =>
                !wc.isDestroyed() &&
                wc.getURL() === url &&
                wc.session === session.fromPartition(partition),
            );
          if (!contents) return null;
          try {
            return await contents.executeJavaScript(
              'typeof window.probe==="function"&&typeof document.querySelector("iframe")?.contentWindow?.probe==="function"?{main:window.probe(),frame:document.querySelector("iframe").contentWindow.probe()}:null',
            );
          } catch {
            return null;
          }
        },
        { url, partition: profile.partition },
      ),
    Boolean,
    "actual website/frame probe",
    15000,
  );
}
const expected = {
  acira: "undefined",
  browserAction: "undefined",
  require: "undefined",
  process: "undefined",
  actionElement: false,
};
try {
  app = await launchPreparedNative({
    executablePath: runtime.executablePath,
    args: [path.join(root, "desktop/main.cjs")],
    env: {
      ...process.env,
      ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data,
      ACIRA_BROWSER_TEST_HIDDEN: "1",
      ACIRA_MATERIAL: "none",
    },
  });
  const engine = await app.evaluate(({ app }) => ({
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    exe: app.getPath("exe"),
    userData: app.getPath("userData"),
  }));
  assert.equal(engine.electron, "44.9.3");
  assert.equal(path.resolve(engine.userData), data);
  const ui = await chrome();
  await poll(
    () =>
      ui.evaluate(() => ({
        setup: typeof window.acira?.setup,
        actions: typeof window.browserAction?.activate,
      })),
    (value) => value.setup === "function" && value.actions === "function",
    "both APIs in trusted UI",
    10000,
  );
  const setup = await ui.evaluate(() => window.acira.setup({ type: "status" }));
  assert.equal(setup.ok, true);
  await ui.getByRole("button", { name: "Skip setup", exact: true }).click();
  checks.push(
    "trusted internal UI retains local setup and browser-action APIs through the actual bundled sandbox preload",
  );
  const ordinary = await site(ui, "/ordinary");
  assert.deepEqual(ordinary.main, expected);
  assert.deepEqual(ordinary.frame, expected);
  checks.push(
    "ordinary website and same-origin iframe receive neither setup/browser-action management bridge, Node globals nor privileged custom element",
  );
  const withdrawn = await ui.evaluate(() =>
    window.acira.setup({
      type: "auth.requestCode",
      email: "not-sent@example.test",
    }),
  );
  assert.equal(withdrawn.ok, false);
  assert.equal(withdrawn.error.code, "INVALID_REQUEST");
  checks.push(
    "withdrawn own-account commands remain rejected even though the trusted UI preload has new extension controls",
  );
  await ui.evaluate(() => window.acira.openWindow("private"));
  const privateUI = await chrome(true),
    privateState = await snapshot(privateUI);
  assert.equal(
    privateState.browserProfiles.every((profile) => profile.private === true),
    true,
  );
  const denied = await privateUI.evaluate(() =>
    window.acira.setup({ type: "status" }),
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "PRIVATE_CONTEXT");
  const normalBefore = (await snapshot(ui)).settings.appearance;
  const mutation = await privateUI.evaluate(
    (appearance) =>
      window.acira.setup({ type: "preferences", patch: { appearance } }),
    privateState.settings.appearance === "dark" ? "light" : "dark",
  );
  assert.equal(mutation.ok, false);
  assert.equal(mutation.error.code, "PRIVATE_CONTEXT");
  assert.equal(
    (await snapshot(privateUI)).settings.appearance,
    privateState.settings.appearance,
  );
  assert.equal((await snapshot(ui)).settings.appearance, normalBefore);
  const privateSite = await site(privateUI, "/private");
  assert.deepEqual(privateSite.main, expected);
  assert.deepEqual(privateSite.frame, expected);
  checks.push(
    "private UI cannot mutate/open local setup, has no normal-profile metadata, and its website/iframe receive no privileged bridge",
  );
  assert.equal(
    await app.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows().every((window) => !window.isVisible()),
    ),
    true,
  );
  assert.deepEqual(
    await hashes(),
    before,
    "Selected main/preload/generated-bundle bytes changed during test; rerun coherent source",
  );
  const result = {
    checks,
    engine,
    selectedSources: before,
    selectedSourcesStable: true,
    visibleWindows: false,
    liveGoogleAuthenticated: false,
    popupsOpened: false,
    initializedNativeKeyPrecondition: true,
    runtimeQualification: runtime.qualification,
    qualification:
      "Actual bridge isolation with native key normally initialized before this functional fixture; no bare fresh-key startup or credential-crash acceptance",
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
      { checks, selectedSources: before, failure: error.message },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await app?.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
