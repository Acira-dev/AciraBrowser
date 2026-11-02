import { _electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { poll } from "./native-helpers.mjs";
import { initializeReleaseProfile } from "./release-initialize-profile.mjs";
import {
  selectQualifiedPackages,
  launchQualifiedPackage,
} from "./accounts-qualified-packages.mjs";

const root = process.cwd(),
  run = Date.now(),
  data = path.join(root, ".qa-profiles/accounts-packaged-" + run),
  out = path.join(root, "qa/artifacts/accounts-packaged-" + run);
const { candidates, rejected } = await selectQualifiedPackages({
    root,
    limit: 1,
  }),
  candidate = candidates[0];
assert.ok(
  candidate,
  "No nonwithdrawn current-runtime-qualified package is available",
);
await fs.mkdir(data, { recursive: true });
await fs.mkdir(out, { recursive: true });
const registration = [];
for (const hive of ["HKCU", "HKLM"])
  for (const name of ["Acira Browser", "AciraBrowser"]) {
    try {
      const value = execFileSync(
        "reg.exe",
        ["query", hive + "\\Software\\RegisteredApplications", "/v", name],
        {
          windowsHide: true,
          stdio: ["ignore", "pipe", "ignore"],
          encoding: "utf8",
        },
      );
      registration.push({
        hive,
        name,
        present: /REG_(?:EXPAND_)?SZ/.test(value),
      });
    } catch {
      registration.push({ hive, name, present: false });
    }
  }
let app;
try {
  // Both the actual initialization-only startup and the functional launch must
  // pass the complete current payload/withdrawal gate independently.
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
      timeout: 30000,
    },
  });
  const ui = await poll(
    async () => {
      for (const page of app.context().pages())
        try {
          if (
            page.url().startsWith("acira-browser-ui:") &&
            (await page.evaluate(() => !!window.acira?.setup))
          )
            return page;
        } catch {}
    },
    Boolean,
    "packaged local setup",
    15000,
  );
  await ui
    .getByRole("heading", { name: "The web, in clear light.", exact: true })
    .waitFor();
  const setup = await ui.evaluate(() => window.acira.setup({ type: "status" }));
  assert.equal(setup.ok, true);
  assert.equal(setup.progress.complete, false);
  const actual = await app.evaluate(({ app, BaseWindow }) => ({
    packaged: app.isPackaged,
    version: app.getVersion(),
    appPath: app.getAppPath(),
    runtime: {
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      node: process.versions.node,
    },
    allHidden: BaseWindow.getAllWindows().every(
      (window) => !window.isVisible(),
    ),
  }));
  assert.equal(actual.packaged, true);
  assert.equal(actual.allHidden, true);
  assert.equal(actual.runtime.electron, candidate.runtimeQualification.version);
  if (
    registration.every((value) => !value.present) &&
    !setup.defaults.isDefault
  )
    assert.equal(
      setup.defaults.supported,
      false,
      "Unconfirmed portable registration cannot advertise supported default selection",
    );
  const result = {
    candidateSource: candidate.sourceDigest,
    packageManifestSha256: candidate.packageManifestSha256,
    runtimeQualification: candidate.runtimeQualification,
    profileInitialization,
    rejected,
    actual,
    defaults: setup.defaults,
    registration,
    osDefaultsChanged: false,
    osSettingsOpened: false,
    note: "Read-only own-product registration query; neither default.request nor a registry write was called.",
  };
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ ...result, artifacts: out }, null, 2));
} finally {
  await app?.close().catch(() => {});
}
