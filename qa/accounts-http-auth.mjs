import { _electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { poll } from "./native-helpers.mjs";

// Real main + real local HTTP challenges; the new broker is attached by QA.
// This does not claim the product's shared bridge/dialog are integrated yet.
const root = process.cwd(),
  run = Date.now();
const out = path.join(root, "qa/artifacts/accounts-http-auth-" + run);
const data = path.join(root, ".qa-profiles/accounts-http-auth-" + run);
if (
  (await fs.readFile(path.join(root, "desktop/main.cjs"), "utf8")).includes(
    "website-auth.cjs",
  )
)
  throw new Error(
    "NOT_RUN: product main owns HTTP authentication; use accounts-http-auth-integrated.mjs instead of attaching a second broker",
  );
await fs.mkdir(out, { recursive: true });
const entry = path.join(out, "entry.cjs");
await fs.writeFile(
  entry,
  "globalThis.httpAuthCreate=require(" +
    JSON.stringify(path.join(root, "desktop/website-auth.cjs")) +
    ").createWebsiteAuth;require(" +
    JSON.stringify(path.join(root, "desktop/main.cjs")) +
    ");",
);
const sourceFiles = [
  "desktop/main.cjs",
  "desktop/website-auth.cjs",
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
const before = await hashes(),
  checks = [],
  engines = [],
  traffic = [];
const secret = "only-fake-local-password-" + run;
let app;
const server = http.createServer((request, response) => {
  const route = new URL(request.url, "http://fixture").pathname;
  if (route.startsWith("/open/"))
    return response.end(
      "<!doctype html><title>Local HTTP auth fixture</title><h1>Public fixture</h1>",
    );
  const realm = route.slice(1),
    accepted =
      realm === "first" &&
      request.headers.authorization ===
        "Basic " + Buffer.from("fixture-user:" + secret).toString("base64");
  traffic.push({
    realm,
    accepted,
    authorizationPresent: !!request.headers.authorization,
  });
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "text/html");
  if (!accepted) {
    response.writeHead(401, {
      "WWW-Authenticate": 'Basic realm="' + realm + '"',
    });
    return response.end("<!doctype html><h1>Authentication required</h1>");
  }
  response.end(
    "<!doctype html><title>Authorized fixture</title><h1>Authorized " +
      realm +
      "</h1>",
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
async function uiFor(profileId, privateMode = false) {
  return poll(
    async () => {
      for (const page of app.context().pages())
        try {
          if (!page.url().startsWith("acira-browser-ui:")) continue;
          const state = await page.evaluate(() => window.acira.getSnapshot());
          const profile = state.browserProfiles.find(
            (item) => item.id === state.activeBrowserProfileId,
          );
          if (
            profileId
              ? profile.id === profileId
              : !!profile.private === privateMode
          )
            return page;
        } catch {}
    },
    Boolean,
    "HTTP auth owned chrome",
    15000,
  );
}
async function launch() {
  app = await _electron.launch({
    executablePath:
      process.env.ACIRA_TEST_EXECUTABLE ||
      path.join(root, "node_modules/electron/dist/electron.exe"),
    args: [entry],
    env: {
      ...process.env,
      ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data,
      ACIRA_BROWSER_TEST_HIDDEN: "1",
      ACIRA_MATERIAL: "none",
    },
  });
  const engine = await app.evaluate(() => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  }));
  assert.equal(engine.electron, "44.9.3");
  engines.push(engine);
  await app.evaluate(({ app }) => {
    globalThis.httpAuthOwners = new Map();
    globalThis.httpAuthStates = new Map();
    globalThis.httpAuthBroker = globalThis.httpAuthCreate({
      app,
      resolveOwner: (wc) => globalThis.httpAuthOwners.get(wc.id),
      publish: (id, state) => globalThis.httpAuthStates.set(id, state),
    });
  });
  const ui = await uiFor();
  const setup = await ui.evaluate(() => window.acira.setup({ type: "status" }));
  if (!setup.progress.complete)
    await ui.getByRole("button", { name: "Skip setup", exact: true }).click();
  return ui;
}
async function prepare(ui, ownerId) {
  const state = await ui.evaluate(() => window.acira.getSnapshot());
  const profile = state.browserProfiles.find(
    (item) => item.id === state.activeBrowserProfileId,
  );
  const url = base + "/open/" + ownerId;
  await ui.evaluate(
    ({ tabId, url }) =>
      window.acira.browserCommand({ type: "navigate", tabId, url }),
    { tabId: state.activeTabId, url },
  );
  const wcId = await poll(
    () =>
      app.evaluate(
        ({ webContents, session }, { url, partition }) =>
          webContents
            .getAllWebContents()
            .find(
              (wc) =>
                !wc.isDestroyed() &&
                wc.getURL() === url &&
                wc.session === session.fromPartition(partition),
            )?.id,
        { url, partition: profile.partition },
      ),
    Boolean,
    "HTTP owned native page",
  );
  await app.evaluate(
    ({ webContents }, owner) => {
      const wc = webContents.fromId(owner.wcId);
      globalThis.httpAuthOwners.set(wc.id, {
        id: owner.id,
        profileId: owner.profileId,
        tabId: owner.tabId,
        session: wc.session,
        privateMode: owner.privateMode,
        active: true,
      });
    },
    {
      id: ownerId,
      wcId,
      profileId: profile.id,
      tabId: state.activeTabId,
      privateMode: !!profile.private,
    },
  );
  return {
    id: ownerId,
    ui,
    wcId,
    profileId: profile.id,
    tabId: state.activeTabId,
    partition: profile.partition,
  };
}
const navigate = (owner, route) =>
  owner.ui.evaluate(
    ({ tabId, url }) =>
      window.acira.browserCommand({ type: "navigate", tabId, url }),
    { tabId: owner.tabId, url: base + "/" + route },
  );
const pending = (owner) =>
  app.evaluate(
    (_electron, id) => globalThis.httpAuthBroker.snapshot(id),
    owner.id,
  );
const challenge = (owner) =>
  poll(
    () => pending(owner),
    (value) => value.requests.length > 0,
    "real pending native HTTP challenge",
  ).then((value) => value.requests[0]);
const respond = (owner, request, credentials = null) =>
  app.evaluate(
    (_electron, { ownerId, response }) =>
      globalThis.httpAuthBroker.respond(ownerId, response),
    {
      ownerId: owner.id,
      response: {
        id: request.id,
        action: credentials ? "submit" : "cancel",
        ...(credentials || {}),
      },
    },
  );
const accepted = (owner, realm) =>
  poll(
    () =>
      app.evaluate(
        ({ webContents }, id) => webContents.fromId(id)?.getTitle(),
        owner.wcId,
      ),
    (title) => title === "Authorized fixture",
    "accepted HTTP page",
  );
try {
  let uiA = await launch(),
    a = await prepare(uiA, "a");
  await navigate(a, "first");
  const first = await challenge(a);
  assert.equal(first.origin, base);
  assert.equal(first.scheme, "basic");
  assert.equal(first.realm, "first");
  assert.equal(
    (await respond(a, first, { username: "wrong", password: "wrong" })).ok,
    true,
  );
  const retry = await challenge(a);
  assert.equal(retry.retry, true);
  assert.notEqual(retry.id, first.id);
  await respond(a, retry, { username: "fixture-user", password: secret });
  await accepted(a, "first");
  checks.push(
    "actual Basic callback: wrong credentials produce explicit new retry; correct response authenticates the native website",
  );
  await navigate(a, "cancel");
  const cancel = await challenge(a);
  await respond(a, cancel);
  assert.equal(
    (await respond(a, cancel, { username: "fixture-user", password: secret }))
      .ok,
    false,
  );
  assert.equal(
    traffic.some((item) => item.realm === "cancel" && item.accepted),
    false,
  );
  checks.push(
    "Cancel consumes native challenge once; stale submit cannot authenticate it",
  );
  await uiA.evaluate(() =>
    window.acira.dispatch({
      type: "browser.profile.create",
      name: "HTTP fixture B",
    }),
  );
  const stateA = await uiA.evaluate(() => window.acira.getSnapshot()),
    profileB = stateA.browserProfiles.find(
      (item) => item.id !== a.profileId && !item.private,
    );
  await uiA.evaluate(
    (id) => window.acira.dispatch({ type: "browser.profile.select", id }),
    profileB.id,
  );
  const uiB = await uiFor(profileB.id),
    b = await prepare(uiB, "b");
  await uiA.evaluate(() => window.acira.openWindow("private"));
  const privateUI = await uiFor(undefined, true),
    p = await prepare(privateUI, "private");
  await navigate(b, "first");
  await navigate(p, "first");
  const br = await challenge(b),
    pr = await challenge(p);
  assert.equal(br.privateMode, false);
  assert.equal(pr.privateMode, true);
  assert.notEqual(br.profileId, pr.profileId);
  assert.notEqual(br.id, pr.id);
  assert.equal(
    (await respond(b, pr, { username: "fixture-user", password: secret })).ok,
    false,
  );
  assert.equal((await pending(p)).requests.length, 1);
  await respond(b, br, { username: "fixture-user", password: secret });
  await accepted(b, "first");
  assert.equal((await pending(p)).requests.length, 1);
  await respond(p, pr, { username: "fixture-user", password: secret });
  await accepted(p, "first");
  checks.push(
    "simultaneous actual B/private challenges stay separate; neither receives A cached credentials or another controller response",
  );
  const privateCacheCleared = await app.evaluate(
    async (_electron, id) => globalThis.httpAuthBroker.cancelOwner(id),
    p.id,
  );
  assert.equal(privateCacheCleared, true);
  await Promise.all([
    privateUI.waitForEvent("close"),
    privateUI.evaluate(() => window.acira.windowControl("close")),
  ]);
  const beforePrivateProbe = traffic.filter((item) => item.accepted).length;
  await app.evaluate(
    async ({ WebContentsView, session }, { partition, url }) => {
      const view = new WebContentsView({
        webPreferences: {
          session: session.fromPartition(partition),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      try {
        await view.webContents.loadURL(url).catch(() => {});
      } finally {
        view.webContents.close();
      }
    },
    { partition: p.partition, url: base + "/first" },
  );
  assert.equal(
    traffic.filter((item) => item.accepted).length,
    beforePrivateProbe,
  );
  checks.push(
    "private closure clears native HTTP-auth cache; probing its old session does not reuse accepted credentials",
  );
  await navigate(b, "navigation");
  const stale = await challenge(b);
  await navigate(b, "open/changed");
  await poll(
    () => pending(b),
    (state) => state.requests.length === 0,
    "native navigation cancels auth",
  );
  assert.equal(
    (await respond(b, stale, { username: "fixture-user", password: secret }))
      .ok,
    false,
  );
  await navigate(a, "close");
  const closing = await challenge(a);
  await Promise.all([
    uiA.waitForEvent("close"),
    uiA.evaluate(() => window.acira.windowControl("close")),
  ]);
  assert.equal(
    (await respond(a, closing, { username: "fixture-user", password: secret }))
      .ok,
    false,
  );
  checks.push(
    "actual navigation and owner-window close cancel pending callbacks and reject stale credentials",
  );
  const metadata = await app.evaluate(() => [
    ...globalThis.httpAuthStates.values(),
  ]);
  assert.equal(JSON.stringify(metadata).includes(secret), false);
  assert.equal(
    JSON.stringify(
      await uiB.evaluate(() => window.acira.getSnapshot()),
    ).includes(secret),
    false,
  );
  const bProfile = b.profileId;
  await app.close();
  app = null;
  uiA = await launch();
  await uiA.evaluate(
    (id) => window.acira.dispatch({ type: "browser.profile.select", id }),
    bProfile,
  );
  const restoredB = await prepare(await uiFor(bProfile), "restored-b");
  await navigate(restoredB, "first");
  const afterRestart = await challenge(restoredB);
  await respond(restoredB, afterRestart);
  checks.push(
    "actual app restart at the same disposable userData does not restore native HTTP credentials; no credential persistence added",
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
          bytes.includes(Buffer.from(secret)),
          false,
          "Credential is absent from persisted fixture bytes",
        );
        assert.equal(
          bytes.includes(Buffer.from(secret, "utf16le")),
          false,
          "Credential is absent from UTF16 fixture bytes",
        );
      }
    }
  }
  await scan(data);
  checks.push(
    "challenge/trusted browser snapshots and all bounded persisted fixture files contain no submitted password",
  );
  assert.deepEqual(await hashes(), before);
  const result = {
    checks,
    engines,
    traffic,
    scannedFiles,
    selectedSources: before,
    selectedSourcesStable: true,
    fixtureOnly: true,
    credentialsLogged: false,
    visibleWindows: false,
    integration:
      "QA-only broker attachment to actual current main; shared product IPC/dialog integration still pending",
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
