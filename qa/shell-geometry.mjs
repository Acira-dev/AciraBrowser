import { _electron } from "playwright";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  { BrowserDatabase } = require("../desktop/database.cjs"),
  { createInitialState } = require("../desktop/runtime.cjs");
const data = path.resolve(".qa-profiles/shell-geometry"),
  report = { profiles: [], tabs: [], focus: [] };
await fs.mkdir(data, { recursive: true });
const database = new BrowserDatabase(path.join(data, "browser.sqlite")),
  seed = createInitialState();
Object.assign(seed.settings, { appearance: "dark", reducedMotion: true });
database.saveWindow("main", seed);
database.close();
const server = http.createServer((_req, res) =>
  res.end(
    "<!doctype html><title>Geometry fixture</title><h1>Acira geometry fixture</h1>",
  ),
);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let app;
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
  await ui.locator(".ed-start-composition").waitFor();
  const dispatch = (action) =>
    ui.evaluate((action) => window.acira.dispatch(action), action);
  const openProfiles = async (count, scale) => {
    console.log(`Profiles: ${count}, scale ${scale}`);
    await ui
      .getByRole("button", { name: "Switch profile", exact: true })
      .click();
    const overlay = app
      .context()
      .pages()
      .find((page) => page.url().includes("view=overlay"));
    assert.ok(overlay);
    const popup = overlay.getByRole("dialog", {
      name: "Profiles",
      exact: true,
    });
    await popup.waitFor();
    await overlay.waitForTimeout(250);
    const measured = await popup.evaluate((root) => {
      const viewport = root.querySelector(".popup-scroll"),
        content = root.querySelector(".popup-body-content"),
        surface = root.closest(".popup-surface"),
        header = root.querySelector(".popup-header");
      return {
        viewport: viewport.getBoundingClientRect().toJSON(),
        scrollHeight: viewport.scrollHeight,
        clientHeight: viewport.clientHeight,
        content: content.getBoundingClientRect().toJSON(),
        surface: surface.getBoundingClientRect().toJSON(),
        header: header.getBoundingClientRect().toJSON(),
        overflow: root.querySelector(".scroll-region").dataset.overflowBottom,
      };
    });
    const native = await ui.evaluate(() => window.acira.getBrowserLayout());
    assert.ok(
      Math.abs(native.overlay.bounds.height - measured.surface.height) < 1,
    );
    if (count <= 2) {
      assert.ok(
        measured.scrollHeight <= measured.clientHeight + 1,
        JSON.stringify({ count, scale, measured }),
      );
      assert.equal(measured.overflow, "false");
    } else {
      assert.ok(measured.scrollHeight > measured.clientHeight);
      assert.equal(measured.overflow, "true");
      await popup.locator(".profile-row").last().focus();
      await popup.locator(".profile-row").last().press("ArrowUp");
      const row = await popup
        .locator(".profile-row")
        .nth(count - 2)
        .boundingBox();
      assert.ok(
        row.y >= measured.viewport.y - 1 &&
          row.y + row.height <= measured.viewport.bottom + 1,
      );
    }
    report.profiles.push({
      count,
      scale,
      ...measured,
      nativeHeight: native.overlay.bounds.height,
    });
    await popup
      .getByRole("button", { name: "Close menu", exact: true })
      .click();
    await popup.waitFor({ state: "hidden" });
  };
  await openProfiles(1, 100);
  await dispatch({
    type: "browser.profile.create",
    name: "A second profile with a long but ordinary name",
  });
  await openProfiles(2, 100);
  for (let count = 3; count <= 18; count++)
    await dispatch({
      type: "browser.profile.create",
      name: `Profile ${count} for many-profile scrolling`,
    });
  await openProfiles(18, 100);
  // All tabs use a deterministic local page; tests do not touch browsing accounts.
  await dispatch({
    type: "tab.navigate",
    url: `http://127.0.0.1:${server.address().port}/`,
  });
  await ui.waitForTimeout(250);
  const checkTabs = async (count, mode) => {
    const root =
      mode === "standard"
        ? ui.locator(".tab-strip-container:not(.vertical)")
        : ui.locator(".acira-focus-row .acira-compact-tabs");
    const result = await root.evaluate((node, mode) => {
      const viewport = node.querySelector(
          mode === "standard"
            ? ".tab-strip-viewport"
            : ".acira-compact-tabs-viewport",
        ),
        tabs = [...node.querySelectorAll("[role=tab]")],
        last = tabs.at(-1),
        add = node.querySelector(
          mode === "standard" ? ".tab-strip-add" : ".acira-compact-new",
        ),
        a = add.getBoundingClientRect(),
        b = last.getBoundingClientRect(),
        v = viewport.getBoundingClientRect();
      return {
        overflow: node.dataset.scrollable,
        gap: a.x - b.right,
        add: a.toJSON(),
        viewport: v.toJSON(),
        last: b.toJSON(),
        scrollWidth: viewport.scrollWidth,
        clientWidth: viewport.clientWidth,
      };
    }, mode);
    if (result.overflow === "false")
      assert.ok(
        result.gap >= -1 && result.gap <= 8,
        JSON.stringify({ count, mode, result }),
      );
    else
      assert.ok(
        result.add.x >= result.viewport.right - 1 &&
          result.add.right <= (await ui.evaluate(() => innerWidth)),
      );
    report.tabs.push({ count, mode, ...result });
  };
  for (const count of [1, 2, 32]) {
    let state = await ui.evaluate(() => window.acira.getSnapshot());
    while (state.tabs.length < count) {
      await dispatch({
        type: "tab.new",
        url: `http://127.0.0.1:${server.address().port}/`,
      });
      state = await ui.evaluate(() => window.acira.getSnapshot());
    }
    await ui.waitForTimeout(100);
    await checkTabs(count, "standard");
    await ui
      .locator(".acira-persistent-toolbar")
      .getByRole("button", { name: "Enter Compact view", exact: true })
      .click();
    await ui.waitForFunction(
      () => document.querySelector(".browser-shell").dataset.layout === "focus",
    );
    await ui.waitForTimeout(100);
    await checkTabs(count, "focus");
    const insets = await ui
      .locator(".focus-actions .compact-view-toggle")
      .evaluate((node) => {
        const button = node.getBoundingClientRect(),
          row = node.closest(".focus-toolbar").getBoundingClientRect();
        return {
          top: button.top - row.top,
          bottom: row.bottom - button.bottom,
          height: button.height,
          row: row.toJSON(),
        };
      });
    assert.ok(
      insets.top >= 3 &&
        insets.bottom >= 3 &&
        Math.abs(insets.top - insets.bottom) < 1,
      JSON.stringify(insets),
    );
    report.focus.push({ count, ...insets });
    await ui
      .locator(".focus-actions")
      .getByRole("button", { name: "Exit Compact view", exact: true })
      .click();
    await ui.waitForFunction(
      () =>
        document.querySelector(".browser-shell").dataset.layout === "standard",
    );
  }
  for (const scale of [125, 150]) {
    await dispatch({
      type: "settings.update",
      patch: { interfaceScale: scale },
    });
    await ui.waitForTimeout(150);
    await openProfiles(18, scale);
  }
  await fs.mkdir(path.resolve("qa/artifacts"), { recursive: true });
  await fs.writeFile(
    path.resolve("qa/artifacts/shell-geometry.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app?.close();
  server.close();
}
