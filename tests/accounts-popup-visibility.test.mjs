import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const repo = path.resolve(fileURLToPath(new URL("..", import.meta.url))),
  require = createRequire(import.meta.url),
  playwright = pathToFileURL(
    path.join(path.dirname(require.resolve("playwright")), "index.mjs"),
  ).href;
async function fixture(t, ordinaryOptions) {
  const parent = path.join(repo, "qa/artifacts"),
    root = await fs.mkdir(parent, { recursive: true }).then(() => fs.mkdtemp(path.join(parent, "accounts-popup-visibility-")));
  assert.equal(path.dirname(root), parent);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "desktop"));
  await fs.mkdir(path.join(root, "qa/artifacts"), { recursive: true });
  // This source is inspected as text only; the launch callback is intercepted.
  await fs.writeFile(
    path.join(root, "desktop/main.cjs"),
    "wc.setWindowOpenHandler(details=>({action:'allow',overrideBrowserWindowOptions:{" +
      ordinaryOptions +
      "}}));wc.on('did-create-window',()=>{});child.webContents.setWindowOpenHandler(details=>({action:'allow',overrideBrowserWindowOptions:{show:process.env.ACIRA_BROWSER_TEST_HIDDEN!=='1'}}));",
  );
  const sentinel = path.join(root, "NATIVE_LAUNCH_INTERCEPTED"),
    preload = path.join(root, "intercept.mjs");
  await fs.writeFile(
    preload,
    "import {_electron} from " +
      JSON.stringify(playwright) +
      ';import fs from "node:fs";_electron.launch=async()=>{fs.writeFileSync(' +
      JSON.stringify(sentinel) +
      ',"intercepted; no executable launched");throw Error("EXPECTED_NATIVE_LAUNCH_INTERCEPT");};',
  );
  const run = () =>
    spawnSync(
      process.execPath,
      [
        "--import",
        pathToFileURL(preload).href,
        path.join(repo, "qa/accounts-popup-compat.mjs"),
      ],
      {
        cwd: root,
        env: process.env,
        windowsHide: true,
        encoding: "utf8",
        timeout: 10000,
      },
    );
  return { root, sentinel, run };
}
test("ordinary popup CLI refuses before launch/profile creation even when an extension popup has a hidden guard", async (t) => {
  const f = await fixture(t, "width:640,height:760"),
    result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /NOT RUN: ordinary popup QA requires creation-time/,
  );
  await assert.rejects(fs.access(f.sentinel), { code: "ENOENT" });
  await assert.rejects(fs.access(path.join(f.root, ".qa-profiles")), {
    code: "ENOENT",
  });
});
test("a verified ordinary creation guard reaches only the intercepted launcher; no real window is opened", async (t) => {
  const f = await fixture(
      t,
      "show:process.env.ACIRA_BROWSER_TEST_HIDDEN!=='1',width:640,height:760",
    ),
    result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EXPECTED_NATIVE_LAUNCH_INTERCEPT/);
  assert.equal(
    await fs.readFile(f.sentinel, "utf8"),
    "intercepted; no executable launched",
  );
});
