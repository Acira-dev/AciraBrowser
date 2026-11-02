import { _electron } from "playwright";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { nativePage } from "./native-helpers.mjs";
const require = createRequire(import.meta.url),
  { BrowserDatabase } = require("../desktop/database.cjs"),
  { createInitialState, makeTab } = require("../desktop/runtime.cjs");
const server = http.createServer((_q, r) =>
  r.end("<!doctype html><title>Toolbar fixture</title><h1>Fixture</h1>"),
);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`,
  data = path.resolve(".qa-profiles/toolbar-composition");
await fs.mkdir(data, { recursive: true });
let s = createInitialState();
s.settings.reducedMotion = true;
s.settings.showHome = true;
s.windowUi.workspaceOpen = false;
s.windowUi.webWorkspaceOpen = false;
s.tabs = [
  makeTab("tab-site", "", url),
  ...Array.from({ length: 6 }, (_, n) =>
    makeTab(
      `tab-internal-${n}`,
      "",
      n % 2 ? "acira://history" : "acira://settings",
    ),
  ),
];
s.activeTabId = "tab-site";
const db = new BrowserDatabase(path.join(data, "browser.sqlite"));
db.saveWindow("main", s);
db.close();
let app;
const report = { cases: [] };
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
  const page = await nativePage(app, url),
    dispatch = (a) => ui.evaluate((a) => window.acira.dispatch(a), a);
  for (const scale of [100, 125, 150])
    for (const width of [900, 1400]) {
      await app.evaluate(
        ({ BaseWindow }, width) =>
          BaseWindow.getAllWindows()[0].setSize(width, 900),
        width,
      );
      await dispatch({
        type: "settings.update",
        patch: { interfaceScale: scale },
      });
      for (const mode of ["focus", "compact"])
        for (const home of [false, true])
          for (const titles of [false, true]) {
            await dispatch({
              type: "settings.update",
              patch: {
                showHome: home,
                compactTabTitles: titles,
                toolbarLayout: mode === "compact" ? "automatic" : "expanded",
              },
            });
            await dispatch({ type: "ui.update", patch: { focusMode: false } });
            await page.mouse.click(60, 60);
            if (mode === "focus")
              await ui
                .locator(".acira-persistent-toolbar")
                .getByRole("button", {
                  name: "Enter Compact view",
                  exact: true,
                })
                .click();
            await ui.waitForFunction(
              (mode) =>
                document.querySelector(".browser-shell").dataset.layout ===
                mode,
              mode,
            );
            await ui.screenshot({animations:"disabled"});await ui.waitForTimeout(80);
            const result = await ui.evaluate((mode) => {
              const row = document.querySelector(
                  mode === "focus"
                    ? ".acira-focus-row"
                    : ".acira-persistent-toolbar",
                ),
                strip = row.querySelector(".acira-compact-tabs"),
                nav = row.querySelector(mode === "focus"?".navigation-controls":".compact-navigation .navigation-controls"),
                viewer = row.querySelector(".toolbar-tab-overview"),
                first = strip.querySelector(".acira-compact-tab"),
                badge = viewer.querySelector(".toolbar-tab-count"),
                address = row.querySelector(".address-bar"),
                actions = row.querySelector(
                  mode === "focus" ? ".focus-actions" : ".toolbar-actions",
                ),
                caption = row.querySelector(
                  mode === "focus"
                    ? ".caption-reservation"
                    : ".compact-caption-space",
                );
              const box = (node) => node?.getBoundingClientRect().toJSON(),
                icons = [...nav.querySelectorAll("button")];
              return {
                viewport: innerWidth,grid:getComputedStyle(row).gridTemplateColumns,captionWidth:getComputedStyle(row).getPropertyValue("--caption-width"),
                row: box(row),
                nav: box(nav),
                home: box(icons.at(-1)),
                viewer: box(viewer),
                badge: box(badge),
                first: box(first),
                strip: box(strip),
                address: box(address),
                actions: box(actions),
                caption: box(caption),
                plus: box(strip.querySelector(".acira-compact-new")),
                mask: getComputedStyle(
                  strip.querySelector(".acira-compact-tabs-viewport"),
                ).maskImage,
              };
            }, mode);
            assert.ok(
              result.nav.right <= result.viewer.x + 1,
              JSON.stringify(result),
            );
            assert.ok(
              result.viewer.right <= result.strip.x + 1,
              JSON.stringify(result),
            );
            assert.ok(
              result.plus.right <= result.actions.x + 1,
              JSON.stringify(result),
            );
            assert.ok(
              result.actions.right <= result.caption.x + 1,
              JSON.stringify(result),
            );
            assert.ok(
              result.caption.right <= result.viewport + 1,
              JSON.stringify(result),
            );
            assert.ok(
              Math.abs(result.viewer.x - result.nav.right - 4) < 1,
              JSON.stringify(result),
            );
            assert.ok(
              Math.abs(result.strip.x - result.viewer.right - 4) < 1,
              JSON.stringify(result),
            );
            assert.ok(
              result.badge.x >= result.viewer.x &&
                result.badge.right <= result.viewer.right + 2,
              JSON.stringify(result),
            );
            if (mode === "compact") {
              assert.ok(
                result.strip.right <= result.address.x + 1,
                JSON.stringify(result),
              );
              assert.ok(result.address.width >= 119, JSON.stringify(result));
              assert.ok(
                result.address.right <= result.actions.x + 1,
                JSON.stringify(result),
              );
            }
            report.cases.push({ scale, width, mode, home, titles, ...result });
            if (scale === 100 && width === 1400 && home && titles)
              await ui.screenshot({
                path: `qa/artifacts/toolbar-${mode}.png`,
                clip: {
                  x: 0,
                  y: 0,
                  width: 1400,
                  height: mode === "focus" ? 36 : 44,
                },
              });
          }
    }
  await fs.writeFile(
    "qa/artifacts/toolbar-composition.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        cases: report.cases.length,
        result: "pass",
        checks: [
          "shared 4px group gaps",
          "badge does not reserve layout space",
          "plus/address/actions/captions do not overlap",
          "narrow/wide,100/125/150%,both layouts,Home and titles on/off",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await app?.close();
  server.close();
}
