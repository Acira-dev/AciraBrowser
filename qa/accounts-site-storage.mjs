import { _electron } from "playwright";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { poll } from "./native-helpers.mjs";

// Real Acira main/preload/Chromium with disposable local-site identities only.
const root = process.cwd(),
  run = Date.now(),
  directory = path.join(root, ".qa-profiles", "accounts-site-storage-" + run),
  out = path.join(root, "qa/artifacts/accounts-sites-" + run);
await fs.mkdir(directory, { recursive: true });
await fs.mkdir(out, { recursive: true });
const records = [],
  identities = [];
const html = (name) =>
  '<!doctype html><title>Local sign-in compatibility fixture</title><h1 id="account">Local website fixture</h1><script>' +
  "const account=" +
  JSON.stringify(name) +
  ";" +
  'function database(){return new Promise((resolve,reject)=>{const request=indexedDB.open("site-session",1);request.onupgradeneeded=()=>request.result.createObjectStore("session");request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}' +
  'window.fixtureReady=(async()=>{if(account!==null){const db=await database(),transaction=db.transaction("session","readwrite");if(account){localStorage.setItem("identity",account);transaction.objectStore("session").put(account,"identity");}else{localStorage.removeItem("identity");transaction.objectStore("session").clear();}await new Promise((r,j)=>{transaction.oncomplete=r;transaction.onerror=j;});db.close();}document.querySelector("h1").textContent="Local website fixture ready";})();' +
  'window.readSite=async()=>{await fixtureReady;const db=await database(),request=db.transaction("session").objectStore("session").get("identity");const identity=await new Promise((r,j)=>{request.onsuccess=()=>r(request.result||null);request.onerror=j;});db.close();return{local:localStorage.getItem("identity"),indexed:identity,cookies:await(await fetch("/cookies")).text()};};</script>';
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://fixture");
  response.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/cookies") {
    response.end(request.headers.cookie || "");
    return;
  }
  response.setHeader("Content-Type", "text/html");
  if (url.pathname === "/login") {
    const name = url.searchParams.get("name") || "fixture";
    response.setHeader("Set-Cookie", [
      "persistent=" +
        encodeURIComponent(name) +
        "; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400",
      "session=" +
        encodeURIComponent(name) +
        "; HttpOnly; SameSite=Lax; Path=/",
    ]);
    response.end(html(name));
    return;
  }
  if (url.pathname === "/logout") {
    response.setHeader("Set-Cookie", [
      "persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
      "session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
    ]);
    response.end(html(""));
    return;
  }
  response.end(html(null));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
let app, firstProfile, secondProfile;
async function launch() {
  const files = [
    "desktop/main.cjs",
    "desktop/preload.cjs",
    "desktop/session-durability.cjs",
    "desktop/runtime.cjs",
  ];
  const hash = createHash("sha256");
  for (const file of files)
    hash.update(await fs.readFile(path.join(root, file)));
  identities.push({
    nativeSha256: hash.digest("hex"),
    at: new Date().toISOString(),
  });
  app = await _electron.launch({
    executablePath:
      process.env.ACIRA_TEST_EXECUTABLE ||
      path.join(root, "node_modules/electron/dist/electron.exe"),
    args: [path.join(root, "desktop/main.cjs")],
    env: {
      ...process.env,
      ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: directory,
      ACIRA_BROWSER_TEST_HIDDEN: "1",
      ACIRA_MATERIAL: "none",
    },
    timeout: 30000,
  });
  return uiFor();
}
async function uiFor(profileId, privateMode = false) {
  return poll(
    async () => {
      for (const page of app.context().pages()) {
        try {
          const value = await page.evaluate(() =>
            window.acira?.getSnapshot?.(),
          );
          if (!value) continue;
          const profile = value.browserProfiles.find(
            (item) => item.id === value.activeBrowserProfileId,
          );
          if (
            profileId
              ? value.activeBrowserProfileId === profileId
              : !!profile?.private === privateMode
          )
            return page;
        } catch {}
      }
    },
    Boolean,
    "owned profile interface",
    15000,
  );
}
const snapshot = (page) => page.evaluate(() => window.acira.getSnapshot());
async function navigate(ui, suffix) {
  const before = await snapshot(ui),
    id = before.activeTabId;
  const partition = before.browserProfiles.find(
    (profile) => profile.id === before.activeBrowserProfileId,
  ).partition;
  await ui.evaluate(
    ({ id, url }) =>
      window.acira.browserCommand({ type: "navigate", tabId: id, url }),
    { id, url: base + suffix },
  );
  return poll(
    async () => {
      const state = await snapshot(ui),
        tab = state.tabs.find((item) => item.id === id);
      const contentsId = await app.evaluate(
        async ({ webContents, session }, { partition, url }) => {
          for (const contents of webContents.getAllWebContents())
            if (
              !contents.isDestroyed() &&
              contents.session === session.fromPartition(partition) &&
              contents.getURL() === url
            ) {
              try {
                if (
                  await contents.executeJavaScript(
                    'typeof window.readSite === "function"',
                  )
                )
                  return contents.id;
              } catch {}
            }
        },
        { partition, url: base + suffix },
      );
      return contentsId ? { contentsId, tab } : null;
    },
    Boolean,
    "owned native website " + suffix,
    15000,
  );
}
async function read(ui) {
  const target = await navigate(ui, "/data");
  return app.evaluate(
    ({ webContents }, id) =>
      webContents.fromId(id).executeJavaScript("window.readSite()"),
    target.contentsId,
  );
}
async function login(ui, name) {
  const target = await navigate(ui, "/login?name=" + name);
  return app.evaluate(
    ({ webContents }, id) =>
      webContents.fromId(id).executeJavaScript("window.readSite()"),
    target.contentsId,
  );
}
async function allHidden() {
  const hidden = await app.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows().every((window) => !window.isVisible()),
  );
  assert.equal(hidden, true);
}
async function reopenProfiles() {
  const first = await launch();
  if ((await snapshot(first)).activeBrowserProfileId !== firstProfile.id)
    await first.evaluate(
      (id) => window.acira.dispatch({ type: "browser.profile.select", id }),
      firstProfile.id,
    );
  const uiA = await uiFor(firstProfile.id);
  await uiA.evaluate(
    (id) => window.acira.dispatch({ type: "browser.profile.select", id }),
    secondProfile.id,
  );
  return { uiA, uiB: await uiFor(secondProfile.id) };
}
try {
  let uiA = await launch();
  const initial = await snapshot(uiA);
  firstProfile = initial.browserProfiles.find(
    (profile) => profile.id === initial.activeBrowserProfileId,
  );
  let signed = await login(uiA, "profile-a");
  assert.equal(signed.local, "profile-a");
  assert.equal(signed.indexed, "profile-a");
  assert.match(signed.cookies, /persistent=profile-a/);
  assert.match(signed.cookies, /session=profile-a/);
  records.push({
    check: "first profile native cookie/localStorage/IndexedDB sign-in",
    passed: true,
  });
  await uiA.evaluate(() =>
    window.acira.dispatch({
      type: "browser.profile.create",
      name: "Isolated B",
    }),
  );
  secondProfile = (await snapshot(uiA)).browserProfiles.find(
    (profile) => profile.name === "Isolated B",
  );
  assert.ok(secondProfile);
  await uiA.evaluate(
    (id) => window.acira.dispatch({ type: "browser.profile.select", id }),
    secondProfile.id,
  );
  let uiB = await uiFor(secondProfile.id);
  let empty = await read(uiB);
  assert.equal(empty.local, null);
  assert.equal(empty.indexed, null);
  assert.equal(empty.cookies, "");
  records.push({
    check: "second actual local profile receives no first-profile storage",
    passed: true,
  });
  signed = await login(uiB, "profile-b");
  assert.equal(signed.indexed, "profile-b");
  assert.equal((await read(uiA)).indexed, "profile-a");
  await allHidden();
  await uiA.evaluate(() => window.acira.openWindow("private"));
  let privateUi = await uiFor(undefined, true),
    privateState = await snapshot(privateUi);
  const privateProfile = privateState.browserProfiles.find(
    (profile) => profile.id === privateState.activeBrowserProfileId,
  );
  assert.equal(privateProfile.private, true);
  const privateSigned = await login(privateUi, "private-fixture");
  assert.equal(privateSigned.indexed, "private-fixture");
  assert.match(privateSigned.cookies, /session=private-fixture/);
  await privateUi.evaluate(() => window.acira.windowControl("close"));
  await poll(
    () =>
      app.evaluate(
        async ({ session }, partition) =>
          (await session.fromPartition(partition).cookies.get({})).length,
        privateProfile.partition,
      ),
    (value) => value === 0,
    "closed private cookie store",
  );
  const oldPrivateState = await app.evaluate(
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
        await view.webContents.loadURL(url);
        return await view.webContents.executeJavaScript("window.readSite()");
      } finally {
        view.webContents.close();
      }
    },
    { partition: privateProfile.partition, url: base + "/data" },
  );
  assert.equal(oldPrivateState.local, null);
  assert.equal(oldPrivateState.indexed, null);
  assert.equal(oldPrivateState.cookies, "");
  await uiA.evaluate(() => window.acira.openWindow("private"));
  privateUi = await uiFor(undefined, true);
  const newPrivateState = await read(privateUi);
  assert.equal(newPrivateState.local, null);
  assert.equal(newPrivateState.indexed, null);
  assert.equal(newPrivateState.cookies, "");
  await privateUi.evaluate(() => window.acira.windowControl("close"));
  assert.equal((await read(uiA)).indexed, "profile-a");
  await allHidden();
  records.push({
    check:
      "last-private-window close clears cookie/localStorage/IndexedDB in old and new private partitions without touching normal profile",
    passed: true,
  });
  await app.close();
  app = null;
  ({ uiA, uiB } = await reopenProfiles());
  const restoredA = await read(uiA),
    restoredB = await read(uiB);
  assert.equal(restoredA.local, "profile-a");
  assert.equal(restoredA.indexed, "profile-a");
  assert.match(restoredA.cookies, /persistent=profile-a/);
  assert.equal(restoredB.indexed, "profile-b");
  assert.match(restoredB.cookies, /persistent=profile-b/);
  records.push({
    check:
      "clean real-app relaunch preserves per-profile persistent cookie/localStorage/IndexedDB",
    passed: true,
  });
  records.push({
    check: "session cookie restores after clean restart (REL-007)",
    passed: /session=profile-a/.test(restoredA.cookies),
    owner: "release, explicit services transfer",
  });
  // Only the disposable fixture receives a programmatic native-dialog response.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  });
  const tabA = (await snapshot(uiA)).activeTabId;
  await uiA.evaluate(
    (tabId) => window.acira.browserCommand({ type: "clear-data", tabId }),
    tabA,
  );
  await poll(
    () => read(uiA),
    (value) =>
      value.local === null && value.indexed === null && value.cookies === "",
    "clear target local profile",
  );
  assert.equal((await read(uiB)).indexed, "profile-b");
  assert.match((await read(uiB)).cookies, /persistent=profile-b/);
  records.push({
    check:
      "actual clear-data command removes target cookie/localStorage/IndexedDB only",
    passed: true,
  });
  await navigate(uiB, "/logout");
  await poll(
    () => read(uiB),
    (value) =>
      value.local === null && value.indexed === null && value.cookies === "",
    "website logout",
  );
  records.push({
    check: "ordinary website logout expires its own cookie/storage state",
    passed: true,
  });
  await app.close();
  app = null;
  ({ uiA, uiB } = await reopenProfiles());
  assert.equal((await read(uiA)).cookies, "");
  assert.equal((await read(uiB)).cookies, "");
  assert.equal((await read(uiB)).indexed, null);
  records.push({
    check: "clear/logout stay cleared after real app restart",
    passed: true,
  });
  await login(uiA, "before-crash");
  await app.evaluate(async ({ session }, partition) => {
    const store = session.fromPartition(partition);
    store.flushStorageData();
    await store.cookies.flushStore();
  }, firstProfile.partition);
  await new Promise((resolve) => setTimeout(resolve, 700));
  const ownedPid = app.process().pid;
  await promisify(execFile)(
    "taskkill",
    ["/PID", String(ownedPid), "/T", "/F"],
    { windowsHide: true },
  );
  app = null;
  ({ uiA } = await reopenProfiles());
  const recovered = await read(uiA);
  assert.equal(recovered.local, "before-crash");
  assert.equal(recovered.indexed, "before-crash");
  assert.match(recovered.cookies, /persistent=before-crash/);
  records.push({
    check:
      "crash/relaunch preserves committed native persistent cookie/localStorage/IndexedDB",
    passed: true,
  });
  records.push({
    check: "session cookie restores after crash (REL-007)",
    passed: /session=before-crash/.test(recovered.cookies),
    owner: "release",
  });
  await allHidden();
  const evidence = {
    records,
    identities,
    visibleWindows: false,
    fixtureSiteOnly: true,
    liveGoogle: "not tested; needs authorized live provider interaction",
    upgradedInstall:
      "path continuity exercised across native launches; packaged installer upgrade remains release qualification",
  };
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify({ records, artifacts: out, liveGoogle: false }, null, 2),
  );
} catch (error) {
  await fs.writeFile(
    path.join(out, "partial.json"),
    JSON.stringify(
      { records, identities, failure: error.message, liveGoogle: false },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await app?.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
