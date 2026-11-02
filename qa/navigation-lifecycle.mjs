import { _electron } from "playwright";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { poll, nativePage } from "./native-helpers.mjs";
const require = createRequire(import.meta.url),
  { BrowserDatabase } = require("../desktop/database.cjs"),
  { createInitialState } = require("../desktop/runtime.cjs");
const pending = new Set(),
  server = http.createServer((req, res) => {
    if (req.url.startsWith("/hold")) {
      res.setHeader("Content-Type", "application/javascript");
      pending.add(res);
      res.on("close", () => pending.delete(res));
      return;
    }
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/fast" });
      res.end();
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<!doctype html><title>Navigation fixture</title>${req.url.startsWith("/slow") ? '<script src="/hold-script"></script>' : ""}<h1>Navigation fixture</h1>`,
    );
  });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`,
  data = path.resolve(".qa-profiles/navigation-lifecycle");
await fs.mkdir(data, { recursive: true });
const database = new BrowserDatabase(path.join(data, "browser.sqlite"));
database.saveWindow("main", createInitialState());
database.close();
let app;
const report = { runtime: {}, checks: [], states: [] };
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
  report.runtime = await app.evaluate(() => ({
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    executable: process.execPath,
  }));
  const active = () =>
    ui.evaluate(async () => {
      const state = await window.acira.getSnapshot();
      return state.tabs.find((tab) => tab.id === state.activeTabId);
    });
  const navigate = async (route) => {
    await ui.evaluate(
      (url) => window.acira.dispatch({ type: "tab.navigate", url }),
      base + route,
    );
    return nativePage(app, base + route);
  };
  const idle = async (label) => {
    const tab = await poll(
      active,
      (tab) => !tab.loading && tab.progress === undefined,
      label,
    );
    await ui
      .locator(".navigation-progress")
      .waitFor({ state: "hidden", timeout: 3000 }); // a finished line stays in the DOM, hidden outright (data-active="false")
    report.states.push({
      label,
      url: tab.url,
      loading: tab.loading,
      progress: tab.progress ?? null,
      error: tab.error,
    });
  };
  let page = await navigate("/fast");
  await page.waitForLoadState("load");
  await idle("cold page finished");
  await page.evaluate(() => {
    history.pushState({}, "", "/spa");
    window.pendingStream = fetch("/hold-stream");
  });
  await ui.waitForTimeout(600);
  await idle("SPA URL change with long-lived fetch");
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.src = "/hold-frame";
    document.body.append(frame);
  });
  await ui.waitForTimeout(500);
  await idle("late subframe does not restart main navigation indicators");
  report.checks.push(
    "cold navigation, SPA URL changes and long-lived background requests leave no stranded indicators",
  );
  await navigate("/slow-one");
  await poll(
    active,
    (tab) =>
      tab.loading && typeof tab.progress === "number" && tab.progress < 1,
    "slow navigation started",
  );
  await ui.locator(".address-security canvas.dot-matrix").waitFor();
  await ui.locator(".navigation-progress").waitFor();
  report.checks.push(
    "slow main navigation displays both actual loading matrix and progress",
  );
  await navigate("/slow-two");
  await ui.waitForTimeout(300);
  let state = await active();
  assert.equal(state.loading, true);
  assert.ok(state.progress > 0 && state.progress < 1);
  assert.equal(state.url, base + "/slow-two");
  report.checks.push(
    "replacing a slow navigation cannot be completed by its predecessor",
  );
  await ui.evaluate(async () => {
    const state = await window.acira.getSnapshot();
    await window.acira.browserCommand({
      type: "stop",
      tabId: state.activeTabId,
    });
  });
  await idle("explicit cancel");
  page = await navigate("/fast?after-stop");
  await page.waitForLoadState("load");
  await idle("navigation after stop");
  await ui.evaluate(
    (url) => window.acira.dispatch({ type: "tab.navigate", url }),
    base + "/redirect",
  );
  await idle("redirect");
  assert.equal((await active()).url, base + "/fast");
  report.checks.push(
    "stop, subsequent navigation and redirect settle consistently",
  );
  await ui.evaluate(async () => {
    const state = await window.acira.getSnapshot();
    await window.acira.browserCommand({
      type: "reload",
      tabId: state.activeTabId,
    });
  });
  await idle("cached reload");
  await ui.evaluate(() =>
    window.acira.dispatch({
      type: "tab.navigate",
      url: "http://127.0.0.1:1/unreachable",
    }),
  );
  await poll(active, (tab) => Boolean(tab.error), "real navigation failure");
  await idle("connection failure");
  report.checks.push(
    "cached reload and real connection failure clear the shared navigation state",
  );
  await fs.mkdir(path.resolve("qa/artifacts"), { recursive: true });
  await fs.writeFile(
    path.resolve("qa/artifacts/navigation-lifecycle.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const res of pending) res.end("void 0");
  await app?.close();
  server.close();
}
