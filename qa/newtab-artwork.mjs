import { _electron } from "playwright";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  { BrowserDatabase } = require("../desktop/database.cjs"),
  { createInitialState } = require("../desktop/runtime.cjs");
const data = path.resolve(".qa-profiles/newtab-artwork");
await fs.mkdir(data, { recursive: true });
const db = new BrowserDatabase(path.join(data, "browser.sqlite")),
  seed = createInitialState();
seed.settings.reducedMotion = true;
seed.windowUi.workspaceOpen = false;
seed.windowUi.webWorkspaceOpen = false;
db.saveWindow("main", seed);
db.close();
let app;
const report = { checks: [], geometry: [] };
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
  ui.setDefaultTimeout(6000);
  await ui.waitForFunction(() => Boolean(window.acira));
  return ui;
};
try {
  let ui = await launch();
  const navigate = (url) =>
    ui.evaluate(
      (url) => window.acira.dispatch({ type: "tab.navigate", url }),
      url,
    );
  await ui.evaluate(() =>
    localStorage.setItem("acira-study-cover:profile-personal", "shown"),
  );
  await ui.reload();
  await ui.getByRole("button", { name: "Hide artwork", exact: true }).waitFor();
  assert.equal(await ui.locator(".ed-page-section").count(), 0);
  assert.equal(await ui.locator(".ed-start-heading").count(), 0);
  for (const [width, height] of [
    [1400, 1000],
    [900, 640],
  ]) {
    await app.evaluate(
      ({ BaseWindow }, [w, h]) => BaseWindow.getAllWindows()[0].setSize(w, h),
      [width, height],
    );
    await ui.screenshot({ animations: "disabled" });
    const geometry = await ui
      .locator(".ed-start-composition")
      .evaluate((el) => {
        const box = (n) => n.getBoundingClientRect().toJSON();
        return {
          group: box(el),
          area: box(el.closest(".ed-workspace")),
          art: box(el.querySelector(".ed-workspace-identity")),
          search: box(el.querySelector(".ed-start-search")),
        };
      });
    assert.ok(geometry.art.height >= 144);
    assert.ok(
      Math.abs(
        geometry.group.y +
          geometry.group.height / 2 -
          (geometry.area.y + geometry.area.height / 2),
      ) < 24,
      JSON.stringify(geometry),
    );
    report.geometry.push({ width, height, ...geometry });
  }
  await ui.getByRole("button", { name: "Hide artwork", exact: true }).click();
  await ui.locator(".ed-workspace-identity").waitFor({ state: "detached" });
  assert.equal(
    await ui.getByRole("button", { name: /show.*(art|cover)/i }).count(),
    0,
  );
  await ui.getByRole("status").filter({ hasText: "Artwork hidden." }).waitFor();
  await ui.evaluate(() => window.acira.dispatch({ type: "tab.new" }));
  assert.equal(await ui.locator(".ed-workspace-identity").count(), 0);
  report.checks.push(
    "centered substantial artwork/search; no workspace heading or empty sections; eye hides artwork completely with one confirmation and no restore reminder on new tabs",
  );
  await navigate("acira://settings");
  assert.equal(
    await ui
      .getByRole("switch", { name: "Show artwork", exact: true })
      .getAttribute("aria-checked"),
    "false",
  );
  await app.close();
  ui = await launch();
  assert.equal(
    await ui
      .getByRole("switch", { name: "Show artwork", exact: true })
      .getAttribute("aria-checked"),
    "false",
  );
  await ui.getByRole("switch", { name: "Show artwork", exact: true }).click();
  await navigate("acira://new");
  await ui.getByRole("button", { name: "Hide artwork", exact: true }).waitFor();
  report.checks.push(
    "profile artwork visibility survives native relaunch and restores from Settings",
  );
  await fs.writeFile(
    "qa/artifacts/newtab-artwork.json",
    JSON.stringify(report, null, 2),
  );
  await ui.screenshot({ path: "qa/artifacts/newtab-artwork.png" });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app?.close();
}
