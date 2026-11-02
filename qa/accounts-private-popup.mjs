import { _electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { poll } from "./native-helpers.mjs";

// Hold a synthetic private auth popup open. Require hidden CREATION, either the
// real main test guard or an explicitly recorded QA visibility-only wrapper.
const root = process.cwd(),
  source = await fs.readFile(path.join(root, "desktop/main.cjs"), "utf8"),
  popupSource = source
    .split("wc.setWindowOpenHandler(details=>")[1]
    ?.split("wc.on('did-create-window'")[0],
  mainCreationGuard =
    !!popupSource &&
    /show\s*:\s*process\.env\.ACIRA_BROWSER_TEST_HIDDEN\s*!==\s*['"]1['"]/.test(
      popupSource,
    ),
  useVisibilityWrapper =
    !mainCreationGuard && process.env.ACIRA_QA_POPUP_VISIBILITY_GUARD === "1";
if (!mainCreationGuard && !useVisibilityWrapper)
  throw new Error(
    "NOT RUN: isolated popup creation must specify show:false under TEST_HIDDEN before native popup QA",
  );
const run = Date.now(),
  data = path.join(root, ".qa-profiles/accounts-private-popup-" + run),
  out = path.join(root, "qa/artifacts/accounts-private-popup-" + run),
  checks = [],
  engines = [],
  sourceFiles = [
    "desktop/main.cjs",
    "desktop/preload.cjs",
    "desktop/runtime.cjs",
    "desktop/browser-services/session-cookie-restore.cjs",
    "dist/index.html",
    ...(useVisibilityWrapper
      ? ["qa/accounts-private-popup-visibility.cjs"]
      : []),
  ];
await fs.mkdir(data, { recursive: true });
await fs.mkdir(out, { recursive: true });
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
const checkedSources = await hashes();
let app, base, provider;
const storage = `
function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open('private-popup',1);r.onupgradeneeded=()=>r.result.createObjectStore('identity');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
window.fixtureReady=(async()=>{if(identity){localStorage.setItem('identity',identity);const db=await database();const tx=db.transaction('identity','readwrite');tx.objectStore('identity').put(identity,'current');await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=j;});db.close();}})();
window.readSite=async()=>{await fixtureReady;const db=await database();const request=db.transaction('identity').objectStore('identity').get('current');const indexed=await new Promise((r,j)=>{request.onsuccess=()=>r(request.result||null);request.onerror=j;});db.close();return {local:localStorage.getItem('identity'),indexed,cookie:await(await fetch('/cookies')).text(),bridgeAbsent:typeof window.acira==='undefined'};};
`;
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://fixture");
  response.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/cookies")
    return response.end(request.headers.cookie || "");
  if (url.pathname === "/provider") {
    response.setHeader(
      "Set-Cookie",
      "provider=private-fixture; HttpOnly; SameSite=Lax; Path=/",
    );
    response.writeHead(302, { Location: base + "/callback/private-popup" });
    return response.end();
  }
  const callback = url.pathname === "/callback/private-popup",
    identity = callback
      ? "private-popup"
      : url.pathname === "/seed"
        ? "normal-fixture"
        : null;
  if (identity)
    response.setHeader("Set-Cookie", [
      "session=" + identity + "; HttpOnly; SameSite=Lax; Path=/",
      "persistent=" +
        identity +
        "; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400",
    ]);
  response.setHeader("Content-Type", "text/html");
  response.end(
    '<!doctype html><title>Private popup local fixture</title><h1>Local fixture</h1><button>Open synthetic provider</button><p id="result">Waiting</p><script>const identity=' +
      JSON.stringify(identity) +
      ";" +
      storage +
      'document.querySelector("button").onclick=()=>window.open(' +
      JSON.stringify(provider + "/provider") +
      ',"private-fixture","width=480,height=520");window.addEventListener("message",event=>{if(event.origin===' +
      JSON.stringify(base) +
      '&&event.data.type==="private-fixture"){window.fixtureResult=event.data;document.querySelector("#result").textContent="Callback returned";}});' +
      (callback
        ? 'fixtureReady.then(()=>opener.postMessage({type:"private-fixture",bridgeAbsent:typeof window.acira==="undefined"},' +
          JSON.stringify(base) +
          "));"
        : "") +
      "</script>",
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
base = "http://127.0.0.1:" + server.address().port;
provider = "http://localhost:" + server.address().port;
async function chrome(privateMode = false) {
  return poll(
    async () => {
      for (const page of app.context().pages())
        try {
          if (!page.url().startsWith("acira-browser-ui:")) continue;
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
    "owned private/normal browser chrome",
    15000,
  );
}
async function launch() {
  app = await _electron.launch({
    executablePath:
      process.env.ACIRA_TEST_EXECUTABLE ||
      path.join(root, "node_modules/electron/dist/electron.exe"),
    args: [
      path.join(
        root,
        useVisibilityWrapper
          ? "qa/accounts-private-popup-visibility.cjs"
          : "desktop/main.cjs",
      ),
    ],
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
    executable: app.getPath("exe"),
  }));
  assert.equal(engine.electron, process.env.ACIRA_EXPECT_ELECTRON || "44.9.3");
  engines.push(engine);
  const ui = await chrome();
  const setup = await ui.evaluate(() => window.acira.setup({ type: "status" }));
  if (setup.progress?.complete === false)
    await ui.getByRole("button", { name: "Skip setup", exact: true }).click();
  return ui;
}
async function navigate(ui, suffix) {
  const state = await ui.evaluate(() => window.acira.getSnapshot()),
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
    async () => {
      for (const page of app.context().pages())
        try {
          if (
            page.url() !== url ||
            !(await page.evaluate(() => typeof window.readSite === "function"))
          )
            continue;
          const own = await app.evaluate(
            ({ webContents, session }, { url, partition }) =>
              webContents
                .getAllWebContents()
                .some(
                  (wc) =>
                    !wc.isDestroyed() &&
                    wc.getURL() === url &&
                    wc.session === session.fromPartition(partition),
                ),
            { url, partition: profile.partition },
          );
          if (own) {
            const partition = await page.evaluate(() => window.readSite());
            if (partition) return page;
          }
        } catch {}
    },
    Boolean,
    "site in selected browser partition",
    15000,
  );
}
async function allHidden() {
  const windows = await app.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows().map((window) => ({
      id: window.id,
      visible: window.isVisible(),
    })),
  );
  assert.equal(
    windows.every((window) => !window.visible),
    true,
    "Every native window including the held popup must remain hidden",
  );
  return windows;
}
try {
  let normalUI = await launch(),
    normal = await navigate(normalUI, "/seed");
  normal = await navigate(normalUI, "/normal");
  assert.match(
    (await normal.evaluate(() => window.readSite())).cookie,
    /session=normal-fixture/,
  );
  await normalUI.evaluate(() => window.acira.openWindow("private"));
  const privateUI = await chrome(true),
    state = await privateUI.evaluate(() => window.acira.getSnapshot()),
    privateProfile = state.browserProfiles[0];
  const privatePage = await navigate(privateUI, "/entry");
  assert.deepEqual(await privatePage.evaluate(() => window.readSite()), {
    local: null,
    indexed: null,
    cookie: "",
    bridgeAbsent: true,
  });
  checks.push(
    "private website begins with no normal cookie/localStorage/IndexedDB identity",
  );
  if (useVisibilityWrapper) {
    const guarded = await app.evaluate(
      ({ webContents, session }, { url, partition }) => {
        const contents = webContents
          .getAllWebContents()
          .find(
            (wc) =>
              !wc.isDestroyed() &&
              wc.getURL() === url &&
              wc.session === session.fromPartition(partition),
          );
        return (
          !!contents &&
          !!globalThis.accountsPrivatePopupVisibilityGuard?.wrapped.has(
            contents.id,
          )
        );
      },
      { url: base + "/entry", partition: privateProfile.partition },
    );
    assert.equal(
      guarded,
      true,
      "Creation-time visibility wrapper must be installed on the actual private opener before clicking",
    );
  }
  await privatePage
    .getByRole("button", { name: "Open synthetic provider", exact: true })
    .click();
  await privatePage.getByText("Callback returned", { exact: true }).waitFor();
  const popup = await poll(
    async () => {
      for (const page of app.context().pages())
        if (page.url() === base + "/callback/private-popup") return page;
    },
    Boolean,
    "held native provider callback",
    15000,
  );
  const signed = await privatePage.evaluate(() => window.readSite());
  assert.equal(signed.local, "private-popup");
  assert.equal(signed.indexed, "private-popup");
  assert.match(signed.cookie, /session=private-popup/);
  assert.match(signed.cookie, /persistent=private-popup/);
  assert.equal(
    await privatePage.evaluate(() => window.fixtureResult.bridgeAbsent),
    true,
  );
  const popupContext = await app.evaluate(
    ({ webContents, session }, { url, partition }) => {
      const wc = webContents
        .getAllWebContents()
        .find((wc) => !wc.isDestroyed() && wc.getURL() === url);
      return {
        same: wc?.session === session.fromPartition(partition),
        persistent: wc?.session.isPersistent(),
      };
    },
    {
      url: base + "/callback/private-popup",
      partition: privateProfile.partition,
    },
  );
  assert.deepEqual(popupContext, { same: true, persistent: false });
  const heldWindows = await allHidden();
  const visibility = useVisibilityWrapper
    ? await app.evaluate(() => ({
        kind: "QA visibility-only wrapper; product main hidden guard remains pending",
        allowed: globalThis.accountsPrivatePopupVisibilityGuard.allowed,
        refusedCustomWindow:
          globalThis.accountsPrivatePopupVisibilityGuard.refusedCustomWindow,
      }))
    : { kind: "actual main creation-time hidden guard" };
  if (useVisibilityWrapper) {
    assert.equal(visibility.allowed.length, 1);
    assert.equal(visibility.allowed[0].show, false);
    assert.equal(visibility.refusedCustomWindow, 0);
  }
  checks.push(
    "held cross-site provider popup preserves private opener/temporary partition, shares cookie/localStorage/IndexedDB and exposes no privileged bridge; every native window is hidden while it remains alive",
  );
  const normalState = await normal.evaluate(() => window.readSite());
  assert.equal(normalState.local, "normal-fixture");
  assert.equal(normalState.indexed, "normal-fixture");
  assert.doesNotMatch(normalState.cookie, /private-popup/);
  checks.push(
    "private popup sign-in does not change the normal website identity",
  );
  await Promise.all([
    privateUI.waitForEvent("close"),
    popup.waitForEvent("close"),
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
    "private popup/provider cookies cleared",
    10000,
  );
  const oldStorage = await poll(
    async () => {
      try {
        return await app.evaluate(
          async ({ WebContentsView, session }, { partition, url }) => {
            const view = new WebContentsView({
              webPreferences: {
                session: session.fromPartition(partition),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
              },
            });
            try {
              await view.webContents.loadURL(url);
              return await view.webContents.executeJavaScript(
                "window.readSite()",
              );
            } finally {
              view.webContents.close();
            }
          },
          {
            partition: privateProfile.partition,
            url: base + "/old-private-probe",
          },
        );
      } catch {
        return null;
      }
    },
    (value) =>
      !!value &&
      value.local === null &&
      value.indexed === null &&
      value.cookie === "",
    "old private popup storage cleared after asynchronous teardown",
    10000,
  );
  assert.equal(oldStorage.local, null);
  assert.equal(oldStorage.indexed, null);
  assert.equal(oldStorage.cookie, "");
  checks.push(
    "closing the private owner closes its held popup and clears the old private cookie/localStorage/IndexedDB partition",
  );
  normal = await navigate(normalUI, "/normal-after-close");
  assert.match(
    (await normal.evaluate(() => window.readSite())).cookie,
    /session=normal-fixture/,
  );
  await normalUI.evaluate(() => window.acira.openWindow("private"));
  const newPrivateUI = await chrome(true),
    newPrivatePage = await navigate(newPrivateUI, "/entry");
  const fresh = await newPrivatePage.evaluate(() => window.readSite());
  assert.equal(fresh.local, null);
  assert.equal(fresh.indexed, null);
  assert.equal(fresh.cookie, "");
  await Promise.all([
    newPrivateUI.waitForEvent("close"),
    newPrivateUI.evaluate(() => window.acira.windowControl("close")),
  ]);
  await app.close();
  app = null;
  normalUI = await launch();
  normal = await navigate(normalUI, "/normal-after-restart");
  const restored = await normal.evaluate(() => window.readSite());
  assert.equal(restored.local, "normal-fixture");
  assert.equal(restored.indexed, "normal-fixture");
  assert.match(restored.cookie, /session=normal-fixture/);
  assert.doesNotMatch(restored.cookie, /private-popup/);
  const restoredState = await normalUI.evaluate(() =>
    window.acira.getSnapshot(),
  );
  assert.equal(
    restoredState.browserProfiles.some(
      (profile) => profile.private || profile.id === privateProfile.id,
    ),
    false,
  );
  assert.equal(
    restoredState.browsingHistory.some(
      (item) =>
        item.url === base + "/entry" ||
        item.url.includes("/callback/private-popup") ||
        item.url.includes("/provider"),
    ),
    false,
  );
  checks.push(
    "fresh private partition and real app restart do not restore private popup identity/history, while normal website data and session cookie survive",
  );
  await allHidden();
  assert.deepEqual(
    await hashes(),
    checkedSources,
    "Selected sources changed during qualification; rerun coherent bytes",
  );
  const result = {
    checks,
    engines,
    visibility,
    mainCreationGuard,
    checkedSources,
    selectedSourcesStable: true,
    heldWindows,
    visibleWindows: false,
    fixtureOnly: true,
    liveGoogleAuthenticated: false,
    osDefaultsChanged: false,
  };
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ checks, artifacts: out }, null, 2));
} catch (error) {
  await fs.writeFile(
    path.join(out, "partial.json"),
    JSON.stringify({ checks, checkedSources, failure: error.message }, null, 2),
  );
  throw error;
} finally {
  await app?.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
