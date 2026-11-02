import { launchPreparedNative } from "./prepared-native.mjs";
import { qualifiedElectron } from "./release-runtime.mjs";
import { completeLocalSetup } from "./release-local-setup.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { poll } from "./native-helpers.mjs";

// Actual product main/IPC/UI only. No broker attachment or auth-dialog fixture.
const root = process.cwd(),
  run = Date.now();
const out = path.join(
  root,
  "qa/artifacts/accounts-http-auth-integrated-" + run,
);
const data = path.join(
  root,
  ".qa-profiles/accounts-http-auth-integrated-" + run,
);
const main = await fs.readFile(path.join(root, "desktop/main.cjs"), "utf8");
const preload = await fs.readFile(
  path.join(root, "desktop/preload.cjs"),
  "utf8",
);
const source = await fs.readFile(path.join(root, "src/App.tsx"), "utf8");
const sourceHooks =
  main.includes("website-auth.cjs") &&
  preload.includes("websiteAuth") &&
  source.includes("WebsiteAuthDialog");
let coherentBundle = false;
if (sourceHooks) {
  try {
    const builtPreload = await fs.readFile(
        path.join(root, "desktop/ui-preload.cjs"),
        "utf8",
      ),
      builtHTML = await fs.readFile(path.join(root, "dist/index.html"), "utf8"),
      scripts = [
        ...new Set(builtHTML.match(/assets\/[A-Za-z0-9._-]+\.js/g) || []),
      ],
      bundles = await Promise.all(
        scripts.map((file) =>
          fs.readFile(path.join(root, "dist", file), "utf8"),
        ),
      );
    coherentBundle =
      builtPreload.includes("websiteAuth") &&
      bundles.some(
        (bundle) =>
          bundle.includes("Sign in to this site") &&
          bundle.includes("websiteAuth"),
      );
  } catch {}
}
if (!sourceHooks || !coherentBundle) {
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        status: "NOT_RUN",
        nativeLaunches: 0,
        reason: sourceHooks
          ? "Auth source hooks exist but actual generated preload/renderer bundle is not coherent yet"
          : "Actual main/preload/App HTTP-auth integration is not present",
        qaBrokerAttached: false,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ status: "NOT_RUN", nativeLaunches: 0, artifacts: out }),
  );
  process.exit(2);
}
await fs.mkdir(out, { recursive: true });
const sourceFiles = [
  "desktop/main.cjs",
  "desktop/preload.cjs",
  "desktop/ui-preload.cjs",
  "desktop/website-auth.cjs",
  "desktop/website-auth-integration.cjs",
  "desktop/runtime.cjs",
  "desktop/startup-gate.cjs",
  "src/App.tsx",
  "src/ui/websiteAuthClient.ts",
  "src/features/WebsiteAuthDialog.tsx",
  "src/features/website-auth.css",
  "dist/index.html",
];
const html = await fs.readFile(path.join(root, "dist/index.html"), "utf8");
for (const asset of new Set(
  html.match(/assets\/[A-Za-z0-9._-]+\.(?:js|css)/g) || [],
))
  sourceFiles.push("dist/" + asset);
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
const before = await hashes(),
  checks = [],
  engines = [],
  traffic = [];
const password = "only-integrated-fixture-" + run;
let app;
const runtime = await qualifiedElectron();
const server = http.createServer((request, response) => {
  const route = new URL(request.url, "http://fixture").pathname;
  if (route === "/favicon.ico") {
    response.writeHead(204);
    return response.end();
  }
  if (route.startsWith("/open/"))
    return response.end(
      "<!doctype html><title>Public fixture</title><h1>Public HTTP fixture</h1><iframe src='/frame'></iframe>",
    );
  if (route === "/frame")
    return response.end(
      "<!doctype html><title>Unprivileged frame</title><h1>Unprivileged frame</h1>",
    );
  const realm = route.slice(1),
    accepted =
      realm === "protected" &&
      request.headers.authorization ===
        "Basic " + Buffer.from("fixture-user:" + password).toString("base64");
  traffic.push({
    realm,
    authorizationPresent: !!request.headers.authorization,
    accepted,
  });
  response.setHeader("Content-Type", "text/html");
  response.setHeader("Cache-Control", "no-store");
  if (!accepted) {
    response.writeHead(401, {
      "WWW-Authenticate": 'Basic realm="' + realm + '"',
    });
    return response.end("<!doctype html><h1>HTTP authentication required</h1>");
  }
  response.end(
    "<!doctype html><title>Authorized fixture</title><h1>Authorized HTTP fixture</h1>",
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
async function uiFor(profileId, privateMode = false) {
  return poll(
    async () => {
      for (const page of app.context().pages())
        try {
          if (page.url() !== "acira-browser-ui://ui/index.html") continue;
          const state = await page.evaluate(() => window.acira?.getSnapshot());
          const profile = state?.browserProfiles.find(
            (profile) => profile.id === state.activeBrowserProfileId,
          );
          if (
            profile &&
            (profileId
              ? profile.id === profileId
              : !!profile.private === privateMode)
          )
            return page;
        } catch {}
    },
    Boolean,
    "HTTP-auth actual owning chrome",
    15000,
  );
}
async function launch() {
  // UI/lifecycle fixture explicitly starts with a normally persisted native key.
  // Bare fresh startup and first-credential crash are separately qualified.
  app = await launchPreparedNative({
    executablePath: runtime.executablePath,
    args: [path.join(root, "desktop/main.cjs")],
    env: {
      ...process.env,
      ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data,
      ACIRA_BROWSER_TEST_HIDDEN: "1",
      ACIRA_MATERIAL: "none",
      LOCALAPPDATA: path.join(data, "empty-import-sources"),
    },
  });
  const actual = await app.evaluate(() => ({
    electron: process.versions.electron,
    chromium: process.versions.chrome,
  }));
  assert.equal(actual.electron, "44.9.3");
  assert.equal(await app.evaluate(({ app }) => app.listenerCount("login")), 1);
  engines.push(actual);
  const ui = await uiFor();
  assert.equal(
    await ui.evaluate(() => typeof window.acira.websiteAuth),
    "function",
  );
  await completeLocalSetup(ui);
  return ui;
}
async function prepare(ui, label) {
  const state = await ui.evaluate(() => window.acira.getSnapshot()),
    profile = state.browserProfiles.find(
      (profile) => profile.id === state.activeBrowserProfileId,
    );
  const owner = {
    ui,
    profileId: profile.id,
    tabId: state.activeTabId,
    partition: profile.partition,
  };
  await navigate(owner, "open/" + label);
  owner.wcId = await poll(
    () =>
      app.evaluate(
        ({ webContents, session }, { partition, url }) =>
          webContents
            .getAllWebContents()
            .find(
              (wc) =>
                !wc.isDestroyed() &&
                wc.session === session.fromPartition(partition) &&
                wc.getURL() === url,
            )?.id,
        { partition: profile.partition, url: base + "/open/" + label },
      ),
    Boolean,
    "actual owned website",
  );
  return owner;
}
const navigate = (owner, route) =>
  owner.ui.evaluate(
    ({ tabId, url }) =>
      window.acira.browserCommand({ type: "navigate", tabId, url }),
    { tabId: owner.tabId, url: base + "/" + route },
  );
const request = (owner) =>
  poll(
    () =>
      owner.ui.evaluate(() => window.acira.websiteAuth({ type: "snapshot" })),
    (state) => state.requests.length > 0,
    "actual trusted auth bridge challenge",
  ).then((state) => state.requests[0]);
async function form(owner) {
  const dialog = owner.ui.getByRole("dialog", {
    name: "Sign in to this site",
    exact: true,
  });
  await dialog.waitFor();
  return dialog;
}
async function submit(owner, secret) {
  await form(owner);
  await owner.ui.getByLabel("Username", { exact: true }).fill("fixture-user");
  await owner.ui.getByLabel("Password", { exact: true }).fill(secret);
  await owner.ui.getByLabel("Password", { exact: true }).press("Enter");
}
async function views(owner) {
  return app.evaluate(({ BaseWindow }, wcId) => {
    for (const window of BaseWindow.getAllWindows())
      for (const view of window.contentView.children)
        if (view.webContents?.id === wcId)
          return { visible: view.getVisible(), bounds: view.getBounds() };
    return null;
  }, owner.wcId);
}
try {
  const uiA = await launch();
  await app.evaluate(({ app }) => {
    app.once("before-quit", (event) => event.preventDefault());
    app.quit();
  });
  assert.equal(await app.evaluate(({ app }) => app.listenerCount("login")), 1);
  assert.ok(
    (await uiA.evaluate(() => window.acira.getSnapshot())).tabs.length > 0,
  );
  checks.push(
    "actual product retains its single auth dispatcher and live chrome after a cancelled Quit",
  );
  const a = await prepare(uiA, "a");
  const site = await poll(
    () =>
      app
        .context()
        .pages()
        .find((page) => page.url() === base + "/open/a"),
    Boolean,
    "actual website target attaches to the native debugger",
  );
  assert.equal(await site.evaluate(() => typeof window.acira), "undefined");
  await site
    .frameLocator("iframe")
    .getByRole("heading", { name: "Unprivileged frame", exact: true })
    .waitFor();
  assert.equal(
    await site
      .frameLocator("iframe")
      .locator("body")
      .evaluate(() => typeof window.acira),
    "undefined",
  );
  checks.push("ordinary website and its iframe receive no trusted auth bridge");
  await navigate(a, "protected");
  const first = await request(a);
  assert.equal(first.origin, base);
  assert.equal(first.profileId, a.profileId);
  assert.equal(first.tabId, a.tabId);
  const activeForm = await form(a);
  for (let index = 0; index < 8; index++) {
    await uiA.keyboard.press(index < 4 ? "Tab" : "Shift+Tab");
    assert.equal(
      await activeForm.evaluate((panel) =>
        panel.contains(document.activeElement),
      ),
      true,
    );
  }
  for (const overlay of app
    .context()
    .pages()
    .filter(
      (page) =>
        page.url().startsWith("acira-browser-ui:") &&
        page.url() !== "acira-browser-ui://ui/index.html",
    )) {
    const denied = await overlay.evaluate(async () => {
      if (!window.acira?.websiteAuth) return true;
      try {
        await window.acira.websiteAuth({ type: "snapshot" });
        return false;
      } catch {
        return true;
      }
    });
    assert.equal(
      denied,
      true,
      "Unrelated internal overlays cannot read auth challenges",
    );
  }
  assert.equal(JSON.stringify(first).includes(password), false);
  await uiA.getByText(base, { exact: true }).waitFor();
  await poll(
    () => views(a),
    (value) => value?.visible === false,
    "native website view hidden behind auth dialog",
  );
  await submit(a, "wrong-fixture-password");
  const retry = await poll(
    () => uiA.evaluate(() => window.acira.websiteAuth({ type: "snapshot" })),
    (state) => state.requests.some((request) => request.retry),
    "wrong-password retry metadata",
  );
  assert.notEqual(retry.requests[0].id, first.id);
  await uiA.getByRole("alert").filter({ hasText: "did not accept" }).waitFor();
  assert.equal(
    await uiA.getByLabel("Password", { exact: true }).inputValue(),
    "",
  );
  await submit(a, password);
  await uiA
    .getByRole("dialog", { name: "Sign in to this site", exact: true })
    .waitFor({ state: "detached" });
  await poll(
    () =>
      app.evaluate(
        ({ webContents }, id) => webContents.fromId(id)?.getTitle(),
        a.wcId,
      ),
    (title) => title === "Authorized fixture",
    "real HTTP success through product dialog",
  );
  await poll(
    () => views(a),
    (value) => value?.visible === true,
    "native website returns after auth completion",
  );
  checks.push(
    "real main bridge/dialog traps keyboard focus, denies overlay access, hides native page, shows origin and explicit wrong retry, clears secret and authenticates on Enter before restoring page",
  );
  await navigate(a, "cancel");
  const cancelled = await request(a);
  await form(a);
  await uiA.getByLabel("Username", { exact: true }).press("Escape");
  await poll(
    () => uiA.evaluate(() => window.acira.websiteAuth({ type: "snapshot" })),
    (state) => state.requests.length === 0,
    "Escape consumes native challenge",
  );
  const stale = await uiA.evaluate(
    (response) => window.acira.websiteAuth({ type: "respond", response }),
    { id: cancelled.id, action: "submit", username: "fixture-user", password },
  );
  assert.equal(stale.ok, false);
  assert.equal(
    traffic.some((item) => item.realm === "cancel" && item.accepted),
    false,
  );
  checks.push(
    "Escape cancels the real request; stale trusted response cannot authenticate it",
  );
  await uiA.evaluate(() =>
    window.acira.dispatch({
      type: "browser.profile.create",
      name: "HTTP integration B",
    }),
  );
  const state = await uiA.evaluate(() => window.acira.getSnapshot()),
    bProfile = state.browserProfiles.find(
      (profile) => profile.id !== a.profileId && !profile.private,
    );
  await uiA.evaluate(
    (id) => window.acira.dispatch({ type: "browser.profile.select", id }),
    bProfile.id,
  );
  const b = await prepare(await uiFor(bProfile.id), "b");
  await uiA.evaluate(() => window.acira.openWindow("private"));
  const p = await prepare(await uiFor(undefined, true), "private");
  await navigate(b, "protected");
  await navigate(p, "protected");
  const br = await request(b),
    pr = await request(p);
  assert.equal(pr.privateMode, true);
  assert.equal(br.privateMode, false);
  assert.notEqual(br.id, pr.id);
  assert.equal(
    (
      await b.ui.evaluate(
        (response) => window.acira.websiteAuth({ type: "respond", response }),
        { id: pr.id, action: "submit", username: "fixture-user", password },
      )
    ).ok,
    false,
  );
  await submit(b, password);
  assert.equal(
    (await p.ui.evaluate(() => window.acira.websiteAuth({ type: "snapshot" })))
      .requests.length,
    1,
  );
  await submit(p, password);
  await p.ui
    .getByRole("dialog", { name: "Sign in to this site", exact: true })
    .waitFor({ state: "detached" });
  await poll(
    () =>
      app.evaluate(
        ({ webContents }, id) => webContents.fromId(id)?.getTitle(),
        p.wcId,
      ),
    (title) => title === "Authorized fixture",
    "private native HTTP authentication succeeds before closure",
  );
  await Promise.all([
    p.ui.waitForEvent("close"),
    p.ui.evaluate(() => window.acira.windowControl("close")),
  ]);
  const acceptedBefore = traffic.filter((item) => item.accepted).length;
  const trafficBefore = traffic.length;
  const retiredProbe = await app.evaluate(
    async ({ session }, { partition, url }) => {
      const nativeSession = session.fromPartition(partition),
        sealed =
          nativeSession[Symbol.for("acira.native.request-network-state-v1")]
            ?.retired === true;
      let blocked = false;
      try {
        await nativeSession.fetch(url, { cache: "no-store" });
      } catch {
        blocked = true;
      }
      return { sealed, blocked };
    },
    { partition: p.partition, url: base + "/protected" },
  );
  assert.deepEqual(retiredProbe, { sealed: true, blocked: true });
  assert.equal(
    traffic.length,
    trafficBefore,
    "The retired partition must issue no HTTP request, including cached authentication",
  );
  assert.equal(traffic.filter((item) => item.accepted).length, acceptedBefore);
  assert.equal(
    (await b.ui.evaluate(() => window.acira.websiteAuth({ type: "snapshot" })))
      .requests.length,
    0,
    "A sealed old-session probe must not prompt another controller",
  );
  await b.ui.evaluate(() => window.acira.openWindow("private"));
  const freshPrivate = await prepare(
    await uiFor(undefined, true),
    "fresh-private",
  );
  assert.notEqual(freshPrivate.partition, p.partition);
  const freshTrafficStart = traffic.length;
  await navigate(freshPrivate, "protected");
  const freshChallenge = await request(freshPrivate);
  assert.equal(freshChallenge.privateMode, true);
  assert.notEqual(freshChallenge.id, pr.id);
  const freshTraffic = traffic.slice(freshTrafficStart);
  assert.ok(
    freshTraffic.some(
      (item) =>
        item.realm === "protected" &&
        !item.authorizationPresent &&
        !item.accepted,
    ),
    "Fresh private partition must actually reach the native401 without inherited credentials",
  );
  assert.equal(traffic.filter((item) => item.accepted).length, acceptedBefore);
  await form(freshPrivate);
  await freshPrivate.ui.getByLabel("Username", { exact: true }).press("Escape");
  await freshPrivate.ui
    .getByRole("dialog", { name: "Sign in to this site", exact: true })
    .waitFor({ state: "detached" });
  await Promise.all([
    freshPrivate.ui.waitForEvent("close"),
    freshPrivate.ui.evaluate(() => window.acira.windowControl("close")),
  ]);
  checks.push(
    "actual normal/private dialogs stay owner-isolated; the retired partition blocks all HTTP and a fresh private partition reaches401 without inherited credentials",
  );
  await navigate(b, "navigation");
  const pendingNav = await request(b);
  await form(b);
  await navigate(b, "open/changed");
  await poll(
    () => b.ui.evaluate(() => window.acira.websiteAuth({ type: "snapshot" })),
    (state) => state.requests.length === 0,
    "navigation cancels product dialog",
  );
  assert.equal(
    (
      await b.ui.evaluate(
        (response) => window.acira.websiteAuth({ type: "respond", response }),
        {
          id: pendingNav.id,
          action: "submit",
          username: "fixture-user",
          password,
        },
      )
    ).ok,
    false,
  );
  assert.equal(
    JSON.stringify(
      await b.ui.evaluate(() => window.acira.getSnapshot()),
    ).includes(password),
    false,
  );
  checks.push(
    "actual navigation removes the dialog and rejects old secrets; ordinary persisted browser snapshot excludes credentials",
  );
  assert.equal(
    await app.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows().some((window) => window.isVisible()),
    ),
    false,
  );
  await app.close();
  app = null;
  let scannedFiles = 0;
  async function scan(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      assert.equal(entry.isSymbolicLink(), false);
      if (entry.isDirectory()) await scan(file);
      else if (entry.isFile()) {
        const stat = await fs.stat(file);
        assert.ok(stat.size <= 64 * 1024 * 1024, "Bounded fixture file scan");
        const bytes = await fs.readFile(file);
        scannedFiles++;
        assert.equal(
          bytes.includes(Buffer.from(password)),
          false,
          "Submitted fixture secret absent from persisted UTF8 bytes",
        );
        assert.equal(
          bytes.includes(Buffer.from(password, "utf16le")),
          false,
          "Submitted fixture secret absent from persisted UTF16 bytes",
        );
      }
    }
  }
  await scan(data);
  checks.push(
    "all bounded post-shutdown profile files exclude the submitted fixture password in UTF8 and UTF16",
  );
  const restarted = await launch(),
    restartOwner = await prepare(restarted, "restart");
  await navigate(restartOwner, "protected");
  const restartRequest = await request(restartOwner);
  assert.equal(restartRequest.origin, base);
  await form(restartOwner);
  await restarted.getByRole("button", { name: "Cancel", exact: true }).click();
  await poll(
    () =>
      restarted.evaluate(() => window.acira.websiteAuth({ type: "snapshot" })),
    (value) => value.requests.length === 0,
    "actual restart requires fresh HTTP authentication and accepts cancellation",
  );
  checks.push(
    "actual app restart does not recover in-memory HTTP Basic credentials and prompts through the product dialog again",
  );
  assert.deepEqual(await hashes(), before);
  const result = {
    status: "PASS",
    checks,
    engines,
    scannedFiles,
    traffic,
    selectedSources: before,
    selectedSourcesStable: true,
    qaBrokerAttached: false,
    realMainPreloadDialog: true,
    fixtureOnly: true,
    initializedNativeKeyPrecondition: true,
    runtimeQualification: runtime.qualification,
    visibleWindows: false,
    scope:
      "Actual working product main/IPC/form with explicitly initialized native key; no fresh-key/crash, real router/provider credential or immutable-package claim",
  };
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ checks, artifacts: out }, null, 2));
} catch (error) {
  await fs.writeFile(
    path.join(out, "partial.json"),
    JSON.stringify({ checks, traffic, failure: error.message }, null, 2),
  );
  throw error;
} finally {
  await app?.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
