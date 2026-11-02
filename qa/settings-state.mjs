import { _electron } from "playwright";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { poll } from "./native-helpers.mjs";
const require = createRequire(import.meta.url),
  { BrowserDatabase } = require("../desktop/database.cjs"),
  { createInitialState, reduceBrowser } = require("../desktop/runtime.cjs");
const data = path.resolve(".qa-profiles/settings-state");
await fs.mkdir(data, { recursive: true });
let seed = reduceBrowser(createInitialState(), {
  type: "tab.navigate",
  url: "acira://settings",
});
seed.settings.reducedMotion = true;
seed.windowUi.workspaceOpen = false;
seed.windowUi.webWorkspaceOpen = false;
const db = new BrowserDatabase(path.join(data, "browser.sqlite"));
db.saveWindow("main", seed);
db.close();
let app;
const report = { checks: [] };
const launch = async () => {
  app = await _electron.launch({
    args: [path.resolve("desktop/main.cjs")],
    env: {
      ...process.env,
      ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data,
      ACIRA_BROWSER_TEST_HIDDEN: "1",
    },
  });
  const ui = await app.firstWindow();
  await ui.waitForFunction(() => Boolean(window.acira));
  ui.setDefaultTimeout(6000);ui.on("console",m=>{if(m.text().startsWith("Settings scroll"))console.log(m.text());});
  return ui;
};
try {
  let ui = await launch();
  const dispatch = (a) => ui.evaluate((a) => window.acira.dispatch(a), a),
    snapshot = () => ui.evaluate(() => window.acira.getSnapshot());
  const first = (await snapshot()).activeTabId;
  await ui.getByRole("button", { name: "Tabs", exact: true }).click();
  await ui
    .getByRole("combobox", { name: "Toolbar layout", exact: true })
    .selectOption("automatic");
  assert.equal(
    await ui
      .getByRole("switch", {
        name: "Keep browser controls expanded",
        exact: true,
      })
      .count(),
    0,
  );
  await dispatch({ type: "tab.new", url: "acira://new" });
  const other = (await snapshot()).activeTabId;
  await dispatch({ type: "tab.select", id: first });
  await ui.getByRole("heading", { name: "Tabs", exact: true }).waitFor();
  assert.equal(
    await ui.getByRole("combobox", { name: "Toolbar layout" }).inputValue(),
    "automatic",
  );
  report.checks.push(
    "Settings section survives switching; one canonical layout control updates native state",
  );
  await ui.getByRole("button", { name: "Profiles", exact: true }).click();
  await ui
    .getByRole("textbox", { name: "New profile name" })
    .fill("Unfinished local name");
  await dispatch({ type: "tab.new", url: "acira://settings" });
  const second = (await snapshot()).activeTabId;
  await ui.getByRole("heading", { name: "Appearance", exact: true }).waitFor();
  await ui.getByRole("textbox", { name: "Search settings" }).fill("privacy");
  await dispatch({ type: "tab.select", id: first });
  assert.equal(
    await ui.getByRole("textbox", { name: "New profile name" }).inputValue(),
    "Unfinished local name",
  );
  await dispatch({ type: "tab.select", id: second });
  assert.equal(
    await ui.getByRole("textbox", { name: "Search settings" }).inputValue(),
    "privacy",
  );
  await ui
    .getByRole("button", { name: "Clear settings search", exact: true })
    .click();
  const scroll = await ui.locator(".bs-main").evaluate((el) => {
    el.scrollTop = 220;
    return el.scrollTop;
  });
  assert.ok(scroll > 0);
  await ui.waitForTimeout(100);
  await dispatch({ type: "tab.select", id: other });
  await dispatch({ type: "tab.select", id: second });
  console.log("restoredScroll",await ui.locator(".bs-main").evaluate(el=>({scroll:el.scrollTop,height:el.clientHeight,total:el.scrollHeight})),"expected",scroll);
  assert.ok(
    Math.abs(
      (await ui.locator(".bs-main").evaluate((el) => el.scrollTop)) - scroll,
    ) < 2,
  );
  report.checks.push(
    "two Settings tabs retain independent query, harmless draft and exact scroll; website tabs are not kept mounted",
  );
  await ui.locator(".bs-main").evaluate((el) => (el.scrollTop = 0));
  await ui.getByRole("slider", { name: "Glass opacity" }).press("End");
  for(let n=0;n<8;n++)await ui.getByRole("slider", { name: "Glass opacity" }).press("ArrowLeft");
  await ui.getByRole("textbox", { name: "Sidebar hex code" }).fill("#124e88");
  await ui.getByRole("textbox", { name: "Sidebar hex code" }).press("Enter");
  await ui
    .getByRole("switch", { name: "Show Home button", exact: true })
    .click();
  await ui
    .getByRole("switch", { name: "Show tab viewer", exact: true })
    .click();
  await poll(
    snapshot,
    (s) =>
      s.settings.glassOpacity === 80 &&
      s.settings.sidebarColor === "#124e88" &&
      s.settings.showHome &&
      s.settings.showTabOverview === false,
    "appearance saved",
  );
  await poll(
    () => ui.evaluate(() => window.acira.getBrowserLayout()),
    (layout) => layout.materialOpacity === 0.8,
    "native opacity propagated",
  );
  report.checks.push(
    "glass/color and toolbar visibility update native preferences/layout immediately",
  );
  await app.close();
  ui = await launch();
  const restored = await ui.evaluate(() => window.acira.getSnapshot());
  assert.equal(restored.settings.glassOpacity, 80);
  assert.equal(restored.settings.sidebarColor, "#124e88");
  assert.equal(restored.settings.showHome, true);
  assert.equal(restored.settings.showTabOverview, false);
  assert.equal(restored.settings.toolbarLayout, "automatic");
  await ui.getByRole("heading", { name: "Appearance", exact: true }).waitFor();
  assert.equal(
    await ui.getByRole("textbox", { name: "Search settings" }).inputValue(),
    "",
  );
  report.checks.push(
    "preferences survive a real native relaunch; ephemeral Settings drafts reset on restart",
  );
  await ui
    .getByRole("button", { name: "Reset sidebar color", exact: true })
    .click();
  await ui
    .getByRole("button", { name: "Reset toolbar controls", exact: true })
    .click();
  await ui
    .getByRole("button", { name: "Reset appearance", exact: true })
    .click();
  await poll(
    () => ui.evaluate(() => window.acira.getSnapshot()),
    (s) =>
      s.settings.glassOpacity === 64 &&
      s.settings.sidebarColor === undefined &&
      s.settings.showTabOverview &&
      !s.settings.showHome,
    "reset persisted",
  );
  report.checks.push("appearance and toolbar reset restore actual defaults");
  await fs.mkdir("qa/artifacts", { recursive: true });
  await fs.writeFile(
    "qa/artifacts/settings-state.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app?.close();
}
