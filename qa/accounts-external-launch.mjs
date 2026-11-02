import { _electron } from "playwright";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { poll } from "./native-helpers.mjs";

const root = process.cwd(),
  run = Date.now(),
  data = path.join(root, ".qa-profiles/accounts-external-" + run),
  out = path.join(root, "qa/artifacts/accounts-external-" + run);
await fs.mkdir(data, { recursive: true });
await fs.mkdir(out, { recursive: true });
const { createSetupService } = createRequire(import.meta.url)(
  "../desktop/accounts/setup.cjs",
);
await createSetupService({ directory: path.join(data, "setup") }).command(
  { type: "skip" },
  { profileId: "profile-personal", privateMode: false },
);
const visits = [];
const server = http.createServer((request, response) => {
  visits.push(request.url);
  response.setHeader("Content-Type", "text/html");
  response.setHeader("Cache-Control", "no-store");
  response.end(
    "<!doctype html><title>External web-link fixture</title><h1>External web-link fixture</h1>",
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port,
  cold = base + "/cold?state=preserved#fragment",
  warm = base + "/warm?value=2";
const executablePath =
  process.env.ACIRA_TEST_EXECUTABLE ||
  path.join(root, "node_modules/electron/dist/electron.exe");
const env = {
  ...process.env,
  ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data,
  ACIRA_BROWSER_TEST_HIDDEN: "1",
  ACIRA_MATERIAL: "none",
};
let app;
try {
  app = await _electron.launch({
    executablePath,
    args: [path.join(root, "desktop/main.cjs"), cold],
    env,
    timeout: 30000,
  });
  const ui = await poll(
    async () => {
      for (const page of app.context().pages())
        try {
          if (
            page.url().startsWith("acira-browser-ui:") &&
            (await page.evaluate(() => !!window.acira?.getSnapshot))
          )
            return page;
        } catch {}
    },
    Boolean,
    "owned source chrome",
    15000,
  );
  const observed = async (url, route) => {
    try {
      await poll(
        () => ui.evaluate(() => window.acira.getSnapshot()),
        (state) =>
          state.tabs.some((tab) => tab.url === url) &&
          visits.some((value) => value.startsWith(route)),
        "external URL " + route,
        5000,
      );
      return true;
    } catch {
      return false;
    }
  };
  const coldOpened = await observed(cold, "/cold");
  const child = spawn(
    executablePath,
    [path.join(root, "desktop/main.cjs"), warm],
    { env, windowsHide: true, stdio: "ignore" },
  );
  const secondaryExit = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve("timeout");
    }, 7000);
    child.once("error", () => {
      clearTimeout(timer);
      resolve("spawn-error");
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  const warmOpened = await observed(warm, "/warm");
  const state = await ui.evaluate(() => window.acira.getSnapshot());
  assert.equal(
    await app.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows().every((window) => !window.isVisible()),
    ),
    true,
  );
  const result = {
    coldOpened,
    warmOpened,
    secondaryExit,
    visits,
    actualTabs: state.tabs.map((tab) => ({
      url: tab.url,
      error: tab.error,
      browserProfileId: tab.browserProfileId,
    })),
    nativeRendererIdentity: createHash("sha256")
      .update(await fs.readFile(path.join(root, "desktop/main.cjs")))
      .update(await fs.readFile(path.join(root, "dist/index.html")))
      .digest("hex"),
    visibleWindows: false,
    osDefaultsChanged: false,
  };
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ ...result, artifacts: out }, null, 2));
  assert.equal(
    coldOpened,
    true,
    "Cold HTTP launch argument must navigate after profile restore",
  );
  assert.equal(
    warmOpened,
    true,
    "Running-instance HTTP argument must open in a normal profile",
  );
  assert.equal(secondaryExit, 0);
} finally {
  await app?.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
