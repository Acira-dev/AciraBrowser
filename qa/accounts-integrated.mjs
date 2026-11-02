import { launchPreparedNative } from "./prepared-native.mjs";
import { qualifiedElectron } from "./release-runtime.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { poll } from "./native-helpers.mjs";

const require = createRequire(import.meta.url),
  { BrowserDatabase } = require("../desktop/database.cjs"),
  { createInitialState } = require("../desktop/runtime.cjs");
const root = process.cwd(),
  run = Date.now(),
  directory = path.join(root, ".qa-profiles/accounts-integrated-" + run),
  upgraded = directory + "-upgrade",
  out = path.join(root, "qa/artifacts/accounts-integrated-" + run);
await fs.mkdir(directory, { recursive: true });
await fs.mkdir(upgraded, { recursive: true });
await fs.mkdir(out, { recursive: true });
const checks = [],
  defects = [],
  errors = [];
const setupSourcePaths = [
  "desktop/accounts/default-browser.cjs",
  "desktop/accounts/errors.cjs",
  "desktop/accounts/onboarding.cjs",
  "desktop/accounts/setup.cjs",
  "desktop/main.cjs",
  "desktop/preload.cjs",
  "desktop/ui-preload-entry.cjs",
  "desktop/ui-preload.cjs",
  "desktop/runtime.cjs",
  "desktop/startup-gate.cjs",
  "desktop/browser-services/encryption-bootstrap.cjs",
  "src/features/onboarding/Onboarding.tsx",
  "dist/index.html",
];
const html = await fs.readFile(path.join(root, "dist/index.html"), "utf8");
for (const asset of new Set(
  html.match(/assets\/[A-Za-z0-9._-]+\.(?:js|css)/g) || [],
))
  setupSourcePaths.push("dist/" + asset);
async function setupSourceHashes() {
  return Object.fromEntries(
    await Promise.all(
      setupSourcePaths.map(async (file) => [
        file,
        createHash("sha256")
          .update(await fs.readFile(path.join(root, file)))
          .digest("hex"),
      ]),
    ),
  );
}
const localSetupSources = await setupSourceHashes();
const runtime = await qualifiedElectron();
let app;
async function launch(data = directory) {
  app = await launchPreparedNative({
    executablePath: runtime.executablePath,
    args: [path.join(root, "desktop/main.cjs")],
    env: {
      ...process.env,
      ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data,
      ACIRA_BROWSER_TEST_HIDDEN: "1",
      ACIRA_MATERIAL: "none",
    },
    timeout: 30000,
  });
  const page = await poll(
    async () => {
      for (const page of app.context().pages())
        try {
          if (
            await page.evaluate(
              () => !!window.acira?.setup && !!window.acira?.getSnapshot,
            )
          )
            return page;
        } catch {}
    },
    Boolean,
    "integrated local setup bridge",
    15000,
  );
  page.on("pageerror", (error) => errors.push(error.message));
  return page;
}
async function snapshot(page) {
  return page.evaluate(() => window.acira.getSnapshot());
}
async function hidden() {
  assert.equal(
    await app.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows().every((window) => !window.isVisible()),
    ),
    true,
  );
}
try {
  let page = await launch();
  await page
    .getByRole("heading", { name: "The web, in clear light.", exact: true })
    .waitFor();
  await poll(
    () => page.evaluate(() => window.acira.getBrowserLayout()),
    (layout) => layout.visible === false,
    "native websites hidden behind setup",
  );
  await hidden();
  checks.push(
    "fresh installed-graph setup mounts and hides native website views",
  );
  const defaultStatus = await page.evaluate(() =>
    window.acira.setup({ type: "status" }),
  );
  assert.equal(defaultStatus.ok, true);
  assert.equal(defaultStatus.defaults.supported, false);
  assert.equal(defaultStatus.defaults.statusKnown, true);
  assert.match(defaultStatus.defaults.note, /Install Acira/);
  checks.push(
    "actual native setup uses the registration-aware helper and honestly discloses development default-browser limits",
  );
  assert.equal(
    await page
      .getByRole("button", { name: /sign in|connect account|sync/i })
      .count(),
    0,
  );
  checks.push("fresh setup has no Acira-account or cloud controls");
  const firstButton = page.getByRole("button", {
    name: "Skip setup",
    exact: true,
  });
  await firstButton.focus();
  await page.keyboard.press("Shift+Tab");
  const focusInside = await page.evaluate(
    () => !!document.activeElement?.closest(".acira-onboarding"),
  );
  if (!focusInside)
    defects.push({
      id: "LOCAL-UI-001",
      severity: "P1",
      detail:
        "Shift+Tab from first setup control escapes the modal into underlying browser controls. Add a real focus boundary.",
    });
  else checks.push("setup keyboard focus stays inside its dialog");
  await page
    .getByLabel("New local profile name", { exact: true })
    .fill("Integrated local B");
  await page
    .getByRole("button", { name: "Create local profile", exact: true })
    .click();
  await poll(
    () => snapshot(page),
    (state) =>
      state.browserProfiles.some(
        (profile) => profile.name === "Integrated local B",
      ),
    "actual profile created",
  );
  checks.push(
    "mounted local profile form creates through current native bridge/reducer",
  );
  await page.getByRole("button", { name: "Get started", exact: true }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await poll(
    () => snapshot(page),
    (state) => state.settings.appearance === "dark",
    "actual chosen appearance",
  );
  await app.close();
  app = null;
  page = await launch();
  await page
    .getByRole("heading", { name: "Make Acira feel like yours", exact: true })
    .waitFor();
  assert.equal((await snapshot(page)).settings.appearance, "dark");
  checks.push(
    "mounted setup resumes after actual restart without losing chosen native settings",
  );
  await page.getByRole("button", { name: "Skip setup", exact: true }).click();
  await page.locator(".acira-onboarding").waitFor({ state: "detached" });
  await poll(
    () => page.evaluate(() => window.acira.getBrowserLayout()),
    (layout) => layout.visible === true,
    "normal browser visible after skip",
  );
  const completed = await page.evaluate(() =>
    window.acira.setup({ type: "status" }),
  );
  assert.equal(completed.progress.complete, true);
  checks.push(
    "mounted Skip restores normal browser and persists local completion",
  );
  await app.close();
  app = null;
  page = await launch();
  await page.locator(".page-area").waitFor();
  assert.equal(await page.locator(".acira-onboarding").count(), 0);
  assert.equal(
    (await snapshot(page)).browserProfiles.some(
      (profile) => profile.name === "Integrated local B",
    ),
    true,
  );
  checks.push(
    "completed setup stays skipped and local profiles remain after real restart",
  );
  await page.evaluate(() =>
    window.dispatchEvent(new Event("acira:restart-setup")),
  );
  await page
    .getByRole("heading", { name: "The web, in clear light.", exact: true })
    .waitFor();
  checks.push("explicit local setup restart mounts the same real UI");
  await page.getByRole("button", { name: "Skip setup", exact: true }).click();
  await hidden();
  await app.close();
  app = null;

  const previous = createInitialState();
  previous.settings.appearance = "dark";
  previous.settings.searchEngine = "duckduckgo";
  previous.browserProfiles[0].name = "Existing local profile";
  previous.bookmarkNodes = [
    {
      id: "existing-bookmark",
      browserProfileId: previous.activeBrowserProfileId,
      parentId: null,
      title: "Existing user bookmark",
      url: "https://example.com/existing",
      position: 0,
      createdAt: 1,
    },
  ];
  previous.bookmarks = ["https://example.com/existing"];
  const database = new BrowserDatabase(path.join(upgraded, "browser.sqlite"));
  database.saveWindow("main", previous);
  database.close();
  page = await launch(upgraded);
  await page.locator(".page-area").waitFor();
  const state = await snapshot(page),
    setup = await page.evaluate(() => window.acira.setup({ type: "status" }));
  assert.equal(setup.progress.complete, true);
  assert.equal(setup.progress.upgraded, true);
  assert.equal(await page.locator(".acira-onboarding").count(), 0);
  assert.equal(state.settings.searchEngine, "duckduckgo");
  assert.equal(state.settings.appearance, "dark");
  assert.equal(state.browserProfiles[0].name, "Existing local profile");
  assert.equal(state.bookmarkNodes[0].title, "Existing user bookmark");
  checks.push(
    "existing local SQLite installation skips welcome while preserving profile/bookmarks/search/appearance",
  );
  await hidden();
  assert.deepEqual(errors, []);
  assert.deepEqual(
    await setupSourceHashes(),
    localSetupSources,
    "Local setup sources changed during native qualification; rerun the coherent candidate",
  );
  const identity = createHash("sha256")
    .update(await fs.readFile(path.join(root, "desktop/main.cjs")))
    .update(await fs.readFile(path.join(root, "dist/index.html")))
    .digest("hex");
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        checks,
        defects,
        errors,
        nativeRendererIdentity: identity,
        localSetupSources,
        localSetupSourcesStable: true,
        visibleWindows: false,
        liveGoogle: false,
        installedOSDefaultSelection: false,
        initializedNativeKeyPrecondition: true,
        qualification:
          "Actual setup/profile UI with native key normally initialized before the functional fixture; bare fresh-key startup and credential crash are separate tests",
        runtimeQualification: runtime.qualification,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, defects, artifacts: out }, null, 2));
} catch (error) {
  await fs.writeFile(
    path.join(out, "partial.json"),
    JSON.stringify(
      { checks, defects, errors, failure: error.message },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await app?.close().catch(() => {});
}
