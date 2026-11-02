import fs from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID, createHash, createPublicKey } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { _electron } from "playwright";
import {
  qualifyPackage,
  launchQualifiedPackage,
} from "./accounts-qualified-packages.mjs";
import { initializeReleaseProfile } from "./release-initialize-profile.mjs";
import { completeLocalSetup } from "./release-local-setup.mjs";
import { nativePage, poll } from "./native-helpers.mjs";

const root = process.cwd(),
  target = path.resolve(process.argv[2] || ""),
  reportName = process.argv[3],
  product = path.join(target, "resources/app"),
  run = promisify(execFile),
  same = (a, b) =>
    path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
assert.ok(target.startsWith(root + path.sep));
const selected = await qualifyPackage({ root, reportName });
assert.ok(same(path.dirname(selected.executable), target));
const stamp = Date.now(),
  out = path.resolve("qa/artifacts/release-f12-storage-crash-" + stamp),
  fixtureRoot = path.resolve(".qa-profiles/f12b-" + stamp);
await fs.mkdir(out, { recursive: true });
await fs.mkdir(fixtureRoot, { recursive: true });
const report = {
  schema: 1,
  createdAt: new Date().toISOString(),
  sourceDigest: selected.sourceDigest,
  packageReport: reportName,
  packageManifestSha256: selected.packageManifestSha256,
  targetIntervalMs: 2500,
  arms: [],
  traffic: [],
  errors: [],
  originalFailedReceipt:
    "qa/artifacts/accounts-f12-crash-1792821245944/result.json",
  limitations: [
    "Minimal matched actual-cbe comparison; no complete nine-group replay. One pair is a bounded diagnostic, not a universal crash guarantee.",
    "Actual initialized-key startup and native Settings review; offscreen, nonfocusable, pointer-ignoring disposable windows only.",
    "Exact same HTTPS origin and storage names in both arms. TLS uses a disposable exact-SPKI pin, without product TLS or OS trust changes.",
    "No forced native storage/cookie flush, product source change, preview/user profile/desktop input or reseeding after the crash boundary.",
    "The interval records last B localStorage write to taskkill request; command completion and actual process-exit observation are recorded separately.",
  ],
};
const require = createRequire(import.meta.url),
  { BrowserDatabase } = require(path.join(product, "desktop/database.cjs")),
  { createInitialState } = require(path.join(product, "desktop/runtime.cjs"));
let app,
  server,
  currentArm,
  phase = "prepare",
  seedEnabled = false;
const B = "accounts-f12-B",
  C = "accounts-f12-C";
async function processIdentity(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const { stdout } = await run("powershell", [
    "-NoProfile",
    "-Command",
    `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object ProcessId,ParentProcessId,CommandLine,ExecutablePath,CreationDate | ConvertTo-Json -Compress`,
  ]);
  assert.ok(stdout.trim());
  return JSON.parse(stdout);
}
const service = (ui, request) =>
    ui.evaluate((request) => window.acira.service(request), request),
  act = (ui, action) =>
    ui.evaluate((action) => window.acira.dispatch(action), action);
async function uiFor(id) {
  const ui = await poll(
    async () => {
      for (const page of app.context().pages())
        if (page.url() === "acira-browser-ui://ui/index.html")
          try {
            if (
              (await page.evaluate(() => window.acira.getSnapshot()))
                .activeBrowserProfileId === id
            )
              return page;
          } catch {}
    },
    Boolean,
    "Actual profile UI " + id,
    15000,
  );
  ui.on("pageerror", (error) => report.errors.push(error.message));
  await app.evaluate(({ BaseWindow }) => {
    for (const w of BaseWindow.getAllWindows()) {
      w.setFocusable(false);
      w.setIgnoreMouseEvents(true);
      w.setPosition(-20000, -20000);
      w.showInactive();
      if (w.isFocused() || w.getBounds().x > -2000)
        throw Error("Owned fixture reached desktop");
    }
  });
  return ui;
}
async function select(ui, id) {
  await act(ui, { type: "browser.profile.select", id });
  return uiFor(id);
}
async function open(ui, url) {
  await act(ui, { type: "tab.new", url });
  const page = await nativePage(app, url);
  await page.locator("h1").waitFor();
  return page;
}
async function store(page, marker) {
  return page.evaluate(async (marker) => {
    if (marker !== null) {
      localStorage.setItem("accounts-f12-marker", marker);
      await (
        await caches.open("accounts-f12")
      ).put(new Request(location.origin + "/cached"), new Response(marker));
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("accounts-f12", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("values");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction("values", "readwrite");
        tx.objectStore("values").put(marker, "marker");
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }
    let indexed = null;
    if ((await indexedDB.databases()).some((db) => db.name === "accounts-f12"))
      indexed = await new Promise((resolve, reject) => {
        const r = indexedDB.open("accounts-f12");
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("values"),
            read = tx.objectStore("values").get("marker");
          let value = null;
          read.onsuccess = () => (value = read.result ?? null);
          tx.oncomplete = () => {
            db.close();
            resolve(value);
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    return {
      local: localStorage.getItem("accounts-f12-marker"),
      indexed,
      cache: (await caches.has("accounts-f12"))
        ? await (await caches.open("accounts-f12"))
            .match("/cached")
            .then((value) => value?.text() || null)
        : null,
    };
  }, marker);
}
async function choose(ui, enabled, categories) {
  await act(ui, { type: "tab.new", url: "acira://settings" });
  await ui.getByRole("button", { name: "Privacy", exact: true }).click();
  const panel = ui.locator(".profile-cleanup");
  await poll(
    () =>
      panel
        .getByRole("switch", { name: /Clear selected data on exit/ })
        .isEnabled(),
    Boolean,
    "Cleanup status ready",
  );
  await panel
    .getByRole("switch", { name: /Clear selected data on exit/ })
    .setChecked(enabled);
  for (const [category, title] of [
    ["cookies", "Cookies and sign-ins"],
    ["storage", "Site storage and cached files"],
    ["history", "Browsing history"],
    ["permissions", "Site permissions"],
  ])
    await panel
      .getByRole("switch", { name: new RegExp(title) })
      .setChecked(categories.includes(category));
  const result = await poll(
    () => service(ui, { type: "cleanup.status" }),
    (r) =>
      r.cleanup.choice.enabled === enabled &&
      JSON.stringify(r.cleanup.choice.categories) ===
        JSON.stringify(categories),
    "Reviewed native choice",
  );
  assert.deepEqual(result.cleanup.choice.keepOrigins, []);
  return result.cleanup;
}
async function gate() {
  const current = await qualifyPackage({ root, reportName });
  assert.equal(current.sourceDigest, selected.sourceDigest);
  assert.equal(current.packageManifestSha256, selected.packageManifestSha256);
  return current;
}
async function launch(data, nonce, spki) {
  const current = await gate(),
    initialize = () =>
      initializeReleaseProfile({
        candidate: product,
        data,
        executablePath: current.executable,
        packaged: true,
      });
  currentArm.initializations.push(
    await launchQualifiedPackage({
      root,
      candidate: current,
      launch: initialize,
    }),
  );
  await gate();
  const env = {
    ...process.env,
    NODE_PATH: "",
    ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data,
    ACIRA_BROWSER_TEST_HIDDEN: "1",
    ACIRA_PREVIEW_RECORD: "1",
    LOCALAPPDATA: path.join(data, "empty-import-sources"),
  };
  for (const key of ["NODE_OPTIONS", "ELECTRON_RUN_AS_NODE", "ACIRA_DEV"])
    delete env[key];
  app = await launchQualifiedPackage({
    root,
    candidate: current,
    options: {
      args: [
        "--release-storage-crash-nonce=" + nonce,
        "--host-resolver-rules=MAP *.remove.test 127.0.0.1",
        "--ignore-certificate-errors-spki-list=" + spki,
      ],
      env,
      timeout: 30000,
    },
    launch: (options) => _electron.launch(options),
  });
  app.process().stderr?.on("data", (chunk) => {
    currentArm.nativeDiagnostics = (
      (currentArm.nativeDiagnostics || "") + chunk.toString()
    ).slice(-5000);
  });
  const actual = await app.evaluate(({ app }) => ({
    pid: process.pid,
    exe: process.execPath,
    appPath: app.getAppPath(),
    data: app.getPath("userData"),
    packaged: app.isPackaged,
    electron: process.versions.electron,
  }));
  assert.equal(actual.packaged, true);
  assert.ok(
    same(actual.exe, current.executable) &&
      same(actual.appPath, product) &&
      same(actual.data, data),
  );
  const os = await processIdentity(actual.pid);
  assert.ok(
    same(os.ExecutablePath, actual.exe) && os.CommandLine.includes(nonce),
  );
  if (actual.pid !== app.process().pid) {
    const parent = await processIdentity(app.process().pid);
    assert.equal(os.ParentProcessId, parent.ProcessId);
    assert.equal(path.basename(parent.ExecutablePath).toLowerCase(), "cmd.exe");
    assert.ok(
      parent.CommandLine.includes(nonce) &&
        parent.CommandLine.includes(current.executable),
    );
  }
  const identity = {
    ...actual,
    creation: os.CreationDate,
    command: os.CommandLine,
    launcherPid: app.process().pid,
    nonce,
  };
  currentArm.launches.push({ ...actual, creation: os.CreationDate, phase });
  return identity;
}
try {
  const openssl =
    process.env.OPENSSL_BIN || "C:/Program Files/Git/usr/bin/openssl.exe";
  await run(openssl, [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-keyout",
    path.join(fixtureRoot, "tls.key"),
    "-out",
    path.join(fixtureRoot, "tls.pem"),
    "-days",
    "1",
    "-nodes",
    "-subj",
    "/CN=release-storage-disposable.test",
  ]);
  const publicKey = (
      await run(openssl, [
        "x509",
        "-in",
        path.join(fixtureRoot, "tls.pem"),
        "-pubkey",
        "-noout",
      ])
    ).stdout,
    spki = createHash("sha256")
      .update(
        createPublicKey(publicKey).export({ type: "spki", format: "der" }),
      )
      .digest("base64");
  report.spki = spki;
  server = https.createServer(
    {
      key: await fs.readFile(path.join(fixtureRoot, "tls.key")),
      cert: await fs.readFile(path.join(fixtureRoot, "tls.pem")),
    },
    (request, response) => {
      const url = new URL(request.url, "https://" + request.headers.host),
        owner = url.searchParams.get("owner");
      report.traffic.push({
        arm: currentArm?.mode,
        phase,
        at: Date.now(),
        origin: url.origin,
        path: url.pathname,
        owner,
        cookie: request.headers.cookie || "",
        seedEnabled,
      });
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", "text/html");
      if (url.pathname === "/seed" && seedEnabled)
        response.setHeader("Set-Cookie", [
          `ordinary=${owner}; Secure; SameSite=None; Path=/`,
          `httpOnly=${owner}; HttpOnly; Secure; SameSite=None; Path=/`,
        ]);
      response.end(
        "<!doctype html><title>Storage crash fixture</title><h1>Owned storage fixture</h1>",
      );
    },
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "https://a.remove.test:" + server.address().port;
  report.exactOrigin = origin;
  for (const enabled of [false, true]) {
    const mode = enabled
        ? "A-selected-C-cookies-B-off"
        : "cleanup-entirely-off",
      data = path.join(fixtureRoot, enabled ? "on" : "off"),
      nonce = randomUUID();
    await fs.mkdir(data, { recursive: true });
    currentArm = {
      mode,
      cleanupEnabled: enabled,
      initializations: [],
      launches: [],
      reviews: [],
    };
    report.arms.push(currentArm);
    phase = "initialize";
    seedEnabled = false;
    const initial = () =>
      initializeReleaseProfile({
        candidate: product,
        data,
        executablePath: selected.executable,
        packaged: true,
      });
    await gate();
    currentArm.initializations.push(
      await launchQualifiedPackage({
        root,
        candidate: selected,
        launch: initial,
      }),
    );
    const state = createInitialState(),
      A = state.activeBrowserProfileId;
    state.settings.onboardingComplete = true;
    state.browserProfiles.push(
      {
        id: B,
        name: "Untouched F12 B",
        color: "#62666d",
        partition: "persist:accounts-f12-B",
      },
      {
        id: C,
        name: "Cookies only F12 C",
        color: "#62666d",
        partition: "persist:accounts-f12-C",
      },
    );
    const database = new BrowserDatabase(path.join(data, "browser.sqlite"));
    database.saveWindow("main", state);
    database.close();
    phase = "seed";
    let live = await launch(data, nonce, spki),
      uiA = await uiFor(A);
    currentArm.setupBefore = await uiA.evaluate(() =>
      window.acira.setup({ type: "status" }),
    );
    await completeLocalSetup(uiA);
    currentArm.setupAfter = await uiA.evaluate(() =>
      window.acira.setup({ type: "status" }),
    );
    await app.evaluate(({ dialog }) => {
      globalThis.__releaseStorageReviews = [];
      dialog.showMessageBox = async (_window, options) => {
        globalThis.__releaseStorageReviews.push({
          defaultId: options.defaultId,
          cancelId: options.cancelId,
          title: options.title,
        });
        return { response: 1 };
      };
    });
    currentArm.AChoice = await choose(uiA, enabled, [
      "cookies",
      "storage",
      "history",
      "permissions",
    ]);
    const uiC = await select(uiA, C);
    currentArm.CChoice = await choose(uiC, enabled, ["cookies"]);
    let uiB = await select(uiA, B);
    currentArm.BChoice = (
      await service(uiB, { type: "cleanup.status" })
    ).cleanup;
    assert.equal(currentArm.BChoice.choice.enabled, false);
    seedEnabled = true;
    const pages = {};
    for (const [owner, id] of [
      ["A", A],
      ["C", C],
      ["B", B],
    ]) {
      currentArm.stage = "Positive storage seed " + owner;
      const ui = await select(uiA, id);
      pages[owner] = await open(ui, origin + "/seed?owner=" + owner);
      const before = await store(pages[owner], owner);
      assert.deepEqual(before, { local: owner, indexed: owner, cache: owner });
      await pages[owner].goto(origin + "/echo?owner=" + owner);
      assert.match(
        report.traffic.findLast(
          (hit) =>
            hit.arm === mode && hit.owner === owner && hit.path === "/echo",
        ).cookie,
        new RegExp("httpOnly=" + owner),
      );
    }
    uiB = await uiFor(B);
    currentArm.beforeB = await store(pages.B, null);
    assert.deepEqual(currentArm.beforeB, {
      local: "B",
      indexed: "B",
      cache: "B",
    });
    currentArm.reviews = await app.evaluate(
      () => globalThis.__releaseStorageReviews,
    );
    assert.ok(
      currentArm.reviews.every(
        (review) => review.defaultId === 0 && review.cancelId === 0,
      ),
    );
    seedEnabled = false;
    const initialOs = await processIdentity(live.pid);
    assert.equal(initialOs.CreationDate, live.creation);
    assert.equal(initialOs.CommandLine, live.command);
    assert.ok(same(initialOs.ExecutablePath, live.exe));
    currentArm.lastBWrite = await pages.B.evaluate(() => {
      localStorage.setItem("accounts-f12-marker", "B");
      return {
        at: Date.now(),
        origin: location.origin,
        value: localStorage.getItem("accounts-f12-marker"),
      };
    });
    assert.equal(currentArm.lastBWrite.value, "B");
    assert.equal(currentArm.lastBWrite.origin, origin);
    const deadline = currentArm.lastBWrite.at + 2500;
    await delay(Math.max(0, deadline - Date.now() - 1000));
    const os = await processIdentity(live.pid);
    const checkedAt = Date.now();
    assert.equal(os.CreationDate, live.creation);
    assert.equal(os.CommandLine, live.command);
    assert.ok(
      os.CommandLine.includes(nonce) && same(os.ExecutablePath, live.exe),
    );
    await delay(Math.max(0, deadline - Date.now()));
    const child = app.process(),
      issuedAt = Date.now();
    currentArm.crash = {
      pid: live.pid,
      creation: os.CreationDate,
      exe: os.ExecutablePath,
      nonceVerified: true,
      identityCheckedAt: checkedAt,
      taskkillIssuedAt: issuedAt,
      writeToTaskkillMs: issuedAt - currentArm.lastBWrite.at,
      identityAgeAtTaskkillMs: issuedAt - checkedAt,
    };
    await run("taskkill", ["/PID", String(live.pid), "/T", "/F"]);
    currentArm.crash.commandCompletedAt = Date.now();
    await poll(
      () =>
        Promise.resolve(child.exitCode !== null || child.signalCode !== null),
      Boolean,
      "Owned native crash exits",
      10000,
    );
    currentArm.crash.exitObservedAt = Date.now();
    app = null;
    phase = "restart";
    await launch(data, nonce, spki);
    uiA = await uiFor(A);
    currentArm.startupGate = (
      await service(uiA, { type: "cleanup.gate" })
    ).cleanupGate;
    assert.equal(currentArm.startupGate.ready, true);
    uiB = await select(uiA, B);
    currentArm.afterB = await store(
      await open(uiB, origin + "/inspect?owner=B"),
      null,
    );
    currentArm.controls = {};
    for (const [owner, id] of [
      ["A", A],
      ["C", C],
    ]) {
      const ui = await select(uiA, id),
        page = await open(ui, origin + "/inspect?owner=" + owner);
      currentArm.controls[owner] = {
        storage: await store(page, null),
        cookie: report.traffic.findLast(
          (hit) =>
            hit.arm === mode &&
            hit.phase === "restart" &&
            hit.owner === owner &&
            hit.path === "/inspect",
        ).cookie,
      };
    }
    if (enabled)
      assert.deepEqual(currentArm.controls.A.storage, {
        local: null,
        indexed: null,
        cache: null,
      });
    else {
      assert.equal(currentArm.controls.A.storage.indexed, "A");
      assert.equal(currentArm.controls.A.storage.cache, "A");
    }
    assert.equal(currentArm.controls.C.storage.indexed, "C");
    assert.equal(currentArm.controls.C.storage.cache, "C");
    if (enabled) {
      assert.doesNotMatch(currentArm.controls.A.cookie, /httpOnly=/);
      assert.doesNotMatch(currentArm.controls.C.cookie, /httpOnly=/);
    } else {
      assert.match(currentArm.controls.A.cookie, /httpOnly=A/);
      assert.match(currentArm.controls.C.cookie, /httpOnly=C/);
    }
    currentArm.BLocalStorageRetained = currentArm.afterB.local === "B";
    currentArm.BIDBRetained = currentArm.afterB.indexed === "B";
    currentArm.BCacheRetained = currentArm.afterB.cache === "B";
    currentArm.intervalWithin100ms =
      Math.abs(currentArm.crash.writeToTaskkillMs - 2500) <= 100;
    assert.equal(
      currentArm.intervalWithin100ms,
      true,
      "Crash interval missed target",
    );
    assert.equal(
      report.traffic.filter(
        (hit) => hit.arm === mode && hit.phase === "restart" && hit.seedEnabled,
      ).length,
      0,
    );
    const finalChild = app.process();
    await app.evaluate(({ app }) => app.quit());
    await poll(
      () => Promise.resolve(finalChild.exitCode !== null),
      Boolean,
      "Normal diagnostic shutdown",
      15000,
    );
    currentArm.finalExit = {
      code: finalChild.exitCode,
      signal: finalChild.signalCode,
    };
    assert.equal(finalChild.exitCode, 0);
    app = null;
    await gate();
    currentArm.payloadStable = true;
    currentArm.status = "OBSERVED";
  }
  assert.equal(report.errors.length, 0);
  const [off, on] = report.arms;
  report.classification =
    !off.BLocalStorageRetained && !on.BLocalStorageRetained
      ? "B_LOCALSTORAGE_LOSS_IN_BOTH_ARMS_CLEANUP_SPECIFIC_CAUSE_NOT_ESTABLISHED"
      : off.BLocalStorageRetained && !on.BLocalStorageRetained
        ? "CLEANUP_ENABLED_ONLY_B_LOCALSTORAGE_LOSS_MINIMAL_ISOLATION_REPRO"
        : off.BLocalStorageRetained && on.BLocalStorageRetained
          ? "ORIGINAL_SHORT_SETTLE_B_LOSS_NOT_REPRODUCED_IN_MINIMAL_PAIR"
          : "OFF_ONLY_LOSS_INCONCLUSIVE_PAIR";
  report.status = "OBSERVED_MATCHED_PAIR";
} catch (error) {
  report.status = "FAIL";
  report.failure = String(error.stack || error);
  process.exitCode = 1;
} finally {
  if (app)
    try {
      await app.close();
    } catch (error) {
      report.cleanupError = error.message;
    }
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  try {
    await gate();
    report.payloadStable = true;
  } catch (error) {
    report.status = "FAIL";
    report.payloadError = error.message;
    process.exitCode = 1;
  }
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      out,
      status: report.status,
      classification: report.classification,
      arms: report.arms.map((arm) => ({
        mode: arm.mode,
        beforeB: arm.beforeB,
        afterB: arm.afterB,
        interval: arm.crash?.writeToTaskkillMs,
      })),
      error: report.failure,
    }),
  );
}
