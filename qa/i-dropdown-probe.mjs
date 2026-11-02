// Stream I probe: which step makes the new-tab address dropdown open by itself? Prints the suggestion count after
// each step of the critique capture's order, in every chrome page (main UI + overlay).
// node qa/i-dropdown-probe.mjs [--real]   (needs .qa-profiles/first-run-seed + import-fixture, copied from stream F)
import { _electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd(), data = path.join(root, ".qa-profiles/i-probe-" + Date.now());
await fs.cp(path.join(root, ".qa-profiles/first-run-seed"), data, { recursive: true, filter: (s) => !/lockfile$|Singleton/.test(s) });
const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.join(root, ".qa-profiles/import-fixture") };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: [path.join(root, "desktop/main.cjs")], env, timeout: 30000 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let page;
const probe = async (label) => {
  await wait(900);
  const counts = [];
  for (const p of app.windows()) {
    if (!p.url().startsWith("acira-browser-ui://")) continue;
    const r = await p.evaluate(() => ({
      rows: document.querySelectorAll(".address-suggestion").length,
      focus: document.activeElement?.tagName + "." + String(document.activeElement?.className || "").slice(0, 30),
      hasFocus: document.hasFocus(),
    })).catch(() => null);
    if (r) counts.push(p.url().replace("acira-browser-ui://ui/", "") + " rows=" + r.rows + " focus=" + r.focus + " hasFocus=" + r.hasFocus);
  }
  const winFocused = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().map((w) => w.isFocused()).join(","));
  console.log(label.padEnd(34), "| winFocused=" + winFocused, "|", counts.join(" || "));
};
try {
  for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((p) => p.url() === "acira-browser-ui://ui/index.html"); if (!page) await wait(200); }
  await page.waitForSelector(".setup-dialog", { timeout: 20000 });
  await wait(1500);
  await page.getByRole("button", { name: "Skip setup" }).first().click();
  await wait(2000);
  const done = page.getByRole("button", { name: /^Done$/ });
  if (await done.count()) { await done.first().click(); await wait(600); }
  await probe("1 after setup");
  if (process.argv.includes("--real")) {
    // Only what a person does: Ctrl+T, type an address, Enter; then a fresh Ctrl+T while those pages are loading/loaded.
    for (const url of ["example.com", "en.wikipedia.org/wiki/Typography"]) {
      await page.keyboard.press("Control+T"); await wait(400);
      await page.keyboard.type(url); await page.keyboard.press("Enter"); await wait(300);
    }
    await page.keyboard.press("Control+T");
    await probe("R1 real: Ctrl+T while loading");
    await wait(4000);
    await page.keyboard.press("Control+T");
    await probe("R2 real: Ctrl+T after load");
    for (const url of ["https://developer.mozilla.org/", "https://news.ycombinator.com/"]) await page.evaluate((href) => window.acira.dispatch({ type: "tab.new", url: href }), url);
    await page.keyboard.press("Control+T");
    await probe("R3 two tabs opened then Ctrl+T");
    await wait(4000);
    await probe("R4 same, 4s later (pages loaded)");
    await page.keyboard.press("Escape"); await wait(300);
    await page.evaluate(() => window.acira.dispatch({ type: "tab.new", url: "https://example.org/" }));
    await wait(3500);
    await probe("R5 one url tab, 3.5s, before Ctrl+T");
    await page.keyboard.press("Control+T");
    await probe("R6 then real Ctrl+T");
    throw new Error("real path done");
  }
  await page.evaluate(() => window.acira.dispatch({ type: "tab.new" }));
  await probe("2 dispatch tab.new (top tabs)");
  await page.keyboard.press("Control+L"); await wait(300); await page.keyboard.press("Escape");
  await probe("3 Ctrl+L then Escape");
  for (const url of ["https://example.com/", "https://en.wikipedia.org/wiki/Typography"]) await page.evaluate((href) => window.acira.dispatch({ type: "tab.new", url: href }), url);
  await wait(1500);
  await page.evaluate(() => window.acira.dispatch({ type: "tab.new" }));
  await probe("4 tabs + dispatch tab.new");
  await page.evaluate(() => window.acira.dispatch({ type: "settings.update", patch: { verticalTabs: true } }));
  await page.evaluate(() => window.acira.dispatch({ type: "ui.update", patch: { workspaceOpen: true, webWorkspaceOpen: true } }));
  await probe("5 switch to sidebar mode");
  await page.evaluate(() => window.acira.dispatch({ type: "tab.new" }));
  await probe("6 sidebar + dispatch tab.new");
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].focus());
  await page.keyboard.press("Escape");
  await probe("7 window focused + Escape");
  await page.keyboard.press("Control+T");
  await probe("8 real Ctrl+T (sidebar)");
} catch (error) {
  console.log("FATAL", error.message.split("\n")[0]);
} finally {
  await app.close().catch(() => {});
  await fs.rm(data, { recursive: true, force: true }).catch(() => {});
}
