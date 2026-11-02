import fs from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import assert from "node:assert/strict";
import { createHash, createPublicKey, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { _electron } from "playwright";
import { qualifiedElectron } from "./release-runtime.mjs";
import { poll, nativePage } from "./native-helpers.mjs";

const root = process.cwd(),
  priorFile = process.argv[2];
assert.ok(priorFile, "Pass the exact matched-product diagnostic receipt");
const prior = JSON.parse(await fs.readFile(priorFile, "utf8")),
  origin = new URL(prior.exactOrigin);
assert.equal(origin.hostname, "a.remove.test");
assert.equal(origin.protocol, "https:");
const runtime = await qualifiedElectron(),
  stamp = Date.now(),
  out = path.resolve("qa/artifacts/release-bare-storage-crash-" + stamp),
  fixtureRoot = path.resolve(".qa-profiles/f12e-" + stamp),
  run = (file, args) => promisify(execFile)(file, args, { windowsHide: true }),
  same = (a, b) =>
    path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
await fs.mkdir(out, { recursive: true });
await fs.mkdir(fixtureRoot, { recursive: true });
const main = path.join(out, "bare-main.cjs"),
  mainSource = `'use strict';
const {app,BrowserWindow}=require('electron');
app.setPath('userData',process.env.RELEASE_BARE_DATA);
app.commandLine.appendSwitch('host-resolver-rules','MAP *.remove.test 127.0.0.1');
app.commandLine.appendSwitch('ignore-certificate-errors-spki-list',process.env.RELEASE_BARE_SPKI);
app.whenReady().then(()=>{const window=new BrowserWindow({show:false,focusable:false,skipTaskbar:true,x:-20000,y:-20000,width:900,height:700,webPreferences:{partition:'persist:accounts-f12-B',nodeIntegration:false,contextIsolation:true,sandbox:true}});window.setIgnoreMouseEvents(true);window.setPosition(-20000,-20000);globalThis.__releaseBareModules=Object.keys(require.cache);window.loadURL(process.env.RELEASE_BARE_URL);});
app.on('window-all-closed',()=>app.quit());
`;
await fs.writeFile(main, mainSource);
const report = {
  schema: 1,
  createdAt: new Date().toISOString(),
  runtimeQualification: runtime.qualification,
  priorProductReport: priorFile,
  priorProductReportSha256: createHash("sha256")
    .update(await fs.readFile(priorFile))
    .digest("hex"),
  origin: origin.origin,
  partition: "persist:accounts-f12-B",
  bareMain: path.relative(root, main),
  bareMainSha256: createHash("sha256").update(mainSource).digest("hex"),
  arms: [],
  traffic: [],
  errors: [],
  limitations: [
    "Bare Electron persistent-session control; no Acira native/renderer/startup/cookie-recovery modules and no initialized-key product evidence.",
    "Same owned HTTPS origin/port, storage names and seed B as the matched cbe diagnostic. Disposable exact-SPKI TLS pin only.",
    "No forced storage/cookie flush, no reseeding after either boundary, no desktop input, user profile or product/preview change.",
    "Write-to-taskkill-request interval and later exit observations are separate; this is not an exact kernel exit timestamp.",
    "One short/settled pair, not universal crash durability or mapping of a particular Chromium source revision to this runtime.",
  ],
};
let app,
  server,
  currentArm,
  phase = "prepare",
  seedEnabled = false;
async function osIdentity(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const result = await run("powershell", [
    "-NoProfile",
    "-Command",
    `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object ProcessId,ParentProcessId,CommandLine,ExecutablePath,CreationDate | ConvertTo-Json -Compress`,
  ]);
  assert.ok(result.stdout.trim());
  return JSON.parse(result.stdout);
}
async function launch(data, nonce, url, spki) {
  const env = {
    ...process.env,
    RELEASE_BARE_DATA: data,
    RELEASE_BARE_URL: url,
    RELEASE_BARE_SPKI: spki,
  };
  for (const key of [
    "NODE_OPTIONS",
    "ELECTRON_RUN_AS_NODE",
    "ACIRA_DEV",
    "ACIRA_BROWSER_TEST_DATA",
    "ACIRA_RELEASE_CANDIDATE",
  ])
    delete env[key];
  const checked = await qualifiedElectron();
  assert.equal(checked.executablePath, runtime.executablePath);
  app = await _electron.launch({
    executablePath: runtime.executablePath,
    args: [main, "--release-bare-nonce=" + nonce],
    env,
    timeout: 30000,
  });
  app
    .process()
    .stderr?.on(
      "data",
      (chunk) =>
        (currentArm.nativeDiagnostics = (
          (currentArm.nativeDiagnostics || "") + chunk.toString()
        ).slice(-4000)),
    );
  const actual = await app.evaluate(({ app, BrowserWindow }) => ({
    pid: process.pid,
    exe: process.execPath,
    data: app.getPath("userData"),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    appPath: app.getAppPath(),
    windows: BrowserWindow.getAllWindows().map((w) => ({
      focused: w.isFocused(),
      visible: w.isVisible(),
      bounds: w.getBounds(),
    })),
    modules: globalThis.__releaseBareModules,
  }));
  assert.ok(
    same(actual.exe, runtime.executablePath) && same(actual.data, data),
  );
  assert.equal(actual.electron, runtime.qualification.version);
  assert.ok(
    actual.windows.every((w) => !w.focused && !w.visible && w.bounds.x < -2000),
  );
  const engineModules = new Set([
    "electron",
    "electron/common",
    "electron/main",
    path.join(
      path.dirname(runtime.executablePath),
      "resources/default_app.asar/package.json",
    ),
    main,
  ]);
  assert.ok(actual.modules.every((module) => engineModules.has(module)));
  assert.ok(actual.modules.includes(main));
  const os = await osIdentity(actual.pid);
  assert.ok(
    same(os.ExecutablePath, actual.exe) && os.CommandLine.includes(nonce),
  );
  if (actual.pid !== app.process().pid) {
    const parent = await osIdentity(app.process().pid);
    assert.equal(os.ParentProcessId, parent.ProcessId);
    assert.equal(path.basename(parent.ExecutablePath).toLowerCase(), "cmd.exe");
    assert.ok(
      parent.CommandLine.includes(nonce) &&
        parent.CommandLine.includes(runtime.executablePath),
    );
  }
  const live = {
    ...actual,
    creation: os.CreationDate,
    command: os.CommandLine,
    nonce,
  };
  currentArm.launches.push({ ...actual, creation: os.CreationDate, phase });
  const page = await nativePage(app, url);
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.locator("h1").waitFor();
  return { live, page };
}
async function storage(page, seed) {
  return page.evaluate(async (seed) => {
    if (seed) {
      localStorage.setItem("accounts-f12-marker", "B");
      await (
        await caches.open("accounts-f12")
      ).put(new Request(location.origin + "/cached"), new Response("B"));
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("accounts-f12", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("values");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction("values", "readwrite");
        tx.objectStore("values").put("B", "marker");
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }
    let indexed = null;
    if ((await indexedDB.databases()).some((db) => db.name === "accounts-f12"))
      indexed = await new Promise((resolve, reject) => {
        const request = indexedDB.open("accounts-f12");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
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
  }, seed);
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
    "/CN=release-bare-disposable.test",
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
      report.traffic.push({
        interval: currentArm?.interval,
        phase,
        at: Date.now(),
        url: origin.origin + request.url,
        seedEnabled,
      });
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Type", "text/html");
      response.end(
        "<!doctype html><title>Bare storage control</title><h1>Owned bare storage control</h1>",
      );
    },
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(origin.port), "127.0.0.1", resolve);
  });
  for (const interval of [2500, 6500]) {
    const data = path.join(fixtureRoot, String(interval)),
      nonce = randomUUID();
    await fs.mkdir(data, { recursive: true });
    currentArm = { interval, launches: [] };
    report.arms.push(currentArm);
    phase = "seed";
    seedEnabled = true;
    const { live, page } = await launch(
      data,
      nonce,
      origin.origin + "/seed?owner=B",
      spki,
    );
    currentArm.before = await storage(page, true);
    assert.deepEqual(currentArm.before, {
      local: "B",
      indexed: "B",
      cache: "B",
    });
    seedEnabled = false;
    currentArm.lastWrite = await page.evaluate(() => {
      localStorage.setItem("accounts-f12-marker", "B");
      return {
        at: Date.now(),
        origin: location.origin,
        value: localStorage.getItem("accounts-f12-marker"),
      };
    });
    assert.equal(currentArm.lastWrite.origin, origin.origin);
    assert.equal(currentArm.lastWrite.value, "B");
    const deadline = currentArm.lastWrite.at + interval;
    await delay(Math.max(0, deadline - Date.now() - 1000));
    const os = await osIdentity(live.pid),
      checkedAt = Date.now();
    assert.equal(os.CreationDate, live.creation);
    assert.equal(os.CommandLine, live.command);
    assert.ok(
      same(os.ExecutablePath, live.exe) && os.CommandLine.includes(nonce),
    );
    await delay(Math.max(0, deadline - Date.now()));
    const child = app.process(),
      issuedAt = Date.now();
    currentArm.crash = {
      pid: live.pid,
      exe: os.ExecutablePath,
      creation: os.CreationDate,
      nonceVerified: true,
      identityAgeAtRequestMs: issuedAt - checkedAt,
      requestAt: issuedAt,
      writeToCrashRequestMs: issuedAt - currentArm.lastWrite.at,
    };
    await run("taskkill", ["/PID", String(live.pid), "/T", "/F"]);
    currentArm.crash.commandCompletedAt = Date.now();
    await poll(
      () =>
        Promise.resolve(child.exitCode !== null || child.signalCode !== null),
      Boolean,
      "Owned bare process crash exits",
      10000,
    );
    currentArm.crash.exitObservedAt = Date.now();
    app = null;
    assert.ok(
      Math.abs(currentArm.crash.writeToCrashRequestMs - interval) <= 100,
    );
    phase = "restart";
    const restarted = await launch(
      data,
      nonce,
      origin.origin + "/inspect?owner=B",
      spki,
    );
    currentArm.after = await storage(restarted.page, false);
    currentArm.localRetained = currentArm.after.local === "B";
    assert.equal(currentArm.after.indexed, "B");
    assert.equal(currentArm.after.cache, "B");
    assert.equal(
      report.traffic.filter(
        (hit) =>
          hit.interval === interval &&
          hit.phase === "restart" &&
          hit.seedEnabled,
      ).length,
      0,
    );
    const final = app.process();
    await app.evaluate(({ app }) => app.quit());
    await poll(
      () => Promise.resolve(final.exitCode !== null),
      Boolean,
      "Bare final normal quit",
      10000,
    );
    currentArm.finalExit = { code: final.exitCode, signal: final.signalCode };
    assert.equal(final.exitCode, 0);
    app = null;
    currentArm.status = "OBSERVED";
  }
  assert.equal(report.errors.length, 0);
  report.status = "OBSERVED_BARE_ENGINE_PAIR";
  report.classification =
    !report.arms[0].localRetained && report.arms[1].localRetained
      ? "BARE_ENGINE_EARLY_LOSS_SETTLED_RETENTION_REPRODUCED"
      : report.arms.every((arm) => arm.localRetained)
        ? "BARE_ENGINE_RETAINS_AT_BOTH_POINTS_APP_DIFFERENCE_REMAINS"
        : "OTHER_BARE_ENGINE_OUTCOME_REQUIRES_REVIEW";
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
  report.runtimeAfter = await qualifiedElectron();
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
        interval: arm.interval,
        actual: arm.crash?.writeToCrashRequestMs,
        before: arm.before,
        after: arm.after,
      })),
      error: report.failure,
    }),
  );
}
