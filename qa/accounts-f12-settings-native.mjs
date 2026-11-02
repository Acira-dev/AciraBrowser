import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { _electron } from "playwright";
import { nativePage, poll } from "./native-helpers.mjs";
import {
  qualifyPackage,
  launchQualifiedPackage,
} from "./accounts-qualified-packages.mjs";
import { initializeReleaseProfile } from "./release-initialize-profile.mjs";

// Actual qualified standalone Settings, never an injected component/client.
const workspace = process.cwd(),
  reportName = "release-package-1792820813396.json";
const candidate = await qualifyPackage({ root: workspace, reportName });
assert.equal(
  candidate.sourceDigest,
  "cbe0666b7dd8a432b53148e872cb257371eb61cd95f9745ad8b22f18472a8d2e",
);
assert.equal(
  candidate.packageManifestSha256,
  "a2e0b45e3b4a9ac81040a5beb238b261208d385161afeb04cc5181008160ffbe",
);
if (process.argv.includes("--prepare-only")) {
  console.log(
    JSON.stringify({
      status: "PREPARED_ONLY",
      nativeLaunches: 0,
      sourceDigest: candidate.sourceDigest,
      manifest: candidate.packageManifestSha256,
    }),
  );
  process.exit(0);
}
const stamp = Date.now(),
  out = path.resolve("qa/artifacts/accounts-f12-settings-native-" + stamp),
  data = path.resolve(".qa-profiles/acs-" + stamp),
  recoveryData = data + "-r",
  productRoot = path.join(path.dirname(candidate.executable), "resources/app"),
  require = createRequire(import.meta.url),
  { BrowserDatabase } = require(path.join(productRoot, "desktop/database.cjs")),
  { createInitialState } = require(
    path.join(productRoot, "desktop/runtime.cjs"),
  );
await fs.mkdir(out, { recursive: true });
await fs.mkdir(data, { recursive: true });
await fs.mkdir(recoveryData, { recursive: true });
await fs.copyFile(new URL(import.meta.url), path.join(out, "fixture.mjs"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const report = {
  status: "RUNNING",
  createdAt: new Date().toISOString(),
  sourceDigest: candidate.sourceDigest,
  packageManifestSha256: candidate.packageManifestSha256,
  packageReport: reportName,
  packageReportSha256: candidate.reportSha256,
  fixtureSha256: sha(await fs.readFile(new URL(import.meta.url))),
  checks: [],
  captures: [],
  cases: [],
  errors: [],
  launches: [],
  initializations: [],
  limitations: [
    "Actual native UI webContents whole-viewport images; no outer compositor/frame/motion claim.",
    "Controlled native confirmation answers; native service review/getter/save/journal/SQLite and barrier are unchanged. OS modal dialog paint is not qualified.",
    "Initialized-key disposable existing SQLite fixtures; no provider/user profile/preview/root build/client or cleanup/barrier replacement.",
    "Reuses existing source/package crash and worker evidence; this fixture tests Settings surface and native state, not those lifecycle groups again.",
  ],
};
let app,
  ui,
  profileId,
  windowId,
  activeData = data;
const record = (name, pass, detail = {}) => {
  report.checks.push({ name, pass, ...detail });
};
const stage = (name) => {
  report.stage = name;
  console.log(name);
};
const action = (page, value) =>
  page.evaluate((value) => window.acira.dispatch(value), value);
const service = (page, value) =>
  page.evaluate((value) => window.acira.service(value), value);
const panel = () => ui.locator(".profile-cleanup");
const controls = () => ({
  toggle: panel().getByRole("switch", { name: /Clear selected data on exit/ }),
  categories: [
    "Cookies and sign-ins",
    "Site storage and cached files",
    "Browsing history",
    "Site permissions",
  ].map((text) => panel().getByRole("checkbox", { name: new RegExp(text) })),
  origins: panel().getByRole("textbox", { name: /Sites to keep/ }),
  how: panel()
    .locator("summary")
    .filter({ hasText: "How cleanup and keep-sites work" }),
  save: panel().getByRole("button", { name: "Review and save", exact: true }),
  discard: panel().getByRole("button", {
    name: "Discard changes",
    exact: true,
  }),
  check: panel().getByRole("button", { name: "Check status", exact: true }),
});
function seed(directory, corrupt = false) {
  const state = createInitialState();
  state.settings.onboardingComplete = true;
  state.settings.reducedMotion = true;
  const db = new BrowserDatabase(path.join(directory, "browser.sqlite"));
  try {
    db.saveWindow("main", state);
    if (corrupt)
      db.db
        .prepare("INSERT INTO metadata(key,value) VALUES(?,?)")
        .run("exit-cleanup-plan-v1", "{owned-invalid-cleanup-journal");
  } finally {
    db.close();
  }
  return state.activeBrowserProfileId;
}
async function launch(directory) {
  activeData = directory;
  const current = await qualifyPackage({ root: workspace, reportName });
  assert.equal(current.reportSha256, candidate.reportSha256);
  report.initializations.push(
    await launchQualifiedPackage({
      root: workspace,
      candidate,
      launch: (options) =>
        initializeReleaseProfile({
          candidate: productRoot,
          data: directory,
          executablePath: options.executablePath,
          packaged: true,
        }),
    }),
  );
  app = await launchQualifiedPackage({
    root: workspace,
    candidate,
    options: {
      args: [],
      env: {
        ...process.env,
        ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: directory,
        ACIRA_BROWSER_TEST_HIDDEN: "1",
        ACIRA_PREVIEW_RECORD: "1",
        LOCALAPPDATA: path.join(directory, "empty-import-sources"),
      },
      timeout: 30000,
    },
    launch: (options) => _electron.launch(options),
  });
  const actual = await app.evaluate(({ app }) => ({
    pid: process.pid,
    packaged: app.isPackaged,
    exe: process.execPath,
    resources: app.getAppPath(),
    data: app.getPath("userData"),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
  }));
  assert.equal(actual.packaged, true);
  assert.equal(
    path.resolve(actual.exe).toLowerCase(),
    path.resolve(candidate.executable).toLowerCase(),
  );
  assert.equal(
    path.resolve(actual.resources).toLowerCase(),
    productRoot.toLowerCase(),
  );
  assert.equal(
    path.resolve(actual.data).toLowerCase(),
    directory.toLowerCase(),
  );
  report.launches.push(actual);
  ui = await nativePage(app, "acira-browser-ui://ui/index.html");
  await ui.waitForFunction(() => !!window.acira);
  ui.setDefaultTimeout(7000);
  ui.on("pageerror", (error) => report.errors.push(error.message));
  profileId = (await ui.evaluate(() => window.acira.getSnapshot()))
    .activeBrowserProfileId;
  windowId = await app.evaluate(
    ({ BaseWindow }) =>
      BaseWindow.getAllWindows().find((win) =>
        win.contentView.children.some(
          (view) =>
            view.webContents?.getURL() === "acira-browser-ui://ui/index.html",
        ),
      ).id,
  );
  await app.evaluate(({ dialog }) => {
    globalThis.__accountsSettingsReviews = [];
    globalThis.__accountsSettingsAnswer = 0;
    dialog.showMessageBox = async (owner, options) => {
      globalThis.__accountsSettingsReviews.push({
        ownerId: owner?.id,
        title: options.title,
        defaultId: options.defaultId,
        cancelId: options.cancelId,
        buttons: options.buttons,
        detail: options.detail,
      });
      return { response: globalThis.__accountsSettingsAnswer };
    };
  });
  await setWindow(900, 748);
  await action(ui, { type: "tab.new", url: "acira://settings" });
  await ui.getByRole("textbox", { name: "Search settings" }).waitFor();
  await ui
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Privacy", exact: true })
    .click();
  await panel().waitFor();
  await poll(
    () => controls().toggle.isEnabled(),
    Boolean,
    "Actual Settings getter ready",
  ).catch(async (error) => {
    if (!(await service(ui, { type: "cleanup.gate" })).cleanupGate.ready)
      return;
    throw error;
  });
}
async function setWindow(width, height) {
  return app.evaluate(
    ({ BaseWindow }, { windowId, width, height }) => {
      const win = BaseWindow.getAllWindows().find((win) => win.id === windowId);
      win.setFocusable(false);
      win.setIgnoreMouseEvents(true);
      win.setSkipTaskbar(true);
      win.setPosition(-20000 - windowId * 2000, -20000);
      win.setSize(width, height);
      win.showInactive();
      win.moveTop();
      if (win.isFocused()) throw Error("Test window acquired desktop focus");
      return {
        id: win.id,
        bounds: win.getBounds(),
        content: win.getContentSize(),
        focusable: win.isFocusable(),
        focused: win.isFocused(),
      };
    },
    { windowId, width, height },
  );
}
async function pose(key) {
  await action(ui, {
    type: "settings.update",
    patch: {
      interfaceScale: key.scale,
      reducedMotion: true,
      colorPreset: key.finish,
      appearance: key.appearance,
      browserTint: key.tint,
      accentColor: key.accent,
    },
  });
  await action(ui, {
    type: "ui.update",
    patch: { workspaceOpen: key.rail, webWorkspaceOpen: key.rail },
  });
  const native = await poll(
    () =>
      app.evaluate(({ BaseWindow }, id) => {
        const win = BaseWindow.getAllWindows().find((win) => win.id === id),
          view = win.contentView.children.find(
            (view) =>
              view.webContents?.getURL() === "acira-browser-ui://ui/index.html",
          );
        return {
          zoom: view.webContents.getZoomFactor(),
          view: view.getBounds(),
          window: win.getBounds(),
          focused: win.isFocused(),
        };
      }, windowId),
    (value) => Math.abs(value.zoom - key.scale / 100) < 0.001,
    "Actual native interface scale",
  );
  assert.equal(native.focused, false);
  await ui.evaluate(() => document.fonts.ready);
  await settle();
  return native;
}
async function settle() {
  // Static native viewport QA does not require a compositor animation callback.
  // Private/offscreen targets can stop RAF while their actual DOM remains live.
  await ui.waitForTimeout(50);
  await ui.evaluate(
    () => document.documentElement.getBoundingClientRect().width,
  );
}
async function geometry(locator) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect(),
      style = getComputedStyle(element),
      clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight },
      ancestors = [];
    for (let node = element.parentElement; node; node = node.parentElement) {
      const s = getComputedStyle(node),
        r = node.getBoundingClientRect(),
        x = s.overflowX !== "visible",
        y = s.overflowY !== "visible";
      if (x) {
        clip.left = Math.max(clip.left, r.left + node.clientLeft);
        clip.right = Math.min(
          clip.right,
          r.left + node.clientLeft + node.clientWidth,
        );
      }
      if (y) {
        clip.top = Math.max(clip.top, r.top + node.clientTop);
        clip.bottom = Math.min(
          clip.bottom,
          r.top + node.clientTop + node.clientHeight,
        );
      }
      if (x || y)
        ancestors.push({
          tag: node.tagName,
          class: node.className,
          overflowX: s.overflowX,
          overflowY: s.overflowY,
          bounds: r.toJSON(),
        });
    }
    const ring =
        style.outlineStyle === "none"
          ? 0
          : Math.max(0, parseFloat(style.outlineWidth) || 0) +
            Math.max(0, parseFloat(style.outlineOffset) || 0),
      tolerance = 1 / devicePixelRatio;
    return {
      text: (
        element.innerText ||
        element.getAttribute("aria-label") ||
        element.name ||
        element.tagName
      ).slice(0, 180),
      focused: document.activeElement === element,
      focusVisible: element.matches(":focus-visible"),
      bounds: box.toJSON(),
      clip,
      visible:
        box.left >= clip.left - tolerance &&
        box.right <= clip.right + tolerance &&
        box.top >= clip.top - tolerance &&
        box.bottom <= clip.bottom + tolerance,
      ringVisible:
        box.left - ring >= clip.left - tolerance &&
        box.right + ring <= clip.right + tolerance &&
        box.top - ring >= clip.top - tolerance &&
        box.bottom + ring <= clip.bottom + tolerance,
      outline: style.outline,
      outlineOffset: style.outlineOffset,
      ring,
      devicePixelRatio,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      ancestors,
    };
  });
}
async function capture(key, state, focus) {
  await settle();
  const paint = await panel().evaluate((root) => {
    const main = root.closest(".bs-main"),
      box = (node) => node.getBoundingClientRect().toJSON();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      main: box(main),
      mainWidth: main.clientWidth,
      mainScrollWidth: main.scrollWidth,
      root: box(root),
      rootWidth: root.clientWidth,
      rootScrollWidth: root.scrollWidth,
      fields: [...root.querySelectorAll("button,input,textarea,summary")].map(
        (node) => ({
          tag: node.tagName,
          text: (
            node.innerText ||
            node.getAttribute("aria-label") ||
            node.type
          ).slice(0, 100),
          bounds: box(node),
          disabled: node.matches(":disabled"),
          width: node.clientWidth,
          scrollWidth: node.scrollWidth,
        }),
      ),
      text: root.innerText,
    };
  });
  record(
    "Native Settings main has no horizontal overflow",
    paint.mainScrollWidth <= paint.mainWidth + 1,
    {
      key,
      state,
      mainWidth: paint.mainWidth,
      scrollWidth: paint.mainScrollWidth,
    },
  );
  record(
    "Owned cleanup panel has no horizontal overflow",
    paint.rootScrollWidth <= paint.rootWidth + 1,
    { key, state },
  );
  record(
    "Owned controls remain within panel width",
    paint.fields.every(
      (field) =>
        field.bounds.left >= paint.root.left - 1 &&
        field.bounds.right <= paint.root.right + 1,
    ),
    { key, state },
  );
  const image = await app.evaluate(async ({ BaseWindow }, id) => {
    const win = BaseWindow.getAllWindows().find((win) => win.id === id),
      view = win.contentView.children.find(
        (view) =>
          view.webContents?.getURL() === "acira-browser-ui://ui/index.html",
      ),
      image = await view.webContents.capturePage(undefined, {
        stayHidden: true,
      });
    return {
      base64: image.toPNG().toString("base64"),
      size: image.getSize(),
      view: view.getBounds(),
      window: win.getBounds(),
      focused: win.isFocused(),
    };
  }, windowId);
  assert.equal(image.focused, false);
  const file =
    [
      key.kind || "ordinary",
      key.finish,
      key.scale,
      key.rail ? "rail-open" : "rail-closed",
      state,
    ].join("-") + ".png";
  await fs.writeFile(path.join(out, file), Buffer.from(image.base64, "base64"));
  const focused = focus ? await geometry(focus) : null;
  report.captures.push({
    key,
    state,
    file,
    imageSize: image.size,
    nativeView: image.view,
    nativeWindow: image.window,
    paint,
    focus: focused,
  });
  return focused;
}
async function assertFocus(locator, key, name) {
  const measured = await geometry(locator);
  await settle();
  const settled = await geometry(locator);
  record(
    "Settled focus control and ring for " + name,
    settled.focused && settled.visible && settled.ringVisible,
    { key, initial: measured, settled },
  );
  record("Sequential keyboard reaches " + name, measured.focused, {
    key,
    measured,
  });
  record("Focused " + name + " stays visible", measured.visible, {
    key,
    measured,
  });
  record(
    "Full focus ring for " + name + " stays visible",
    measured.ringVisible,
    { key, measured },
  );
  return measured;
}
async function chooseAnswer(answer) {
  await app.evaluate(
    (_electron, answer) => (globalThis.__accountsSettingsAnswer = answer),
    answer,
  );
}
async function persistCheck(expected) {
  const status = (await service(ui, { type: "cleanup.status" })).cleanup;
  assert.deepEqual(status.choice, expected);
  const db = new BrowserDatabase(path.join(activeData, "browser.sqlite"));
  try {
    assert.deepEqual(db.policy(profileId, "*").exitCleanup, expected);
  } finally {
    db.close();
  }
  return status;
}
async function submit(answer) {
  await chooseAnswer(answer);
  await controls().save.click();
  await poll(
    () => panel().locator(".profile-cleanup__body").getAttribute("aria-busy"),
    (value) => value === "false",
    "Actual native review/save settles",
  );
}
async function reset() {
  let c = controls();
  await c.toggle.uncheck();
  for (const category of c.categories) await category.uncheck();
  await c.origins.fill("");
  if (await c.save.isEnabled()) await submit(1);
  assert.deepEqual(
    (await service(ui, { type: "cleanup.status" })).cleanup.choice,
    { enabled: false, categories: [], keepOrigins: [] },
  );
}
async function close(force = false) {
  if (!app) return;
  const child = app.process();
  try {
    if (force) {
      try {
        await app.evaluate(({ app }) => app.exit(0));
      } catch {}
      await poll(
        () => Promise.resolve(child.exitCode !== null),
        Boolean,
        "Owned recovery process exit",
        10000,
      );
    } else await app.close();
    report.exits ??= [];
    report.exits.push({
      force,
      code: child.exitCode,
      signal: child.signalCode,
    });
  } finally {
    app = null;
  }
}
const finishes = [
  {
    finish: "Porcelain",
    appearance: "light",
    tint: "#f8fbff",
    accent: "#1769c2",
  },
  {
    finish: "Burgundy",
    appearance: "dark",
    tint: "#4d1821",
    accent: "#4d1821",
  },
];
const longOrigins = Array.from(
  { length: 100 },
  (_, i) =>
    "https://" +
    "a".repeat(63) +
    "." +
    "b".repeat(63) +
    "." +
    "c".repeat(63) +
    ".u" +
    i +
    ".example",
);
const watchdog = setTimeout(async () => {
  report.status = "HARNESS_TIMEOUT";
  report.error = "Timed out at " + report.stage;
  try {
    await close(true);
  } catch (error) {
    report.cleanupError = error.message;
  }
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(report, null, 2),
  );
  process.exit(1);
}, 300000);
try {
  stage("Actual qualified cbe Settings surface");
  seed(data);
  await launch(data);
  for (const finish of process.argv.includes("--tail-only")
    ? []
    : process.argv.includes("--focus-only")
      ? finishes.slice(0, 1)
      : finishes)
    for (const scale of process.argv.includes("--focus-only")
      ? [100]
      : [100, 150])
      for (const rail of process.argv.includes("--focus-only")
        ? [false]
        : [false, true]) {
        const key = { kind: "ordinary", ...finish, scale, rail };
        stage(
          `Ordinary ${finish.finish} ${scale}% rail ${rail ? "open" : "closed"}`,
        );
        const native = await pose(key);
        await reset();
        let c = controls();
        await panel()
          .getByRole("heading", { name: "Clear browsing data on exit" })
          .scrollIntoViewIfNeeded();
        await capture(key, "off-top");
        await ui.keyboard.press("Tab");
        await c.toggle.focus();
        await assertFocus(c.toggle, key, "cleanup switch");
        await ui.keyboard.press("Space");
        await ui.keyboard.press("Tab");
        await assertFocus(c.categories[0], key, "Cookies and sign-ins");
        await ui.keyboard.press("Space");
        for (let index = 1; index < 4; index++) {
          await ui.keyboard.press("Tab");
          await assertFocus(
            c.categories[index],
            key,
            ["", "Site storage", "Browsing history", "Site permissions"][index],
          );
        }
        await ui.keyboard.press("Tab");
        await assertFocus(c.origins, key, "Sites to keep");
        await c.origins.fill("https://mail.example.test");
        await ui.keyboard.press("Tab");
        await assertFocus(c.how, key, "cleanup explanation");
        await ui.keyboard.press("Enter");
        await ui.keyboard.press("Tab");
        await assertFocus(c.save, key, "Review and save");
        await capture(key, "edited-actions", c.save);
        await ui.keyboard.press("Tab");
        await assertFocus(c.discard, key, "Discard changes");
        await ui.keyboard.press("Tab");
        await assertFocus(c.check, key, "Check status");
        await ui.keyboard.press("Enter");
        await poll(
          () => panel().locator(".profile-cleanup__feedback").innerText(),
          (text) => text.includes("Your edits are still here"),
          "Actual getter preserves draft",
        );
        assert.equal(
          (await service(ui, { type: "cleanup.status" })).cleanup.choice
            .enabled,
          false,
        );
        assert.equal(await c.toggle.isChecked(), true);
        await submit(0);
        await panel()
          .getByText("Not saved. Your edits are still here.", { exact: true })
          .waitFor();
        assert.equal(
          (await service(ui, { type: "cleanup.status" })).cleanup.choice
            .enabled,
          false,
        );
        assert.equal(await c.toggle.isChecked(), true);
        assert.equal(await c.origins.inputValue(), "https://mail.example.test");
        const feedback = panel().locator(".profile-cleanup__feedback");
        record(
          "Native Cancel feedback receives focus",
          await feedback.evaluate((node) => document.activeElement === node),
          { key },
        );
        await capture(key, "native-cancel-feedback", feedback);
        await c.origins.fill(
          "https://mail.example.test/a-path?synthetic=invalid",
        );
        const beforeInvalid = await app.evaluate(
          () => globalThis.__accountsSettingsReviews.length,
        );
        for (let attempt = 1; attempt <= 2; attempt++) {
          await c.origins.focus();
          await ui.keyboard.press("Tab");
          await ui.keyboard.press("Tab");
          record(
            "Keyboard reaches submit for repeated invalid origin",
            await c.save.evaluate((node) => document.activeElement === node),
            { key, attempt },
          );
          await ui.keyboard.press("Enter");
          await panel()
            .locator(".profile-cleanup__origins [role=alert]")
            .waitFor();
          const field = await geometry(c.origins),
            error = await geometry(
              panel().locator(".profile-cleanup__origins [role=alert]"),
            );
          record("Repeated invalid origin focuses its field", field.focused, {
            key,
            attempt,
            field,
          });
          record(
            "Repeated invalid origin field and full focus ring are visible",
            field.visible && field.ringVisible,
            { key, attempt, field },
          );
          record(
            "Repeated invalid origin explanation is visible",
            error.visible,
            { key, attempt, error },
          );
          assert.equal(await c.origins.getAttribute("aria-invalid"), "true");
          await capture(key, "invalid-" + attempt, c.origins);
        }
        assert.equal(
          await app.evaluate(() => globalThis.__accountsSettingsReviews.length),
          beforeInvalid,
          "Invalid component input must not reach native review",
        );
        assert.equal(
          (await service(ui, { type: "cleanup.status" })).cleanup.choice
            .enabled,
          false,
        );
        await c.origins.fill(longOrigins.join("\n"));
        await c.origins.focus();
        assert.equal(await c.origins.getAttribute("aria-invalid"), "false");
        record(
          "Long native-valid keep-origin list exceeds generic20k envelope",
          JSON.stringify(longOrigins).length > 20000,
          { key, chars: (await c.origins.inputValue()).length },
        );
        await capture(key, "long-origins", c.origins);
        await c.toggle.uncheck();
        await submit(1);
        await persistCheck({
          enabled: false,
          categories: ["cookies"],
          keepOrigins: longOrigins,
        });
        await capture(
          key,
          "configured-off-actions",
          panel().locator(".profile-cleanup__feedback"),
        );
        await c.toggle.check();
        await submit(1);
        const queued = await persistCheck({
          enabled: true,
          categories: ["cookies"],
          keepOrigins: longOrigins,
        });
        assert.equal(queued.pending, true);
        assert.equal(queued.networkBlocked, false);
        assert.equal(await c.origins.isEnabled(), true);
        assert.equal(await c.categories[2].isEnabled(), true);
        await panel()
          .locator(".profile-cleanup__state")
          .scrollIntoViewIfNeeded();
        await panel().getByText("Cleanup is queued", { exact: true }).waitFor();
        await capture(key, "queued-top");
        await c.check.click();
        await poll(
          () => feedback.innerText(),
          (text) => text === "Cleanup status updated.",
          "Actual queued status refresh",
        );
        await capture(key, "queued-actions", feedback);
        report.cases.push({
          key,
          native,
          states: 9,
          keyboard: true,
          actualOffCancelConfiguredPending: true,
          origins: 100,
          realNativePolicyPersisted: true,
        });
      }
  if (process.argv.includes("--tail-only")) {
    await controls().toggle.check();
    await controls().categories[0].check();
    await controls().origins.fill(longOrigins.join("\n"));
    await submit(1);
    await persistCheck({
      enabled: true,
      categories: ["cookies"],
      keepOrigins: longOrigins,
    });
  }
  if (
    process.argv.includes("--ordinary-only") ||
    process.argv.includes("--focus-only")
  ) {
    await close();
  } else {
    stage("Actual private Settings surface");
    const ordinaryPolicy = (await service(ui, { type: "cleanup.status" }))
        .cleanup.choice,
      ordinaryUi = ui,
      ordinaryWindow = windowId;
    await app.evaluate(
      ({ BaseWindow }, id) =>
        BaseWindow.getAllWindows()
          .find((win) => win.id === id)
          .hide(),
      ordinaryWindow,
    );
    report.ordinaryHiddenDuringPrivate = true;
    await ui.evaluate(() => window.acira.openWindow("private"));
    ui = await poll(
      async () => {
        for (const page of app.context().pages())
          if (page.url() === "acira-browser-ui://ui/index.html")
            try {
              if (
                (
                  await page.evaluate(() => window.acira.getSnapshot())
                ).browserProfiles.some((profile) => profile.private)
              )
                return page;
            } catch {}
      },
      Boolean,
      "Actual private chrome",
    );
    const privateState = await ui.evaluate(() => window.acira.getSnapshot());
    ui.setDefaultTimeout(7000);
    profileId = privateState.activeBrowserProfileId;
    windowId = await app.evaluate(
      ({ BaseWindow }, normal) =>
        BaseWindow.getAllWindows().find(
          (win) =>
            win.id !== normal &&
            win.contentView.children.some(
              (view) =>
                view.webContents?.getURL() ===
                "acira-browser-ui://ui/index.html",
            ),
        ).id,
      ordinaryWindow,
    );
    await setWindow(900, 748);
    await action(ui, { type: "tab.new", url: "acira://settings" });
    await ui
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("button", { name: "Privacy", exact: true })
      .click();
    await panel().getByRole("note").waitFor();
    for (const finish of finishes)
      for (const scale of [100, 150])
        for (const rail of [false, true]) {
          const key = { kind: "private", ...finish, scale, rail };
          await pose(key);
          if (!(await panel().count())) {
            const snapshot = await ui.evaluate(() =>
              window.acira.getSnapshot(),
            );
            (report.sharedHostIssues ??= []).push({
              kind: "Private Privacy panel disappeared after real settings/ui updates",
              key,
              snapshot,
              text: (await ui.locator("body").innerText()).slice(0, 1600),
            });
            record(
              "Private Privacy surface remains mounted after preferences",
              false,
              { key },
            );
            const image = await app.evaluate(async ({ BaseWindow }, id) => {
              const win = BaseWindow.getAllWindows().find(
                  (win) => win.id === id,
                ),
                view = win.contentView.children.find(
                  (view) =>
                    view.webContents?.getURL() ===
                    "acira-browser-ui://ui/index.html",
                );
              return (
                await view.webContents.capturePage(undefined, {
                  stayHidden: true,
                })
              )
                .toPNG()
                .toString("base64");
            }, windowId);
            await fs.writeFile(
              path.join(out, "private-lost-" + scale + "-" + rail + ".png"),
              Buffer.from(image, "base64"),
            );
            assert.equal(snapshot.activeBrowserProfileId, profileId);
            assert.ok(
              snapshot.browserProfiles.some((profile) => profile.private),
            );
            await ui
              .getByRole("navigation", { name: "Settings sections" })
              .getByRole("button", { name: "Privacy", exact: true })
              .click();
            await panel().getByRole("note").waitFor();
          }
          await panel().evaluate((node) =>
            node.scrollIntoView({ block: "nearest", inline: "nearest" }),
          );
          assert.equal(
            await panel().locator("input,textarea,button").count(),
            0,
          );
          assert.doesNotMatch(
            await panel().innerText(),
            /https:\/\/a{20}|Clearing on exit is|Cleanup is queued/,
          );
          await capture(key, "private-note");
        }
    await assert.rejects(
      service(ui, { type: "cleanup.status" }),
      /ordinary local profile/,
    );
    await ui.evaluate(() => window.acira.windowControl("close"));
    await poll(
      () => Promise.resolve(ui.isClosed()),
      Boolean,
      "Private Settings closes",
    );
    ui = ordinaryUi;
    windowId = ordinaryWindow;
    assert.deepEqual(
      (await service(ui, { type: "cleanup.status" })).cleanup.choice,
      ordinaryPolicy,
    );
    await close();
    stage("Actual failed recovery Settings surface");
    seed(recoveryData, true);
    await launch(recoveryData);
    for (const finish of finishes)
      for (const scale of [100, 150])
        for (const rail of [false, true]) {
          const key = { kind: "recovery", ...finish, scale, rail };
          const native = await pose(key);
          const recovery = ui.getByRole("region", {
            name: "Profile cleanup recovery",
          });
          await recovery.waitFor();
          const gate = (await service(ui, { type: "cleanup.gate" }))
            .cleanupGate;
          assert.equal(gate.ready, false);
          assert.equal(gate.pending, true);
          const c = controls();
          assert.equal(await c.toggle.isDisabled(), true);
          assert.equal(await c.origins.isDisabled(), true);
          assert.equal(await c.save.isDisabled(), true);
          assert.equal(await c.check.isEnabled(), true);
          await recovery.scrollIntoViewIfNeeded();
          await capture(key, "recovery-host");
          await recovery
            .getByRole("button", { name: "Retry cleanup", exact: true })
            .click();
          await poll(
            () => service(ui, { type: "cleanup.gate" }),
            (value) =>
              !value.cleanupGate.ready &&
              value.cleanupGate.pending &&
              !!value.cleanupGate.error,
            "Actual malformed journal remains blocked",
          );
          await panel()
            .locator(".profile-cleanup__state")
            .scrollIntoViewIfNeeded();
          await capture(key, "recovery-locked");
          await ui.keyboard.press("Tab");
          await c.check.focus();
          await ui.keyboard.press("Enter");
          await poll(
            () => panel().locator(".profile-cleanup__feedback").innerText(),
            (text) => text === "Cleanup status updated.",
            "Actual locked-state getter",
          );
          const feedback = panel().locator(".profile-cleanup__feedback");
          await capture(key, "recovery-status", feedback);
          record(
            "Recovery Check status feedback visible",
            (await geometry(feedback)).visible,
            { key },
          );
          report.cases.push({
            key,
            native,
            locked: true,
            pending: true,
            realRetry: true,
          });
        }
    await close(true);
  }
  const current = await qualifyPackage({ root: workspace, reportName });
  assert.equal(current.reportSha256, candidate.reportSha256);
  report.packageStable = true;
  assert.deepEqual(report.errors, []);
  report.failures = report.checks.filter((check) => !check.pass);
  report.status = report.failures.length ? "SURFACE_DEFECTS" : "PASS";
  if (report.failures.length) process.exitCode = 1;
} catch (error) {
  report.status = "FAIL";
  report.error = String(error.stack || error);
  process.exitCode = 1;
  try {
    if (ui) {
      const file = "failure-full-viewport.png";
      const raw = await app.evaluate(async ({ BaseWindow }, id) => {
        const win = BaseWindow.getAllWindows().find((win) => win.id === id),
          view = win.contentView.children.find(
            (view) =>
              view.webContents?.getURL() === "acira-browser-ui://ui/index.html",
          );
        return (
          await view.webContents.capturePage(undefined, { stayHidden: true })
        )
          .toPNG()
          .toString("base64");
      }, windowId);
      await fs.writeFile(path.join(out, file), Buffer.from(raw, "base64"));
      report.failureSnapshot = await Promise.race([
        ui.evaluate(() => window.acira.getSnapshot()),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(Error("Bounded diagnostic snapshot did not settle")),
            1500,
          ),
        ),
      ]);
      report.failureBody = await Promise.race([
        ui
          .locator("body")
          .innerText()
          .then((value) => value.slice(0, 2000)),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(Error("Bounded diagnostic body did not settle")),
            1500,
          ),
        ),
      ]);
      report.failureText = (await panel().innerText()).slice(0, 2500);
    }
  } catch (diagnostic) {
    report.diagnosticError = diagnostic.message;
  }
} finally {
  clearTimeout(watchdog);
  if (app)
    try {
      await close(true);
    } catch (error) {
      report.cleanupError = error.message;
    }
  report.failures = report.checks.filter((check) => !check.pass);
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      status: report.status,
      out,
      cases: report.cases.length,
      captures: report.captures.length,
      checks: report.checks.length,
      failures: report.failures.slice(0, 6).map((check) => ({
        name: check.name,
        key: check.key,
        state: check.state,
      })),
      error: report.error,
    }),
  );
}
