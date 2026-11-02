import fs from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import assert from "node:assert/strict";
import { createHash, createPublicKey, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { _electron } from "playwright";
import { poll, nativePage } from "./native-helpers.mjs";
import { qualifiedElectron } from "./release-runtime.mjs";
import { initializeReleaseProfile } from "./release-initialize-profile.mjs";
import {
  qualifyPackage,
  launchQualifiedPackage,
} from "./accounts-qualified-packages.mjs";

// Complementary actual-main F12 evidence. No mutable-tree product launch, no
// replacement cleanup/recovery/inventory, and no duplicate normal-exit replay.
const argv = process.argv
  .slice(2)
  .filter((value) => value !== "--prepare-only");
if (process.argv.includes("--prepare-only") && !argv.length) {
  console.log(
    JSON.stringify({
      status: "PREPARED_ONLY",
      nativeLaunches: 0,
      contract:
        "Explicit immutable-or-portable target + captured frontend F12 snapshot + optional exact package report required for native execution",
    }),
  );
  process.exit(0);
}
assert.ok(
  argv[0] && argv[1],
  "Usage: node qa/accounts-f12-crash.mjs immutable-or-portable captured-frontend-snapshot [package-report matching-immutable] [--prepare-only]",
);
const workspace = process.cwd(),
  target = path.resolve(argv[0]),
  snapshotPath = path.resolve(argv[1]),
  packageReport = argv[2],
  productRoot = packageReport ? path.join(target, "resources/app") : target,
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  beneath = (parent, file) => {
    const rel = path.relative(parent, file);
    return (
      !!rel &&
      !rel.startsWith(".." + path.sep) &&
      rel !== ".." &&
      !path.isAbsolute(rel)
    );
  },
  same = (a, b) =>
    path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase(),
  run = promisify(execFile),
  require = createRequire(import.meta.url);
assert.ok(
  beneath(workspace, target) &&
    beneath(path.resolve("docs/release/snapshots"), snapshotPath),
);
assert.equal(same(target, workspace), false);
const identityBytes = await fs.readFile(
    path.join(
      target,
      packageReport ? "ACIRA-PROVENANCE.json" : "build-identity.json",
    ),
  ),
  identity = JSON.parse(identityBytes),
  snapshotBytes = await fs.readFile(snapshotPath),
  snapshot = JSON.parse(snapshotBytes),
  withdrawals = JSON.parse(
    await fs.readFile("docs/release/withdrawals.json", "utf8"),
  );
assert.equal(identity.committedSource, true);
assert.match(identity.sourceDigest, /^[a-f0-9]{64}$/);
assert.ok(
  !packageReport || argv[3],
  "Portable replay requires its explicit matching immutable source identity",
);
const sourceRoot = packageReport ? path.resolve(argv[3]) : target;
assert.ok(beneath(workspace, sourceRoot));
const sourceIdentityBytes = await fs.readFile(
    path.join(sourceRoot, "build-identity.json"),
  ),
  sourceIdentity = JSON.parse(sourceIdentityBytes);
assert.equal(sourceIdentity.committedSource, true);
assert.equal(sourceIdentity.sourceDigest, identity.sourceDigest);
assert.equal(sourceIdentity.commit, identity.commit);
assert.equal(snapshot.role, "frontend");
assert.ok(
  !withdrawals.snapshots.some((item) => same(item.path, snapshotPath)),
  "Owner snapshot withdrawn",
);
for (const file of [
  "desktop/main.cjs",
  "desktop/profile-cleanup.cjs",
  "desktop/profile-cleanup-shutdown.cjs",
  "desktop/cleanup-envelope.cjs",
  "src/features/ProfileCleanupRecovery.tsx",
]) {
  const entry = snapshot.entries.find((item) => item.file === file);
  assert.ok(entry && !entry.deleted, "Captured F12 slice required: " + file);
  assert.equal(
    sourceIdentity.source.find((item) => item.file === file)?.sha256,
    entry.sha256,
    "Target differs from captured F12 slice: " + file,
  );
}
async function verifyPayload() {
  assert.equal(
    sha(
      await fs.readFile(
        path.join(
          target,
          packageReport ? "ACIRA-PROVENANCE.json" : "build-identity.json",
        ),
      ),
    ),
    sha(identityBytes),
  );
  for (const marker of ["WITHDRAWN.json", "WITHDRAWN-RUNTIME.json"])
    assert.equal(
      await fs.access(path.join(target, marker)).then(
        () => true,
        () => false,
      ),
      false,
    );
  assert.equal(
    sha(await fs.readFile(path.join(sourceRoot, "build-identity.json"))),
    sha(sourceIdentityBytes),
  );
  assert.equal(sourceIdentity.stable, true);
  assert.ok(
    Array.isArray(sourceIdentity.artifacts) &&
      sourceIdentity.artifacts.length > 80,
  );
  for (const item of sourceIdentity.artifacts) {
    const file = path.resolve(sourceRoot, item.file);
    assert.ok(
      beneath(sourceRoot, file) &&
        beneath(await fs.realpath(sourceRoot), await fs.realpath(file)),
    );
    assert.equal(
      sha(await fs.readFile(file)),
      item.sha256,
      "Immutable artifact changed: " + item.file,
    );
  }
  if (packageReport) {
    const qualified = await qualifyPackage({
      root: workspace,
      reportName: packageReport,
    });
    assert.ok(same(path.dirname(qualified.executable), target));
    assert.equal(qualified.sourceDigest, identity.sourceDigest);
    return qualified;
  }
}
await verifyPayload();
if (process.argv.includes("--prepare-only")) {
  console.log(
    JSON.stringify({
      status: "PREPARED_ONLY",
      nativeLaunches: 0,
      sourceDigest: identity.sourceDigest,
      snapshot: snapshotPath,
      snapshotSha256: sha(snapshotBytes),
    }),
  );
  process.exit(0);
}
const stamp = Date.now(),
  data = path.resolve(".qa-profiles/accounts-f12-crash-" + stamp),
  out = path.resolve("qa/artifacts/accounts-f12-crash-" + stamp),
  nonce = randomUUID();
await fs.mkdir(data, { recursive: true });
await fs.mkdir(out, { recursive: true });
assert.ok(
  beneath(
    await fs.realpath(path.resolve(".qa-profiles")),
    await fs.realpath(data),
  ),
);
const { BrowserDatabase } = require(
    path.join(productRoot, "desktop/database.cjs"),
  ),
  { createInitialState, makeTab } = require(
    path.join(productRoot, "desktop/runtime.cjs"),
  ),
  report = {
    status: "RUNNING",
    checks: [],
    stage: "prepare",
    createdAt: new Date().toISOString(),
    sourceDigest: identity.sourceDigest,
    commit: identity.commit,
    productRoot,
    packageReport: packageReport || null,
    snapshot: path.relative(workspace, snapshotPath),
    snapshotSha256: sha(snapshotBytes),
    fixtureSha256: sha(await fs.readFile(new URL(import.meta.url))),
    initializations: [],
    launches: [],
    crashes: [],
    errors: [],
    limitations: [
      "Explicit initialized-key functional crash qualification, not genuinely fresh first-credential bootstrap.",
      "Only owned disposable windows; real Settings interactions use nonfocusable offscreen showInactive. Native confirmation decisions controlled; native dialog paint not qualified.",
      "Local TLS certificate exact SPKI pin and owned .test host resolver rules only; no product trust/policy/cleanup/request/extension substitution.",
      "Synthetic extension localStorage/IndexedDB; no real vault/provider credentials, OS integration, installed upgrade or user's preview.",
    ],
  };
let app,
  phase = "seed",
  seedEnabled = true,
  server,
  alternate,
  runtime,
  crashIdentity;
const traffic = [],
  reviews = [],
  record = (name) => {
    report.checks.push(name);
    stage(name);
  },
  stage = (name) => {
    report.stage = name;
    console.log(name);
  },
  readDB = (fn) => {
    const db = new BrowserDatabase(path.join(data, "browser.sqlite"));
    try {
      return fn(db);
    } finally {
      db.close();
    }
  },
  action = (ui, value) =>
    ui.evaluate((value) => window.acira.dispatch(value), value),
  service = (ui, value) =>
    ui.evaluate((value) => window.acira.service(value), value),
  extensions = (ui, value) =>
    ui.evaluate((value) => window.acira.extensions(value), value);

async function launch() {
  const qualified = await verifyPayload();
  runtime = packageReport
    ? { executablePath: qualified.executable }
    : await qualifiedElectron();
  if (!packageReport)
    assert.equal(runtime.qualification.version, identity.electron);
  const initialize = () =>
    initializeReleaseProfile({
      candidate: productRoot,
      data,
      executablePath: runtime.executablePath,
      packaged: !!packageReport,
    });
  report.initializations.push(
    packageReport
      ? await launchQualifiedPackage({
          root: workspace,
          candidate: qualified,
          launch: initialize,
        })
      : await initialize(),
  );
  await verifyPayload();
  const options = {
    executablePath: runtime.executablePath,
    args: [
      ...(packageReport ? [] : [path.join(productRoot, "desktop/main.cjs")]),
      "--accounts-f12-nonce=" + nonce,
      "--host-resolver-rules=MAP *.remove.test 127.0.0.1, MAP *.keep.test 127.0.0.1, MAP *.partition.test 127.0.0.1",
      "--ignore-certificate-errors-spki-list=" + report.spki,
    ],
    env: {
      ...process.env,
      NODE_PATH: "",
      ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data,
      ACIRA_BROWSER_TEST_HIDDEN: "1",
      ACIRA_PREVIEW_RECORD: "1",
      LOCALAPPDATA: path.join(data, "empty-import-sources"),
    },
    timeout: 30000,
  };
  for (const key of ["NODE_OPTIONS", "ELECTRON_RUN_AS_NODE", "ACIRA_DEV"])
    delete options.env[key];
  app = packageReport
    ? await launchQualifiedPackage({
        root: workspace,
        candidate: qualified,
        options,
        launch: (opts) => _electron.launch(opts),
      })
    : await _electron.launch(options);
  app.context().setDefaultTimeout(8000);
  app
    .process()
    .stderr?.on(
      "data",
      (bytes) =>
        (report.nativeDiagnostics = (
          String(report.nativeDiagnostics || "") + bytes
        ).slice(-8000)),
    );
  const actual = await app.evaluate(({ app }) => ({
    pid: process.pid,
    exe: process.execPath,
    appPath: app.getAppPath(),
    data: app.getPath("userData"),
    packaged: app.isPackaged,
    electron: process.versions.electron,
    chromium: process.versions.chrome,
  }));
  assert.ok(
    same(actual.data, data) && same(actual.exe, runtime.executablePath),
  );
  if (packageReport) {
    assert.equal(actual.packaged, true);
    assert.ok(same(actual.appPath, productRoot));
    assert.equal(actual.electron, qualified.runtimeQualification.version);
  } else assert.equal(actual.electron, identity.electron);
  const os = await processIdentity(actual.pid);
  assert.ok(os.CommandLine.includes(nonce));
  assert.ok(same(os.ExecutablePath, actual.exe));
  const launcherPid = app.process().pid;
  if (actual.pid !== launcherPid) {
    const launcher = await processIdentity(launcherPid);
    assert.equal(os.ParentProcessId, launcherPid);
    assert.equal(
      path.basename(launcher.ExecutablePath).toLowerCase(),
      "cmd.exe",
    );
    assert.ok(
      launcher.CommandLine.includes(nonce) &&
        launcher.CommandLine.includes(runtime.executablePath),
    );
  }
  crashIdentity = {
    ...actual,
    launcherPid,
    creation: os.CreationDate,
    command: os.CommandLine,
  };
  report.launches.push({ phase, ...actual, creation: os.CreationDate });
  return app;
}
async function processIdentity(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const raw = (
    await run("powershell", [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object ProcessId,ParentProcessId,CommandLine,ExecutablePath,CreationDate | ConvertTo-Json -Compress`,
    ])
  ).stdout.trim();
  assert.ok(raw, "Owned process disappeared before identity check");
  return JSON.parse(raw);
}
async function crash(label) {
  assert.ok(
    app && crashIdentity && app.process().pid === crashIdentity.launcherPid,
  );
  const actual = await processIdentity(crashIdentity.pid);
  assert.equal(actual.CreationDate, crashIdentity.creation);
  assert.ok(same(actual.ExecutablePath, crashIdentity.exe));
  assert.ok(
    actual.CommandLine.includes(nonce) &&
      actual.CommandLine === crashIdentity.command,
  );
  const child = app.process();
  await run("taskkill", ["/PID", String(crashIdentity.pid), "/T", "/F"]);
  await poll(
    () => Promise.resolve(child.exitCode !== null || child.signalCode !== null),
    Boolean,
    "Owned process-tree crash exits",
    10000,
  );
  report.crashes.push({
    label,
    pid: crashIdentity.pid,
    creation: actual.CreationDate,
    executable: actual.ExecutablePath,
    nonceVerified: true,
    exitCode: child.exitCode,
    signal: child.signalCode,
  });
  app = null;
  crashIdentity = null;
}
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
    for (const window of BaseWindow.getAllWindows()) {
      window.setFocusable(false);
      window.setIgnoreMouseEvents(true);
      window.setPosition(-20000, -20000);
      window.showInactive();
      if (window.isFocused())
        throw Error("Disposable fixture acquired desktop focus");
    }
  });
  return ui;
}
async function open(ui, url) {
  await action(ui, { type: "tab.new", url });
  const page = await nativePage(app, url);
  await page.locator("h1").waitFor();
  return page;
}
async function choose(ui, id, categories, keepOrigins = []) {
  await action(ui, { type: "tab.new", url: "acira://settings" });
  await ui.getByRole("button", { name: "Privacy", exact: true }).click();
  const panel = ui.locator(".profile-cleanup");
  await panel
    .getByRole("switch", { name: /Clear selected data on exit/ })
    .check();
  for (const [category, text] of [
    ["cookies", "Cookies and sign-ins"],
    ["storage", "Site storage and cached files"],
    ["history", "Browsing history"],
    ["permissions", "Site permissions"],
  ])
    await panel
      .getByRole("switch", { name: new RegExp(text) })
      .setChecked(categories.includes(category));
  await panel
    .getByRole("textbox", { name: /Sites to keep/ })
    .fill(keepOrigins.join("\n"));
  // Changes apply instantly: the site list is committed when the field loses focus.
  await panel.getByRole("textbox", { name: /Sites to keep/ }).blur();
  const status = await poll(
    () => service(ui, { type: "cleanup.status" }),
    (value) => value.cleanup.choice.enabled,
    "Actual reviewed choice armed",
  );
  assert.deepEqual(status.cleanup.choice, {
    enabled: true,
    categories,
    keepOrigins,
  });
  assert.equal(status.cleanup.pending, true);
  assert.equal(status.cleanup.networkBlocked, false);
  const durable = readDB((db) =>
    JSON.parse(
      db.db
        .prepare("SELECT value FROM metadata WHERE key=?")
        .get("exit-cleanup-plan-v1").value,
    ),
  );
  assert.ok(
    durable.jobs.some(
      (job) =>
        job.profileId === id &&
        JSON.stringify(job.choice) === JSON.stringify(status.cleanup.choice),
    ),
  );
  return durable;
}
async function storage(page, marker) {
  return page.evaluate(async (marker) => {
    if (marker !== null) {
      localStorage.setItem("accounts-f12-marker", marker);
      if (location.protocol !== "chrome-extension:")
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
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      });
    return {
      local: localStorage.getItem("accounts-f12-marker"),
      indexed,
      cache:
        location.protocol === "chrome-extension:"
          ? null
          : (await caches.has("accounts-f12"))
            ? await (await caches.open("accounts-f12"))
                .match("/cached")
                .then((value) => value?.text() || null)
            : null,
    };
  }, marker ?? null);
}
const expected = (marker) => ({
  local: marker,
  indexed: marker,
  cache: marker,
});
async function nativeCookies(partition) {
  // Electron Session.cookies omits Chromium partitionKey metadata. Observe
  // the actual owned website target through its protocol, then detach.
  const url = await app.evaluate(
    ({ session, webContents }, partition) =>
      webContents
        .getAllWebContents()
        .find(
          (contents) =>
            !contents.isDestroyed() &&
            contents.session === session.fromPartition(partition) &&
            /^https:\/\//.test(contents.getURL()),
        )
        ?.getURL(),
    partition,
  );
  assert.ok(url, "Owned native website target required for cookie observation");
  const page = await nativePage(app, url),
    protocol = await app.context().newCDPSession(page);
  try {
    return (await protocol.send("Network.getAllCookies")).cookies;
  } finally {
    await protocol.detach();
  }
}
async function extensionPopup(ui, id, name) {
  // Public native actions belong to the website toolbar, which Settings hides.
  // This control request happens only after both cleanup choices are armed.
  await open(ui, drop + "/extension-action?owner=A-extension-control");
  await extensions(ui, {
    type: "pin",
    profileId: A,
    extensionId: id,
    pinned: true,
  });
  await poll(
    () =>
      ui
        .locator(
          ".native-extension-actions:visible browser-action-list button.action",
        )
        .count(),
    (count) => count === 1,
    "Actual pinned synthetic action " + name,
  );
  await ui
    .locator(
      ".native-extension-actions:visible browser-action-list button.action",
    )
    .click();
  return nativePage(app, "chrome-extension://" + id + "/page.html");
}
let A,
  B = "accounts-f12-B",
  C = "accounts-f12-C",
  partitionA,
  partitionB = "persist:accounts-f12-B",
  partitionC = "persist:accounts-f12-C",
  drop,
  keep,
  sibling,
  altKeep,
  top,
  unavailableFolder,
  disabledFolder,
  disabledId,
  unavailableId,
  validRegistry;
const watchdog = setTimeout(async () => {
  report.status = "HARNESS_TIMEOUT";
  report.failure = "Timed out at " + report.stage;
  try {
    await crash("timeout cleanup");
  } catch (error) {
    report.cleanupError = error.message;
  }
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify({ ...report, traffic }, null, 2),
  );
  process.exit(1);
}, 240000);
try {
  stage("Prepare local TLS fixture");
  const openssl =
    process.env.OPENSSL_BIN || "C:/Program Files/Git/usr/bin/openssl.exe";
  await run(openssl, [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-keyout",
    path.join(data, "tls.key"),
    "-out",
    path.join(data, "tls.pem"),
    "-days",
    "1",
    "-nodes",
    "-subj",
    "/CN=accounts-f12-disposable.test",
  ]);
  const publicKey = (
    await run(openssl, [
      "x509",
      "-in",
      path.join(data, "tls.pem"),
      "-pubkey",
      "-noout",
    ])
  ).stdout;
  report.spki = createHash("sha256")
    .update(createPublicKey(publicKey).export({ type: "spki", format: "der" }))
    .digest("base64");
  const handler = (request, response) => {
    const url = new URL(request.url, "https://" + request.headers.host),
      owner = url.searchParams.get("owner") || "unspecified";
    traffic.push({
      phase,
      at: new Date().toISOString(),
      host: url.hostname,
      port: url.port,
      path: request.url,
      owner,
      cookie: request.headers.cookie || "",
      seedEnabled,
    });
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "text/html");
    if (url.pathname === "/seed" && seedEnabled)
      response.setHeader("Set-Cookie", [
        ...(owner.endsWith("-third")
          ? []
          : [
              `ordinary=${owner}; Secure; SameSite=None; Path=/`,
              `httpOnly=${owner}; HttpOnly; Secure; SameSite=None; Path=/`,
            ]),
        `chips=${owner}; HttpOnly; Secure; SameSite=None; Partitioned; Path=/`,
      ]);
    response.end(
      "<!doctype html><title>Accounts F12 fixture</title><h1>Owned F12 data</h1>" +
        (url.pathname === "/top"
          ? '<iframe id="child" src="' +
            url.searchParams
              .get("child")
              .replaceAll("&", "&amp;")
              .replaceAll('"', "&quot;") +
            '"></iframe>'
          : ""),
    );
  };
  const tls = {
    key: await fs.readFile(path.join(data, "tls.key")),
    cert: await fs.readFile(path.join(data, "tls.pem")),
  };
  server = https.createServer(tls, handler);
  alternate = https.createServer(tls, handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => alternate.listen(0, "127.0.0.1", resolve));
  drop = `https://a.remove.test:${server.address().port}`;
  keep = `https://a.keep.test:${server.address().port}`;
  sibling = `https://b.keep.test:${server.address().port}`;
  altKeep = `https://a.keep.test:${alternate.address().port}`;
  top = `https://top.partition.test:${server.address().port}`;
  let state = createInitialState();
  A = state.activeBrowserProfileId;
  partitionA = state.browserProfiles[0].partition;
  state.settings.onboardingComplete = true;
  state.browserProfiles.push(
    { id: B, name: "Untouched F12 B", color: "#62666d", partition: partitionB },
    {
      id: C,
      name: "Cookies only F12 C",
      color: "#62666d",
      partition: partitionC,
    },
  );
  state.closedTabs = [
    makeTab("accounts-closed-drop", "", drop + "/old", A),
    makeTab("accounts-closed-keep", "", keep + "/old", A),
  ];
  state.browsingHistory = [
    ["drop-A", A, drop],
    ["keep-A", A, keep],
    ["sibling-A", A, sibling],
    ["alt-A", A, altKeep],
    ["drop-B", B, drop],
    ["drop-C", C, drop],
  ].map(([id, browserProfileId, url]) => ({
    id,
    browserProfileId,
    url: url + "/historical",
    title: "Owned historic record",
    time: "2026-10-24T01:00:00Z",
  }));
  state.bookmarkNodes = [
    {
      id: "accounts-bookmark",
      browserProfileId: A,
      parentId: null,
      position: 0,
      title: "Retained bookmark",
      url: drop + "/saved",
    },
  ];
  const downloaded = path.join(data, "retained-download.txt");
  await fs.writeFile(downloaded, "Retained disposable download bytes");
  state.downloads = [
    {
      id: "accounts-download",
      browserProfileId: A,
      url: drop + "/file",
      filename: "retained-download.txt",
      path: downloaded,
      state: "completed",
      receivedBytes: 35,
      totalBytes: 35,
    },
  ];
  readDB((db) => {
    db.saveWindow("main", state);
    db.saveWindow("accounts-dormant", state);
    for (const [profile, requester, embedding] of [
      [A, drop, drop],
      [A, keep, keep],
      [A, sibling, sibling],
      [A, keep, drop],
      [B, drop, drop],
      [C, drop, drop],
    ])
      db.setPermission(profile, requester, embedding, "notifications", "allow");
  });
  await launch();
  let uiA = await uiFor(A);
  await app.evaluate(({ dialog }) => {
    globalThis.__accountsF12Reviews = [];
    dialog.showMessageBox = async (_owner, options) => {
      globalThis.__accountsF12Reviews.push({
        title: options.title,
        defaultId: options.defaultId,
        cancelId: options.cancelId,
        buttons: options.buttons,
      });
      return { response: 1 };
    };
  });
  assert.equal(traffic.length, 0);
  assert.equal(
    (await service(uiA, { type: "cleanup.status" })).cleanup.choice.enabled,
    false,
  );
  report.armedBeforeBrowsing = await choose(
    uiA,
    A,
    ["cookies", "storage", "history", "permissions"],
    [keep],
  );
  assert.equal(traffic.length, 0);
  record(
    "Actual Settings/native review durably arms A before any fixture browsing",
  );
  await action(uiA, { type: "browser.profile.select", id: C });
  let uiC = await uiFor(C);
  await choose(uiC, C, ["cookies"]);
  assert.equal(traffic.length, 0);
  record(
    "Independent cookies-only C is durably armed before browsing; B remains off",
  );
  await action(uiA, { type: "browser.profile.select", id: A });
  uiA = await uiFor(A);
  for (const [name, assign] of [
    [
      "disabled",
      (value) => {
        disabledFolder = value;
      },
    ],
    [
      "unavailable",
      (value) => {
        unavailableFolder = value;
      },
    ],
  ]) {
    const folder = path.join(data, "extension-" + name);
    assign(folder);
    await fs.mkdir(folder);
    await fs.writeFile(
      path.join(folder, "manifest.json"),
      JSON.stringify({
        manifest_version: 3,
        name: "F12 " + name + " storage",
        version: "1.0",
        action: { default_popup: "page.html" },
      }),
    );
    await fs.writeFile(
      path.join(folder, "page.html"),
      "<!doctype html><title>F12 extension storage</title><h1>Owned extension storage</h1>",
    );
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
    }, folder);
    const installed = await extensions(uiA, { type: "load", profileId: A });
    assert.equal(installed.error, undefined, installed.error);
    const extension = installed.extensions.find(
      (item) => item.name === "F12 " + name + " storage",
    );
    assert.ok(extension);
    const page = await extensionPopup(uiA, extension.id, name);
    const marker = name + "-extension";
    assert.deepEqual(await storage(page, marker), {
      local: marker,
      indexed: marker,
      cache: null,
    });
    await extensions(uiA, {
      type: "pin",
      profileId: A,
      extensionId: extension.id,
      pinned: false,
    });
    if (name === "disabled") {
      disabledId = extension.id;
      await extensions(uiA, {
        type: "disable",
        profileId: A,
        extensionId: extension.id,
      });
    } else {
      unavailableId = extension.id;
      await app.evaluate(({ webContents }, url) => {
        for (const contents of webContents.getAllWebContents())
          if (contents.getURL() === url)
            contents.close({ waitForBeforeUnload: true });
      }, page.url());
    }
  }
  assert.equal(
    (await extensions(uiA, { type: "list", profileId: A })).extensions.find(
      (item) => item.id === disabledId,
    ).status,
    "disabled",
  );
  await fs.rename(
    path.join(unavailableFolder, "manifest.json"),
    path.join(unavailableFolder, "manifest.unavailable"),
  );
  record(
    "Actual app manager installs two synthetic extensions; storage seeded once, D disabled and U source unavailable before crash",
  );
  async function seedWebsite(ui, base, owner) {
    const page = await open(ui, base + "/seed?owner=" + owner);
    assert.deepEqual(await storage(page, owner), expected(owner));
    await page.goto(base + "/echo?owner=" + owner);
    assert.match(
      traffic.findLast(
        (hit) => hit.owner === owner && hit.path.startsWith("/echo"),
      ).cookie,
      new RegExp("httpOnly=" + owner),
    );
    return page;
  }
  async function crossFrame(ui, owner, seed) {
    const child = drop + (seed ? "/seed?owner=" : "/inspect?owner=") + owner;
    const page = await open(
      ui,
      top + "/top?owner=" + owner + "&child=" + encodeURIComponent(child),
    );
    const frame = await poll(
      () =>
        Promise.resolve(page.frames().find((frame) => frame.url() === child)),
      Boolean,
      "Actual cross-site frame " + owner,
    );
    await frame.locator("h1").waitFor();
    if (seed) {
      assert.deepEqual(await storage(frame, owner), expected(owner));
      await frame.goto(drop + "/echo?owner=" + owner);
      assert.match(
        traffic.findLast(
          (hit) => hit.owner === owner && hit.path.startsWith("/echo"),
        ).cookie,
        new RegExp("chips=" + owner),
      );
    }
    return frame;
  }
  for (const [base, owner] of [
    [drop, "A"],
    [keep, "A-keep"],
    [sibling, "A-sibling"],
    [altKeep, "A-port"],
  ])
    await seedWebsite(uiA, base, owner);
  await crossFrame(uiA, "A-third", true);
  await action(uiA, { type: "tab.new", url: drop + "/restored?owner=A" });
  await action(uiA, { type: "browser.profile.select", id: B });
  let uiB = await uiFor(B);
  assert.equal(
    (await service(uiB, { type: "cleanup.status" })).cleanup.choice.enabled,
    false,
  );
  await seedWebsite(uiB, drop, "B");
  await crossFrame(uiB, "B-third", true);
  await open(uiB, drop + "/restored?owner=B");
  await action(uiA, { type: "browser.profile.select", id: C });
  uiC = await uiFor(C);
  await seedWebsite(uiC, drop, "C");
  await crossFrame(uiC, "C-third", true);
  await open(uiC, drop + "/restored?owner=C");
  for (const [profileId, partition] of [
    [A, partitionA],
    [B, partitionB],
    [C, partitionC],
  ]) {
    const cookies = await nativeCookies(partition);
    assert.ok(cookies.some((cookie) => cookie.name === "httpOnly"));
    assert.ok(
      cookies.some((cookie) => cookie.name === "chips" && cookie.partitionKey),
    );
    await poll(
      async () => {
        try {
          return (
            await fs.stat(
              path.join(data, "session-cookies", sha(partition) + ".bin"),
            )
          ).size;
        } catch {
          return 0;
        }
      },
      (value) => value > 0,
      "Automatic encrypted cookie snapshot " + profileId,
      15000,
    );
    (report.beforeCrashCookies ??= []).push({ profileId, cookies });
  }
  reviews.push(...(await app.evaluate(() => globalThis.__accountsF12Reviews)));
  assert.ok(
    reviews
      .filter((review) => /cleanup|exit|data/i.test(review.title))
      .every((review) => review.defaultId === 0 && review.cancelId === 0),
  );
  report.naturalWriteSettleMs = 10000;
  await delay(report.naturalWriteSettleMs); // No forced cookie/store flush; a bounded settled-write crash point.
  const beforeCrashSnapshot = await uiA.evaluate(() =>
    window.acira.getSnapshot(),
  );
  assert.ok(
    beforeCrashSnapshot.bookmarkNodes.some(
      (item) => item.id === "accounts-bookmark",
    ),
  );
  assert.ok(
    beforeCrashSnapshot.downloads.some(
      (item) => item.id === "accounts-download",
    ),
  );
  validRegistry = await fs.readFile(path.join(data, "extensions.json"));
  seedEnabled = false;
  report.seedingStoppedAt = new Date().toISOString();
  record(
    "Positive A/B/C ordinary, HttpOnly and cross-site CHIPS HTTP plus localStorage/IDB/cache controls; automatic encrypted snapshots observed, all seeding disabled",
  );
  await crash("armed process after settled website state");
  phase = "restart";
  await launch();
  uiA = await uiFor(A);
  assert.equal(
    (await service(uiA, { type: "cleanup.gate" })).cleanupGate.ready,
    true,
  );
  const firstA = await poll(
    () =>
      Promise.resolve(
        traffic.find((hit) => hit.phase === "restart" && hit.owner === "A"),
      ),
    Boolean,
    "First real restored A HTTP",
  );
  assert.doesNotMatch(firstA.cookie, /(?:^|; )(?:ordinary|httpOnly|chips)=/);
  const aCookies = await nativeCookies(partitionA);
  assert.ok(!aCookies.some((cookie) => cookie.domain.endsWith("remove.test")));
  assert.ok(
    aCookies.some(
      (cookie) => cookie.domain === "a.keep.test" && cookie.name === "httpOnly",
    ),
  );
  assert.ok(
    aCookies.some(
      (cookie) => cookie.domain === "b.keep.test" && cookie.name === "httpOnly",
    ),
  );
  for (const domain of ["a.keep.test", "b.keep.test"])
    assert.ok(
      aCookies.some(
        (cookie) =>
          cookie.domain === domain &&
          cookie.name === "chips" &&
          cookie.partitionKey,
      ),
      "Kept CHIPS credential " + domain,
    );
  assert.deepEqual(
    await storage(await open(uiA, drop + "/inspect?owner=A-removed")),
    expected(null),
  );
  assert.deepEqual(
    await storage(await open(uiA, keep + "/inspect?owner=A-kept")),
    expected("A-keep"),
  );
  assert.deepEqual(
    await storage(
      await open(uiA, sibling + "/inspect?owner=A-sibling-inspect"),
    ),
    expected(null),
  );
  assert.deepEqual(
    await storage(await open(uiA, altKeep + "/inspect?owner=A-port-inspect")),
    expected(null),
  );
  for (const owner of ["A-kept", "A-sibling-inspect", "A-port-inspect"]) {
    const request = traffic.findLast(
      (hit) => hit.phase === "restart" && hit.owner === owner,
    );
    assert.match(request.cookie, /(?:^|; )httpOnly=/);
    assert.match(request.cookie, /(?:^|; )chips=/);
  }
  const liveAfter = await uiA.evaluate(() => window.acira.getSnapshot());
  assert.ok(
    liveAfter.bookmarkNodes.some((item) => item.id === "accounts-bookmark"),
  );
  assert.ok(
    liveAfter.downloads.some((item) => item.id === "accounts-download"),
  );
  report.livePreservedRecords = { bookmark: true, downloadRecord: true };
  assert.deepEqual(
    await storage(await crossFrame(uiA, "A-third", false)),
    expected(null),
  );
  assert.doesNotMatch(
    traffic.findLast(
      (hit) =>
        hit.phase === "restart" &&
        hit.owner === "A-third" &&
        hit.path.startsWith("/inspect"),
    ).cookie,
    /(?:^|; )chips=/,
  );
  record(
    "Actual crash recovery removes A ordinary/HttpOnly/CHIPS before restored HTTP; keep cookies follow registrable domain while sibling/other-port storage follows exact origin",
  );
  await action(uiA, { type: "browser.profile.select", id: B });
  uiB = await uiFor(B);
  assert.deepEqual(
    await storage(await open(uiB, drop + "/inspect?owner=B-retained")),
    expected("B"),
  );
  assert.match(
    traffic.findLast((hit) => hit.owner === "B-retained").cookie,
    /httpOnly=B(?:;|$)/,
  );
  assert.deepEqual(
    await storage(await crossFrame(uiB, "B-third", false)),
    expected("B-third"),
  );
  assert.match(
    traffic.findLast(
      (hit) => hit.owner === "B-third" && hit.path.startsWith("/inspect"),
    ).cookie,
    /chips=B-third(?:;|$)/,
  );
  await action(uiA, { type: "browser.profile.select", id: C });
  uiC = await uiFor(C);
  assert.deepEqual(
    await storage(await open(uiC, drop + "/inspect?owner=C-retained")),
    expected("C"),
  );
  assert.equal((await nativeCookies(partitionC)).length, 0);
  assert.deepEqual(
    await storage(await crossFrame(uiC, "C-third", false)),
    expected("C-third"),
  );
  assert.doesNotMatch(
    traffic.findLast(
      (hit) => hit.owner === "C-third" && hit.path.startsWith("/inspect"),
    ).cookie,
    /(?:^|; )(?:ordinary|httpOnly|chips)=/,
  );
  record(
    "Untouched B retains first- and cross-site credentials/storage; cookies-only C removes credentials while retaining unselected first- and cross-site storage",
  );
  const records = readDB((db) => ({
    dormant: db.readWindow("accounts-dormant"),
    history: db.db
      .prepare("SELECT payload FROM history")
      .all()
      .map((row) => JSON.parse(row.payload)),
    A: db.permissions(A),
    B: db.permissions(B),
    C: db.permissions(C),
  }));
  assert.ok(records.history.some((row) => row.id === "keep-A"));
  for (const id of ["drop-A", "sibling-A", "alt-A"])
    assert.ok(!records.history.some((row) => row.id === id));
  for (const id of ["drop-B", "drop-C"])
    assert.ok(records.history.some((row) => row.id === id));
  assert.ok(
    records.dormant.bookmarkNodes.some(
      (item) => item.id === "accounts-bookmark",
    ),
  );
  assert.ok(
    records.dormant.downloads.some((item) => item.id === "accounts-download"),
  );
  assert.ok(
    !records.dormant.closedTabs.some(
      (item) => item.id === "accounts-closed-drop",
    ),
  );
  assert.ok(
    records.dormant.closedTabs.some(
      (item) => item.id === "accounts-closed-keep",
    ),
  );
  assert.equal(
    await fs.readFile(downloaded, "utf8"),
    "Retained disposable download bytes",
  );
  assert.equal(records.A.length, 1);
  assert.equal(records.A[0].requester, keep);
  assert.equal(records.B.length, 1);
  assert.equal(records.C.length, 1);
  report.records = records;
  record(
    "Selected live/dormant history and both-sided permissions cleared; exact keep history, bookmarks, download record/file and B/C unselected records retained",
  );
  await action(uiA, { type: "browser.profile.select", id: A });
  uiA = await uiFor(A);
  const beforeUnknown = await extensions(uiA, { type: "list", profileId: A });
  assert.equal(
    beforeUnknown.extensions.find((item) => item.id === disabledId).status,
    "disabled",
  );
  assert.equal(
    beforeUnknown.extensions.find((item) => item.id === unavailableId).status,
    "unavailable",
  );
  report.inventoryAfterCrash = beforeUnknown;
  const inventoryBoundaryURL =
    drop + "/inventory-boundary?owner=A-inventory-boundary";
  await open(uiA, inventoryBoundaryURL);
  // Observe the actual debounced product save, rather than crashing a newly
  // selected tab before its canonical restored address has reached SQLite.
  await poll(
    () =>
      Promise.resolve(
        readDB((db) =>
          db.db
            .prepare("SELECT payload FROM windows")
            .all()
            .map((row) => JSON.parse(row.payload))
            .some(
              (state) =>
                state.activeBrowserProfileId === A &&
                state.tabs.find((tab) => tab.id === state.activeTabId)?.url ===
                  inventoryBoundaryURL,
            ),
        ),
      ),
    Boolean,
    "Actual canonical A boundary address persisted",
  );
  await crash("recovered and durably rearmed before unknown inventory");
  await fs.writeFile(
    path.join(data, "extensions.json"),
    "{intentionally-invalid-owned-inventory",
  );
  phase = "unknown-inventory";
  await launch();
  uiA = await uiFor(A);
  report.unknownStartupGate = (
    await service(uiA, { type: "cleanup.gate" })
  ).cleanupGate;
  await uiA.getByRole("region", { name: "Profile cleanup recovery" }).waitFor();
  const blocked = (await service(uiA, { type: "cleanup.gate" })).cleanupGate;
  assert.equal(blocked.ready, false);
  assert.equal(blocked.pending, true);
  assert.ok(typeof blocked.error === "string" && blocked.error.length > 0);
  const pendingBeforeRetry = readDB(
    (db) =>
      db.db
        .prepare("SELECT value FROM metadata WHERE key=?")
        .get("exit-cleanup-plan-v1").value,
  );
  await uiA.getByRole("button", { name: "Retry cleanup", exact: true }).click();
  await poll(
    () => service(uiA, { type: "cleanup.gate" }),
    (value) =>
      value.cleanupGate.pending &&
      !value.cleanupGate.ready &&
      !!value.cleanupGate.error,
    "Unknown inventory remains pending after actual retry",
  );
  assert.equal(
    readDB(
      (db) =>
        db.db
          .prepare("SELECT value FROM metadata WHERE key=?")
          .get("exit-cleanup-plan-v1").value,
    ),
    pendingBeforeRetry,
  );
  assert.equal(
    traffic.filter(
      (hit) => hit.phase === "unknown-inventory" && /^A|^C/.test(hit.owner),
    ).length,
    0,
  );
  await assert.rejects(
    extensions(uiA, { type: "list", profileId: A }),
    /cleanup|inventory|installation/i,
  );
  report.unknownInventory = {
    gate: blocked,
    journalSha256: sha(pendingBeforeRetry),
    relevantHTTP: 0,
  };
  record(
    "Corrupt actual installed-extension registry holds A/C requests and durable journal; real recovery retry cannot bypass unknown inventory",
  );
  await crash("unknown inventory still pending");
  await fs.writeFile(path.join(data, "extensions.json"), validRegistry);
  phase = "inventory-repaired";
  await launch();
  uiA = await uiFor(A);
  assert.equal(
    (await service(uiA, { type: "cleanup.gate" })).cleanupGate.ready,
    true,
  );
  await fs.rename(
    path.join(unavailableFolder, "manifest.unavailable"),
    path.join(unavailableFolder, "manifest.json"),
  );
  for (const [id, marker] of [
    [disabledId, "disabled-extension"],
    [unavailableId, "unavailable-extension"],
  ]) {
    const enabled = await extensions(uiA, {
      type: "enable",
      profileId: A,
      extensionId: id,
    });
    assert.equal(enabled.error, undefined, enabled.error);
    const page = await extensionPopup(uiA, id, marker);
    assert.deepEqual(await storage(page), {
      local: marker,
      indexed: marker,
      cache: null,
    });
    await extensions(uiA, {
      type: "pin",
      profileId: A,
      extensionId: id,
      pinned: false,
    });
    await extensions(uiA, { type: "disable", profileId: A, extensionId: id });
  }
  record(
    "Repairing native inventory permits real recovery; manager re-enable reads original disabled/unavailable extension localStorage and IDB without reseeding",
  );
  assert.equal(
    traffic.filter((hit) => hit.phase !== "seed" && hit.seedEnabled).length,
    0,
  );
  assert.deepEqual(report.errors, []);
  assert.equal(report.crashes.length, 3);
  assert.equal(report.launches.length, 4);
  report.reviews = reviews;
  report.sourceStable = true;
  await verifyPayload();
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.failure = String(error.stack || error);
  process.exitCode = 1;
  try {
    report.failurePages = [];
    for (const page of app?.context().pages() || [])
      if (page.url().startsWith("acira-browser-ui://")) {
        report.failurePages.push({
          url: page.url(),
          text: (await page.locator("body").innerText()).slice(0, 1600),
        });
        await page.screenshot({
          path: path.join(
            out,
            "failure-" + report.failurePages.length + ".png",
          ),
        });
      }
  } catch (diagnostic) {
    report.diagnosticError = diagnostic.message;
  }
} finally {
  clearTimeout(watchdog);
  if (app)
    try {
      if (report.status === "PASS") {
        const child = app.process();
        await app.evaluate(({ app }) => app.quit());
        await poll(
          () => Promise.resolve(child.exitCode !== null),
          Boolean,
          "Fixture normal final quit",
          15000,
        );
        report.finalExit = { code: child.exitCode, signal: child.signalCode };
        assert.equal(child.exitCode, 0);
        app = null;
      } else await crash("failed owned fixture cleanup");
    } catch (error) {
      report.cleanupError = error.message;
      report.status = "FAIL";
      process.exitCode = 1;
      if (app)
        try {
          await crash("normal cleanup failure");
        } catch (crashError) {
          report.crashCleanupError = crashError.message;
        }
    }
  try {
    await verifyPayload();
    report.payloadStable = true;
  } catch (error) {
    report.status = "SOURCE_CHANGED";
    report.coherenceError = error.message;
    process.exitCode = 1;
  }
  for (const fixture of [server, alternate])
    if (fixture) {
      fixture.closeAllConnections();
      await new Promise((resolve) => fixture.close(resolve));
    }
  report.traffic = traffic;
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.checks.length,
      stage: report.stage,
      failure: report.failure,
      out,
    }),
  );
}
