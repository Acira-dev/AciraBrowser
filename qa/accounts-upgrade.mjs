import { _electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { poll } from "./native-helpers.mjs";
import { initializeReleaseProfile } from "./release-initialize-profile.mjs";
import {
  selectQualifiedPackages,
  launchQualifiedPackage,
} from "./accounts-qualified-packages.mjs";

// Two real portable binaries, one explicitly disposable app-data path. This is
// a binary handoff, not a claim about installer or version migration behavior.
const root = process.cwd(),
  { candidates, rejected } = await selectQualifiedPackages({ root });
if (candidates.length !== 2) {
  const preflight = {
    status: "NOT_RUN",
    reason:
      "Fewer than two packages match the current qualified runtime and withdrawal/payload policy",
    eligible: candidates.map(({ sourceDigest, report }) => ({
      sourceDigest,
      report,
    })),
    rejected,
    nativeLaunches: 0,
  };
  const report = path.join(
    root,
    "qa/artifacts/accounts-upgrade-preflight-" + Date.now() + ".json",
  );
  await fs.writeFile(report, JSON.stringify(preflight, null, 2));
  console.log(JSON.stringify({ ...preflight, report }, null, 2));
  process.exitCode = 2;
} else {
  const [next, previous] = candidates;
  assert.notEqual(next.sourceDigest, previous.sourceDigest);
  const run = Date.now(),
    data = path.join(root, ".qa-profiles/accounts-upgrade-" + run),
    out = path.join(root, "qa/artifacts/accounts-upgrade-" + run),
    checks = [],
    actual = [];
  await fs.mkdir(data, { recursive: true });
  await fs.mkdir(out, { recursive: true });
  let app;
  const storage = `
function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open('binary-handoff',1);r.onupgradeneeded=()=>r.result.createObjectStore('identity');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
window.fixtureReady=(async()=>{if(identity!==null){if(identity)localStorage.setItem('identity',identity);else localStorage.removeItem('identity');const db=await database();const tx=db.transaction('identity','readwrite');if(identity)tx.objectStore('identity').put(identity,'current');else tx.objectStore('identity').clear();await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=j;});db.close();}})();
window.readSite=async()=>{await fixtureReady;const db=await database();const request=db.transaction('identity').objectStore('identity').get('current');const indexed=await new Promise((r,j)=>{request.onsuccess=()=>r(request.result||null);request.onerror=j;});db.close();return {local:localStorage.getItem('identity'),indexed,cookie:await(await fetch('/cookies')).text(),bridgeAbsent:typeof window.acira==='undefined'};};
`;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://fixture");
    response.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/cookies")
      return response.end(request.headers.cookie || "");
    const identity =
      url.pathname === "/seed"
        ? url.searchParams.get("identity")
        : url.pathname === "/logout"
          ? ""
          : null;
    if (identity !== null)
      response.setHeader("Set-Cookie", [
        "session=" +
          encodeURIComponent(identity) +
          "; HttpOnly; SameSite=Lax; Path=/" +
          (identity ? "" : "; Max-Age=0"),
        "persistent=" +
          encodeURIComponent(identity) +
          "; HttpOnly; SameSite=Lax; Path=/; Max-Age=" +
          (identity ? 86400 : 0),
      ]);
    response.setHeader("Content-Type", "text/html");
    response.end(
      "<!doctype html><title>Binary handoff fixture</title><h1>Local identity fixture</h1><script>const identity=" +
        JSON.stringify(identity) +
        ";" +
        storage +
        "</script>",
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  const snapshot = (ui) => ui.evaluate(() => window.acira.getSnapshot());
  async function chrome(profileId) {
    return poll(
      async () => {
        for (const page of app.context().pages())
          try {
            if (!page.url().startsWith("acira-browser-ui:")) continue;
            const value = await page.evaluate(() =>
              window.acira?.getSnapshot(),
            );
            if (
              value &&
              (!profileId || value.activeBrowserProfileId === profileId)
            )
              return page;
          } catch {}
      },
      Boolean,
      "packaged profile chrome",
      15000,
    );
  }
  async function launch(candidate) {
    const profileInitialization = await launchQualifiedPackage({
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
          ACIRA_MATERIAL: "none",
        },
      },
    });
    const observed = await app.evaluate(({ app }) => ({
      packaged: app.isPackaged,
      version: app.getVersion(),
      exe: app.getPath("exe"),
      appPath: app.getAppPath(),
      userData: app.getPath("userData"),
    }));
    observed.profileInitialization = profileInitialization;
    assert.equal(observed.packaged, true);
    assert.equal(
      path.resolve(observed.exe).toLowerCase(),
      candidate.executable.toLowerCase(),
    );
    assert.equal(path.resolve(observed.userData), data);
    assert.equal(
      path
        .resolve(observed.appPath)
        .toLowerCase()
        .startsWith(
          path.dirname(candidate.executable).toLowerCase() + path.sep,
        ),
      true,
    );
    actual.push({
      ...observed,
      sourceDigest: candidate.sourceDigest,
      report: candidate.report,
      executableSha256: createHash("sha256")
        .update(await fs.readFile(candidate.executable))
        .digest("hex"),
    });
    return chrome();
  }
  async function hidden() {
    assert.equal(
      await app.evaluate(({ BaseWindow }) =>
        BaseWindow.getAllWindows().every((window) => !window.isVisible()),
      ),
      true,
    );
  }
  async function visit(ui, suffix) {
    const before = await snapshot(ui),
      profile = before.browserProfiles.find(
        (profile) => profile.id === before.activeBrowserProfileId,
      ),
      url = base + suffix;
    await ui.evaluate(
      ({ tabId, url }) =>
        window.acira.browserCommand({ type: "navigate", tabId, url }),
      { tabId: before.activeTabId, url },
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
      "native website data in exact packaged profile",
      15000,
    );
  }
  async function choose(ui, id) {
    if ((await snapshot(ui)).activeBrowserProfileId !== id)
      await ui.evaluate(
        (id) => window.acira.dispatch({ type: "browser.profile.select", id }),
        id,
      );
    return chrome(id);
  }
  function identity(value, name) {
    assert.equal(value.local, name);
    assert.equal(value.indexed, name);
    assert.match(value.cookie, new RegExp("session=" + name));
    assert.match(value.cookie, new RegExp("persistent=" + name));
    assert.equal(value.bridgeAbsent, true);
  }
  try {
    let uiA = await launch(previous);
    await uiA.getByRole("button", { name: "Skip setup", exact: true }).click();
    const profileA = (await snapshot(uiA)).activeBrowserProfileId;
    const preferences = await uiA.evaluate(() =>
      window.acira.setup({
        type: "preferences",
        patch: {
          appearance: "dark",
          searchEngine: "duckduckgo",
          addressSuggestions: false,
        },
      }),
    );
    assert.equal(preferences.ok, true);
    await uiA.evaluate(
      (url) => window.acira.dispatch({ type: "bookmark.toggle", url }),
      base + "/bookmark",
    );
    await visit(uiA, "/seed?identity=handoff-a");
    identity(await visit(uiA, "/data-a"), "handoff-a");
    await uiA.evaluate(() =>
      window.acira.dispatch({
        type: "browser.profile.create",
        name: "Handoff B",
      }),
    );
    const profileB = (await snapshot(uiA)).browserProfiles.find(
      (profile) => profile.name === "Handoff B",
    ).id;
    let uiB = await choose(uiA, profileB);
    const empty = await visit(uiB, "/data-b");
    assert.equal(empty.cookie, "");
    assert.equal(empty.indexed, null);
    await visit(uiB, "/seed?identity=handoff-b");
    identity(await visit(uiB, "/data-b"), "handoff-b");
    const before = await snapshot(uiA),
      profilesBefore = before.browserProfiles.map(
        ({ id, name, partition }) => ({
          id,
          name,
          partition,
        }),
      );
    assert.equal(
      before.bookmarkNodes.some((item) => item.url === base + "/bookmark"),
      true,
    );
    await hidden();
    checks.push(
      "previous real portable seeds two isolated local profile sessions, localStorage/IndexedDB, settings and bookmark through native APIs",
    );
    await app.close();
    app = null;

    uiA = await launch(next);
    uiA = await choose(uiA, profileA);
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
      profilesBefore,
    );
    assert.equal(after.settings.appearance, "dark");
    assert.equal(after.settings.searchEngine, "duckduckgo");
    assert.equal(after.settings.addressSuggestions, false);
    assert.equal(
      after.bookmarkNodes.some((item) => item.url === base + "/bookmark"),
      true,
    );
    checks.push(
      "new portable reuses the same disposable userData, retains exact profile IDs/partitions/settings/bookmark and does not replay completed setup",
    );
    identity(await visit(uiA, "/data-a"), "handoff-a");
    uiB = await choose(uiA, profileB);
    identity(await visit(uiB, "/data-b"), "handoff-b");
    checks.push(
      "both profiles retain their own HttpOnly session/persistent cookie, localStorage and IndexedDB across actual binary handoff with no cross-profile leakage",
    );
    const loggedOut = await visit(uiA, "/logout");
    assert.equal(loggedOut.cookie, "");
    assert.equal(loggedOut.local, null);
    assert.equal(loggedOut.indexed, null);
    identity(await visit(uiB, "/data-b-after-a-logout"), "handoff-b");
    await hidden();
    await app.close();
    app = null;

    uiA = await launch(next);
    uiA = await choose(uiA, profileA);
    const afterLogout = await visit(uiA, "/data-a-after-restart");
    assert.equal(afterLogout.cookie, "");
    assert.equal(afterLogout.local, null);
    assert.equal(afterLogout.indexed, null);
    uiB = await choose(uiA, profileB);
    identity(await visit(uiB, "/data-b-after-restart"), "handoff-b");
    checks.push(
      "post-handoff website logout stays cleared after another real new-binary restart while profile B remains signed in",
    );
    await hidden();
    const result = {
      checks,
      actual,
      previous,
      next,
      rejected,
      visibleWindows: false,
      sameVersion: actual[0].version === actual[1].version,
      scope:
        "Two portable binary/source milestones using the same isolated userData override; installer/real installed-path/version migration remains unverified",
      liveGoogleAuthenticated: false,
      osDefaultsChanged: false,
    };
    await fs.writeFile(
      path.join(out, "result.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(
      JSON.stringify(
        {
          checks,
          previous: previous.sourceDigest,
          next: next.sourceDigest,
          artifacts: out,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await fs.writeFile(
      path.join(out, "partial.json"),
      JSON.stringify(
        { checks, actual, previous, next, failure: error.message },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await app?.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}
