import { _electron } from "playwright";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { poll, nativePage } from "./native-helpers.mjs";
const require = createRequire(import.meta.url),
  { BrowserDatabase } = require("../desktop/database.cjs"),
  { createInitialState, reduceBrowser } = require("../desktop/runtime.cjs");
const server = http.createServer((_req, res) =>
  res.end(
    '<!doctype html><title>Interaction fixture</title><h1>Fixture</h1><input aria-label="Website input">',
  ),
);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`,
  data = path.resolve(".qa-profiles/sidebar-new-tab");
await fs.mkdir(data, { recursive: true });
const database = new BrowserDatabase(path.join(data, "browser.sqlite"));
let seed = reduceBrowser(createInitialState(), { type: "tab.navigate", url });
seed.settings.reducedMotion = true;
database.saveWindow("main", seed);
database.close();
let app;
const report = { checks: [] };
try {
  app = await _electron.launch({
    args: [path.resolve("desktop/main.cjs")],
    env: {
      ...process.env,
      ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data,
      ACIRA_BROWSER_TEST_HIDDEN: "1",
    },
  });
  const ui = await app.firstWindow();
  ui.setDefaultTimeout(6000);
  await ui.waitForFunction(() => Boolean(window.acira));
  const dispatch = (action) =>
      ui.evaluate((action) => window.acira.dispatch(action), action),
    snapshot = () => ui.evaluate(() => window.acira.getSnapshot());
  await ui.evaluate(() => {
    localStorage.setItem(
      "acira-rail-prefs",
      JSON.stringify({ tabs: true, folded: {} }),
    );
    window.dispatchEvent(new Event("acira-rail-prefs"));
  });
  await dispatch({
    type: "ui.update",
    patch: { workspaceOpen: true, webWorkspaceOpen: true },
  });
  console.log("Sidebar: tab context action");
  await ui.locator(".ed-rail-tab").first().click({ button: "right" });
  const overlay = app
    .context()
    .pages()
    .find((page) => page.url().includes("view=overlay"));
  overlay.setDefaultTimeout(6000);
  await overlay
    .getByRole("dialog", { name: "Tab actions", exact: true })
    .waitFor();
  await overlay.getByRole("button", { name: "Pin tab", exact: true }).click();
  await poll(snapshot, (s) => s.tabs[0].pinned, "tab pinned");
  report.checks.push("sidebar right click opens working tab commands");
  const id = (await snapshot()).activeTabId;
  await dispatch({
    type: "tab.group.create",
    tabId: id,
    name: "Project",
    color: "blue",
  });
  await ui.locator("[data-sidebar-group]").waitFor();
  console.log("Sidebar: group context and rename");
  await ui
    .locator("[data-sidebar-group] .ed-rail-tab-group-name")
    .click({ button: "right" });
  await overlay
    .getByRole("dialog", { name: "Group actions", exact: true })
    .waitFor();
  const name = overlay.getByRole("textbox", {
    name: "Group name",
    exact: true,
  });
  await name.fill("Renamed project");
  await name.press("Enter");
  await overlay
    .getByRole("dialog", { name: "Group actions", exact: true })
    .press("Escape");
  await poll(
    snapshot,
    (s) => s.tabGroups[0].name === "Renamed project",
    "group renamed",
  );
  await ui.getByRole("button", { name: /^Renamed project, / }).click();
  assert.equal((await snapshot()).tabGroups[0].collapsed, true);
  await ui
    .locator(".ed-rail-group-members[aria-hidden=true]")
    .waitFor({ state: "attached" });
  await ui.getByRole("button", { name: /^Renamed project, / }).click();
  assert.equal((await snapshot()).tabGroups[0].collapsed, false);
  report.checks.push(
    "sidebar group menu renames the persisted group and disclosure uses its actual collapsed state",
  );
  await dispatch({
    type: "ui.update",
    patch: { workspaceOpen: false, webWorkspaceOpen: false },
  });
  for (const mode of ["standard", "focus", "compact"]) {
    const pageURL = url + "?mode=" + mode;
    console.log("New tab:", mode);
    await dispatch({
      type: "settings.update",
      patch: { toolbarLayout: mode === "compact" ? "automatic" : "expanded" },
    });
    await dispatch({
      type: "ui.update",
      patch: { focusMode: false },
    });
    await dispatch({ type: "tab.navigate", url: pageURL });
    const page = await nativePage(app, pageURL);
    assert.equal(
      await page.evaluate(() => document.title),
      "Interaction fixture",
    );
    await page.mouse.click(40, 40);
    if (mode === "compact")
      await ui.waitForFunction(
        () =>
          document.querySelector(".browser-shell").dataset.layout === "compact",
      );
    if (mode === "focus") {
      await ui
        .getByRole("button", { name: "Enter Compact view", exact: true })
        .click();
      await ui.waitForFunction(
        () =>
          document.querySelector(".browser-shell").dataset.layout === "focus",
      );
    }
    const previousId = (await snapshot()).activeTabId;
    // The real plus button and native keyboard route are exercised separately.
    if (mode === "focus") {
      await page.mouse.click(40, 40);
      await app.evaluate(({ webContents }, url) => {
        const wc = webContents
          .getAllWebContents()
          .find((wc) => wc.getURL() === url);
        wc.sendInputEvent({
          type: "keyDown",
          keyCode: "T",
          modifiers: ["control"],
        });
        wc.sendInputEvent({
          type: "keyUp",
          keyCode: "T",
          modifiers: ["control"],
        });
      }, pageURL);
    } else
      await ui
        .locator(".browser-shell")
        .getByRole("button", { name: "New tab", exact: true })
        .click();
    await poll(
      () =>
        ui.evaluate(async () => {
          const s = await window.acira.getSnapshot();
          return {
            focused: document.activeElement?.matches(".address-bar input"),
            active: document.activeElement?.outerHTML?.slice(0, 200),
            layout: document.querySelector(".browser-shell").dataset.layout,
            tab: s.tabs.find((t) => t.id === s.activeTabId),
          };
        }),
      (s) =>
        s.focused && s.tab.id !== previousId && s.tab.url === "acira://new",
      "foreground address focus",
    );
    await ui.waitForTimeout(1400);
    assert.equal(
      await ui.evaluate(() =>
        document.activeElement?.matches(".address-bar input"),
      ),
      true,
    );
    assert.equal(
      await ui.locator(".browser-shell").getAttribute("data-layout"),
      "standard",
    );
    const pending = (await snapshot()).activeTabId;
    await ui.keyboard.type("delayed typing");
    assert.equal(
      await ui.locator(".address-bar input").inputValue(),
      "delayed typing",
    );
    await dispatch({ type: "tab.new", url, background: true });
    assert.equal((await snapshot()).activeTabId, pending);
    assert.equal(
      await ui.evaluate(() =>
        document.activeElement?.matches(".address-bar input"),
      ),
      true,
    );
    await ui.locator(".address-bar input").fill(pageURL);
    await ui.locator(".address-bar input").press("Enter");
    await poll(
      snapshot,
      (s) =>
        s.activeTabId === pending &&
        s.tabs.find((t) => t.id === pending)?.url === pageURL,
      "address navigation committed",
    );
    report.checks.push(
      `${mode}: foreground blank tab focuses top address immediately and after 1.4s; delayed native typing works; background tab leaves focus intact`,
    );
  }
  await fs.mkdir(path.resolve("qa/artifacts"), { recursive: true });
  await fs.writeFile(
    path.resolve("qa/artifacts/sidebar-new-tab.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app?.close();
  server.close();
}
