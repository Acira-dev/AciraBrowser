import { _electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { poll } from "./native-helpers.mjs";
const data = path.resolve(".qa-profiles/new-window-focus");
await fs.mkdir(data, { recursive: true });
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
  const first = await app.firstWindow();
  await first.waitForFunction(() =>
    Boolean(document.querySelector(".browser-shell")),
  );
  first.setDefaultTimeout(6000);
  const openWindow = async (kind) => {
    const old = new Set(app.context().pages());
    await first.evaluate((kind) => window.acira.openWindow(kind), kind);
    return poll(
      async () => {
        for (const page of app.context().pages()) {
          if (old.has(page)) continue;
          try {
            if (
              await page.evaluate(() =>
                Boolean(
                  window.acira && document.querySelector(".browser-shell"),
                ),
              )
            )
              return page;
          } catch {}
        }
      },
      Boolean,
      `new ${kind} window`,
    );
  };
  for (const kind of ["normal", "private"]) {
    const ui = await openWindow(kind);
    await poll(
      () =>
        ui.evaluate(() => ({
          focused: document.activeElement?.matches(".address-bar input"),
          layout: document.querySelector(".browser-shell").dataset.layout,
        })),
      (s) => s.focused && s.layout === "standard",
      `${kind} blank window top address`,
    );
    await ui.waitForTimeout(1400);
    assert.equal(
      await ui.evaluate(() =>
        document.activeElement?.matches(".address-bar input"),
      ),
      true,
    );
    await ui.keyboard.type("ready after delay");
    assert.equal(
      await ui.locator(".address-bar input").inputValue(),
      "ready after delay",
    );
    const snapshot = await ui.evaluate(() => window.acira.getSnapshot());
    assert.equal(
      Boolean(snapshot.browserProfiles[0].private),
      kind === "private",
    );
    report.checks.push(
      `${kind}: new blank window focuses the top omnibox immediately, survives 1.4s and accepts typing`,
    );
  }
  // The popup action uses its actual native overlay, not a reducer-only shortcut.
  await first.evaluate(() =>
    window.acira.dispatch({
      type: "settings.update",
      patch: { reducedMotion: true },
    }),
  );
  await first.getByRole("button", { name: "Acira menu", exact: true }).click();
  const overlay = await poll(
    async () => {
      for (const p of app.context().pages())
        if (
          await p
            .evaluate(() =>
              Boolean(
                document.querySelector(
                  '[role=dialog][aria-label="Acira menu"]',
                ),
              ),
            )
            .catch(() => false)
        )
          return p;
    },
    Boolean,
    "menu overlay",
  );
  const before = (await first.evaluate(() => window.acira.getSnapshot()))
    .activeTabId;
  await overlay.getByRole("button", { name: /^New tab/ }).click();
  await poll(
    () =>
      first.evaluate(async () => {
        const s = await window.acira.getSnapshot();
        return {
          id: s.activeTabId,
          focused: document.activeElement?.matches(".address-bar input"),
        };
      }),
    (s) => s.id !== before && s.focused,
    "menu new tab focus",
  );
  await first.waitForTimeout(1400);
  assert.equal(
    await first.evaluate(() =>
      document.activeElement?.matches(".address-bar input"),
    ),
    true,
  );
  report.checks.push(
    "native popup New tab command retains top omnibox focus after dismissal",
  );
  await fs.writeFile(
    "qa/artifacts/new-window-focus.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app?.close();
}
