// Stream I benchmark capture: Acira's current state for the browser UI benchmark, ONE isolated instance, ≤ 10 tabs.
// Surfaces: onboarding (welcome + 2 steps), toolbar/tab strip, bookmarks bar, compact mode, sidebar tabs, new tab,
// settings, main menu, site info, private window. Real window pixels (desktopCapturer).
// node qa/i-bench-capture.mjs --theme=dark|light   (needs .qa-profiles/first-run-seed + import-fixture from stream F)
import { _electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd(), wait = (ms) => new Promise((r) => setTimeout(r, ms));
const theme = (process.argv.find((a) => a.startsWith("--theme=")) || "--theme=light").slice(8);
const out = path.join(root, "docs/design/benchmark/img/acira");
await fs.mkdir(out, { recursive: true });
const data = path.join(root, ".qa-profiles/i-bench-" + Date.now());
await fs.cp(path.join(root, ".qa-profiles/first-run-seed"), data, { recursive: true, filter: (s) => !/lockfile$|Singleton/.test(s) });
const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.join(root, ".qa-profiles/import-fixture") };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: [path.join(root, "desktop/main.cjs")], env, timeout: 30000 });
// Half-size JPEG of the largest visible window keeps the benchmark folder light (~60-120 KB per image).
const shot = async (name) => {
  for (let i = 0; i < 10; i++) {
    const b64 = await app.evaluate(async ({ BaseWindow, desktopCapturer, screen }) => {
      const win = BaseWindow.getAllWindows().filter((w) => w.isVisible() && !w.isMinimized()).sort((a, b) => b.getBounds().width * b.getBounds().height - a.getBounds().width * a.getBounds().height)[0];
      if (!win) return "";
      const bounds = win.getBounds(), scale = screen.getDisplayMatching(bounds).scaleFactor;
      const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: Math.round(bounds.width * scale), height: Math.round(bounds.height * scale) } });
      const image = sources.find((s) => s.id === win.getMediaSourceId())?.thumbnail;
      return image && !image.isEmpty() ? image.resize({ width: 960, quality: "best" }).toJPEG(86).toString("base64") : "";
    });
    if (b64) { await fs.writeFile(path.join(out, `${name}-${theme}.jpg`), Buffer.from(b64, "base64")); console.log("shot", name); return; }
    await wait(400);
  }
  console.log("EMPTY", name);
};
const step = async (label, fn) => { try { await fn(); } catch (e) { console.log("FAIL", label, String(e.message).split("\n")[0]); } };
try {
  let page;
  for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((p) => p.url() === "acira-browser-ui://ui/index.html"); if (!page) await wait(200); }
  await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setContentSize(1440, 900); w.center(); });
  await page.emulateMedia({ colorScheme: theme });
  await page.waitForSelector(".setup-dialog", { timeout: 20000 });
  await wait(3500); await shot("onboarding-welcome");
  await page.locator(".setup-dialog [data-onboarding-next]").first().click(); await wait(1500); await shot("onboarding-import");
  await page.locator(".setup-dialog [data-onboarding-next]").first().click(); await wait(1500);
  await page.locator(".setup-dialog [data-onboarding-next]").first().click(); await wait(1500);
  if (await page.locator(".fr-look").count()) { await page.locator(".fr-look", { hasText: theme === "dark" ? "Dark" : "Light" }).first().click(); await wait(800); }
  await shot("onboarding-look");
  for (let i = 0; i < 8 && (await page.locator(".setup-dialog [data-onboarding-next]").count()); i++) { await page.locator(".setup-dialog [data-onboarding-next]").first().click(); await wait(1200); }
  await wait(2500);
  page = app.windows().filter((p) => p.url() === "acira-browser-ui://ui/index.html").pop() || page;
  const done = page.getByRole("button", { name: /^Done$/ });
  if (await done.count()) { await done.first().click(); await wait(700); }
  const act = (a) => page.evaluate((x) => window.acira.dispatch(x), a);
  await act({ type: "settings.update", patch: { appearance: theme } });
  // 6 web tabs + the new tab = 7 tabs; a group of three.
  for (const url of ["https://en.wikipedia.org/wiki/Typography", "https://developer.mozilla.org/en-US/", "https://news.ycombinator.com/", "https://github.com/", "https://www.metmuseum.org/", "https://example.com/"]) await act({ type: "tab.new", url });
  await wait(5000);
  await step("group", async () => {
    const ids = (await page.evaluate(() => window.acira.getSnapshot())).tabs.filter((t) => t.url?.startsWith("http")).map((t) => t.id);
    await act({ type: "tab.group.create", tabId: ids[0], name: "Research", color: "blue" });
    const g = (await page.evaluate(() => window.acira.getSnapshot())).tabGroups[0]?.id;
    if (g) await act({ type: "tab.group.assign", tabIds: [ids[1], ids[2]], groupId: g });
    for (const url of [ids[0] && "https://en.wikipedia.org/wiki/Typography", "https://developer.mozilla.org/en-US/"]) if (url) await act({ type: "bookmark.toggle", url });
    await act({ type: "tab.select", id: ids[0] });
  });
  await wait(6000); await shot("toolbar-tabstrip");
  await step("bookmarks bar", async () => { const run = (id) => page.evaluate((x) => window.acira.native({ type: "shortcuts.run", id: x }), id); await act({ type: "settings.update", patch: { bookmarksBar: true, bookmarksOnNewTabOnly: false } }); await wait(1200); await shot("toolbar-bookmarksbar"); await act({ type: "settings.update", patch: { bookmarksBar: false } }); });
  await step("compact", async () => { await page.evaluate(() => window.acira.native({ type: "shortcuts.run", id: "focus-mode" })); await wait(1800); await shot("toolbar-compact"); await page.evaluate(() => window.acira.native({ type: "shortcuts.run", id: "focus-mode" })); await wait(800); });
  await step("menu", async () => { await page.getByRole("button", { name: "Acira menu" }).first().click(); await wait(600); await shot("menus-main"); await page.keyboard.press("Escape"); await wait(300); });
  await step("site info", async () => { await page.getByRole("button", { name: "Page information", exact: true }).first().click(); await wait(700); await shot("menus-siteinfo"); await page.keyboard.press("Escape"); await wait(300); });
  await step("new tab", async () => { await act({ type: "tab.new" }); await wait(2000); await shot("newtab"); });
  await step("settings", async () => { await act({ type: "tab.new", url: "acira://settings" }); await wait(2000); await shot("settings-appearance"); const p = page.getByText("Privacy", { exact: true }).first(); if (await p.count()) { await p.click(); await wait(800); await shot("settings-privacy"); } });
  await step("sidebar", async () => {
    await act({ type: "settings.update", patch: { verticalTabs: true } });
    await act({ type: "ui.update", patch: { workspaceOpen: true, webWorkspaceOpen: true } });
    const ids = (await page.evaluate(() => window.acira.getSnapshot())).tabs.filter((t) => t.url?.startsWith("http")).map((t) => t.id);
    await act({ type: "tab.select", id: ids[0] });
    await wait(3000); await shot("sidebar");
  });
  await step("private", async () => {
    await page.evaluate(() => window.acira.dispatch({ type: "settings.update", patch: { verticalTabs: false } }));
    await app.evaluate(({ webContents }) => { const wc = webContents.getAllWebContents().find((w) => w.getURL() === "acira-browser-ui://ui/index.html"); wc?.focus(); });
    await page.evaluate(() => window.acira.native({ type: "shortcuts.run", id: "private-window" })); await wait(3500);
    await app.evaluate(({ BaseWindow }) => { for (const w of BaseWindow.getAllWindows()) if (w.isVisible()) { w.setContentSize(1440, 900); } });
    await wait(1200); await shot("private");
  });
} catch (e) {
  console.log("FATAL", e.message.split("\n")[0]);
} finally {
  await app.close().catch(() => {});
  await fs.rm(data, { recursive: true, force: true }).catch(() => {});
}
