import {launchPreparedNative} from './prepared-native.mjs';
import {nativePage} from './native-helpers.mjs';
import { _electron } from "playwright";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  { BrowserDatabase } = require("../desktop/database.cjs"),
  { createInitialState, reduceBrowser } = require("../desktop/runtime.cjs");
const server = http.createServer((_req, res) =>
  res.end(
    '<!doctype html><title>Menu fixture</title><input aria-label="Website input"><a href="/next">A website link</a>',
  ),
);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const data = path.resolve(".qa-profiles/menu-lifecycle");
await fs.mkdir(data, { recursive: true });
const database = new BrowserDatabase(path.join(data, "browser.sqlite"));
let seed = reduceBrowser(createInitialState(), {
  type: "tab.navigate",
  url: `http://127.0.0.1:${server.address().port}/`,
});
seed.settings.reducedMotion = false;
database.saveWindow("main", seed);
database.close();
let app;
const report = { checks: [], errors: [] };
try {
  app = await launchPreparedNative({
    executablePath: process.env.ACIRA_TEST_EXECUTABLE,
    args: [path.resolve("desktop/main.cjs")],
    env: {
      ...process.env,
      ACIRA_DEV: process.argv.includes("--live") ? "1" : "0",
      ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data,
      ACIRA_BROWSER_TEST_HIDDEN: "1",
    },
  });
  const ui = await nativePage(app,'acira-browser-ui://ui/index.html');
  await app.evaluate(({BaseWindow})=>{const win=BaseWindow.getAllWindows()[0];win.setFocusable(false);win.setIgnoreMouseEvents(true);win.setPosition(-20000,-20000);win.showInactive();if(win.isFocused())throw Error('QA focused');});
  ui.setDefaultTimeout(6000);
  await ui.waitForFunction(() => Boolean(window.acira));
  await ui.emulateMedia({ reducedMotion: "no-preference" });
  for (const page of app.context().pages())
    page.on("pageerror", (error) => report.errors.push(error.message));
  const overlay = () =>
    app
      .context()
      .pages()
      .find((page) => page.url().includes("view=overlay"));
  const visible = async (kind) => {
    const popup = overlay().locator(`.popup-content-${kind}`);
    await popup.waitFor({ timeout: 6000 });
    await overlay().waitForFunction(
      () => {
        const surface = document.querySelector(".popup-surface");
        return (
          surface &&
          !surface.hasAttribute("data-preparing") &&
          !surface.inert &&
          getComputedStyle(surface).visibility === "visible"
        );
      },
      undefined,
      { timeout: 6000 },
    );
    return popup;
  };
  const close = async () => {
    await overlay()
      .getByRole("button", { name: "Close menu", exact: true })
      .click({ timeout: 6000 });
    await ui.waitForFunction(
      async () => !(await window.acira.getBrowserLayout()).overlay,
    );
  };
  console.log("Menu: ordinary open/close");
  await ui.getByRole("button", { name: "Acira menu", exact: true }).click();
  await visible("menu");
  await close();
  report.checks.push("menu opens and closes");
  console.log("Menu: tab right click");
  await ui.locator(".browser-tab.selected").click({ button: "right" });
  await visible("tab-context");
  await overlay()
    .getByRole("button", { name: /^Reload tab/ })
    .click({ timeout: 6000 });
  await ui.waitForFunction(
    async () => !(await window.acira.getBrowserLayout()).overlay,
  );
  report.checks.push("right-click tab actions open and reload the page");
  console.log("Menu: overlay renderer reload while open");
  await ui.getByRole("button", { name: "Acira menu", exact: true }).click();
  await visible("menu");
  await overlay().reload();
  await overlay().waitForFunction(() => Boolean(window.acira));
  await visible("menu");
  await close();
  report.checks.push("open menu recovers after its renderer reload");
  console.log("Menu: chrome renderer reload");
  await ui.reload();
  await ui.waitForFunction(() => Boolean(window.acira));
  await ui.getByRole("button", { name: "Acira menu", exact: true }).click();
  await visible("menu");
  await close();
  report.checks.push("menu opens after browser chrome reload");
  for (const name of ["Switch profile", "Extensions", "Page information"]) {
    console.log("Menu:", name);
    await ui.getByRole("button", { name, exact: true }).click();
    await visible(
      {
        "Switch profile": "profile",
        Extensions: "extensions",
        "Page information": "security",
      }[name],
    );
    await close();
    report.checks.push(`${name} opens and closes`);
  }
  await fs.mkdir(path.resolve("qa/artifacts"), { recursive: true });
  await fs.writeFile(
    path.resolve("qa/artifacts/menu-lifecycle.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  assert.equal(report.errors.length, 0);
} catch (error) {
  console.log(
    JSON.stringify(
      {
        ...report,
        layout: await app
          ?.firstWindow()
          .then((page) => page.evaluate(() => window.acira.getBrowserLayout()))
          .catch(() => null),
        overlay: await app
          ?.context()
          .pages()
          .find((page) => page.url().includes("view=overlay"))
          ?.evaluate(() => ({
            url: location.href,
            html: document
              .querySelector(".popup-surface")
              ?.outerHTML.slice(0, 1500),
          }))
          .catch(() => null),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await app?.close();
  server.close();
}
