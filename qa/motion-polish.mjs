import { _electron } from "playwright";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  { BrowserDatabase } = require("../desktop/database.cjs"),
  { createInitialState } = require("../desktop/runtime.cjs"),
  data = path.resolve(".qa-profiles/motion-polish");
await fs.mkdir(data, { recursive: true });
const database = new BrowserDatabase(path.join(data, "browser.sqlite")),
  seed = createInitialState();
Object.assign(seed.settings, {
  appearance: "light",
  colorPreset: "Burgundy",
  accentColor: "#4d1821",
  browserTint: "#4d1821",
  reducedMotion: false,
});
database.saveWindow("main", seed);
database.close();
const pending = [];
const server = http.createServer((req, res) => {
  if (req.url === "/slow.js") {
    res.setHeader("Content-Type", "application/javascript");
    pending.push(res);
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<!doctype html><title>Slow navigation</title><script src="/slow.js"></script><h1>Website loaded</h1>',
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let app;
const report = { checks: [], motion: {}, placements: [] };
try {
  app = await _electron.launch({
    executablePath: process.env.ACIRA_TEST_EXECUTABLE,
    args: [path.resolve("desktop/main.cjs")],
    env: {
      ...process.env,
      ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data,
      ACIRA_BROWSER_TEST_HIDDEN: "1",
    },
  });
  const ui = await app.firstWindow();
  await ui.waitForFunction(() => Boolean(window.acira));
  await ui.emulateMedia({ reducedMotion: "no-preference" });
  await ui.locator(".ed-start-composition").waitFor();
  report.motion = await ui.evaluate(async () => ({
    stored: (await window.acira.getSnapshot()).settings.reducedMotion,
    effective: document.querySelector(".app").dataset.reducedMotion,
    os: matchMedia("(prefers-reduced-motion: reduce)").matches,
  }));
  assert.equal(report.motion.effective, "false");
  await ui.evaluate(() =>
    window.acira.dispatch({ type: "tab.new", url: "acira://settings" }),
  );
  const search = ui.getByRole("textbox", { name: "Search settings" });
  await search.waitFor();
  const computed = await search.evaluate((input) => {
    const a = getComputedStyle(input),
      b = getComputedStyle(input.parentElement);
    return {
      input: a.backgroundColor,
      inputShadow: a.boxShadow,
      wrapper: b.backgroundColor,
    };
  });
  assert.equal(computed.input, "rgba(0, 0, 0, 0)");
  assert.equal(computed.inputShadow, "none");
  assert.notEqual(computed.wrapper, "rgba(0, 0, 0, 0)");
  await search.focus();
  assert.equal(
    await search.evaluate((input) => getComputedStyle(input).backgroundColor),
    "rgba(0, 0, 0, 0)",
  );
  report.checks.push(
    "one Settings search surface in normal and focused states",
  );
  await ui
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Profiles", exact: true })
    .click();
  await ui.waitForTimeout(35);
  const exit = await ui.locator(".content-transition").evaluateAll((nodes) =>
    nodes.map((node) => ({
      closing: node.getAttribute("aria-hidden"),
      animations: node.getAnimations({ subtree: true }).length,
    })),
  );
  assert.ok(
    exit.some((node) => node.closing === "true" && node.animations > 0),
  );
  await ui.getByRole("heading", { name: "Profiles", exact: true }).waitFor();
  report.motion.sectionExit = exit;
  report.checks.push(
    "Settings exit remains mounted and animates before next section enters",
  );
  await ui.evaluate(
    (url) => window.acira.dispatch({ type: "tab.new", url }),
    `http://127.0.0.1:${server.address().port}/slow`,
  );
  await ui
    .locator(".navigation-progress[data-placement=address]")
    .waitFor({ state: "attached" });
  await ui.locator(".navigation-progress[data-placement=address]").waitFor();
  const canvas = ui.locator(".address-security canvas.dot-matrix");
  await canvas.waitFor();
  report.motion.matrix = await canvas.evaluate(
    (node) =>
      new Promise((resolve) => {
        const observer = new IntersectionObserver(([entry]) => {
          observer.disconnect();
          const ancestors = [];
          for (let current = node; current; current = current.parentElement) {
            const style = getComputedStyle(current);
            ancestors.push({
              class: current.className,
              rect: current.getBoundingClientRect().toJSON(),
              overflow: style.overflow,
              visibility: style.visibility,
              display: style.display,
            });
          }
          resolve({
            intersecting: entry.isIntersecting,
            root: entry.rootBounds?.toJSON(),
            intersection: entry.intersectionRect.toJSON(),
            document: document.visibilityState,
            preset: node.dataset.preset,
            ancestors,
          });
        });
        observer.observe(node);
      }),
  );
  const first = await canvas.evaluate((node) => node.toDataURL());
  let changed = false;
  for (let sample = 0; sample < 8 && !changed; sample++) {
    await ui.waitForTimeout(180);
    changed = first !== (await canvas.evaluate((node) => node.toDataURL()));
  }
  report.motion.matrixChanged = changed;
  report.motion.progressOpacity = await ui
    .locator(".navigation-progress")
    .evaluate((node) => getComputedStyle(node).opacity);
  report.motion.tabWidth = await ui
    .locator(".browser-tab.selected")
    .evaluate((node) => ({
      rect: node.getBoundingClientRect().toJSON(),
      width: getComputedStyle(node).getPropertyValue("--tab-width"),
      animations: node
        .getAnimations()
        .map((animation) => ({
          currentTime: animation.currentTime,
          playState: animation.playState,
          timing: animation.effect?.getComputedTiming(),
        })),
    }));
  if (changed)
    report.checks.push(
      "dot matrix changes actual canvas frames during a real slow navigation",
    );
  const address = await ui
    .locator(".navigation-progress[data-placement=address]")
    .boundingBox();
  assert.ok(address);
  assert.equal(
    await ui.locator(".navigation-progress[data-placement=boundary]").count(),
    0,
  );
  report.placements.push({ mode: "expanded", address });
  await ui.evaluate(() =>
    window.acira.dispatch({ type: "ui.update", patch: { focusMode: true } }),
  );
  await ui.locator(".navigation-progress[data-placement=boundary]").waitFor();
  await ui.waitForTimeout(350);
  const boundary = await ui
      .locator(".navigation-progress[data-placement=boundary]")
      .boundingBox(),
    layout = await ui.evaluate(() => window.acira.getBrowserLayout());
  assert.equal(
    await ui.locator(".navigation-progress[data-placement=address]").count(),
    0,
  );
  assert.ok(
    Math.abs(boundary.y + boundary.height - layout.views[0].bounds.y) <= 1,
  );
  report.placements.push({
    mode: "focus",
    boundary,
    nativePageTop: layout.views[0].bounds.y,
  });
  await ui.evaluate(async () => {
    const state = await window.acira.getSnapshot();
    await window.acira.browserCommand({
      type: "stop",
      tabId: state.activeTabId,
    });
  });
  await ui.locator(".navigation-progress").waitFor({ state: "detached" });
  report.checks.push(
    "cancel removes progress, without a second lower loading bar",
  );
  await fs.mkdir(path.resolve("qa/artifacts"), { recursive: true });
  await fs.writeFile(
    path.resolve("qa/artifacts/motion-polish.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  assert.ok(changed, "the loading matrix must change frames");
} finally {
  for (const res of pending) res.end("void 0");
  await app?.close();
  server.close();
}
