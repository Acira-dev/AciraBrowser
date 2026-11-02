// Stream I: capture the profile panel (sidebar footer + toolbar profile button) in real window pixels, both themes.
// node qa/i-panel-shot.mjs   (needs .qa-profiles/first-run-seed + import-fixture, copied from stream F)
import { _electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd(), wait = (ms) => new Promise((r) => setTimeout(r, ms)), out = path.join(root, "qa/artifacts/i-panels");
await fs.mkdir(out, { recursive: true });
for (const theme of ["dark", "light"]) {
  const data = path.join(root, ".qa-profiles/i-panel-" + Date.now());
  await fs.cp(path.join(root, ".qa-profiles/first-run-seed"), data, { recursive: true, filter: (s) => !/lockfile$|Singleton/.test(s) });
  const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.join(root, ".qa-profiles/import-fixture") };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: [path.join(root, "desktop/main.cjs")], env, timeout: 30000 });
  const shot = async (name) => {
    const b64 = await app.evaluate(async ({ BaseWindow, desktopCapturer, screen }) => {
      const win = BaseWindow.getAllWindows().filter((w) => w.isVisible()).sort((a, b) => b.getBounds().width - a.getBounds().width)[0];
      const bounds = win.getBounds(), scale = screen.getDisplayMatching(bounds).scaleFactor;
      const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: Math.round(bounds.width * scale), height: Math.round(bounds.height * scale) } });
      return sources.find((s) => s.id === win.getMediaSourceId())?.thumbnail.toPNG().toString("base64") || "";
    });
    if (b64) await fs.writeFile(path.join(out, `${name}-${theme}.png`), Buffer.from(b64, "base64"));
    console.log("shot", name, theme, b64 ? "ok" : "EMPTY");
  };
  try {
    let page;
    for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((p) => p.url() === "acira-browser-ui://ui/index.html"); if (!page) await wait(200); }
    await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setContentSize(1440, 900); w.center(); });
    await page.waitForSelector(".setup-dialog", { timeout: 20000 });
    await wait(1500);
    await page.getByRole("button", { name: "Skip setup" }).first().click();
    await wait(2000);
    const done = page.getByRole("button", { name: /^Done$/ });
    if (await done.count()) { await done.first().click(); await wait(600); }
    await page.evaluate((mode) => window.acira.dispatch({ type: "settings.update", patch: { appearance: mode } }), theme);
    await page.emulateMedia({ colorScheme: theme });
    // Toolbar profile button (top tabs).
    const top = page.getByRole("button", { name: "Switch profile", exact: true }).first();
    if (await top.count()) { await top.click(); await wait(700); await shot("profile-toolbar"); await page.keyboard.press("Escape"); await wait(300); }
    // Sidebar footer profile button.
    await page.evaluate(() => window.acira.dispatch({ type: "settings.update", patch: { verticalTabs: true } }));
    await page.evaluate(() => window.acira.dispatch({ type: "ui.update", patch: { workspaceOpen: true, webWorkspaceOpen: true } }));
    await wait(1200);
    const foot = page.locator(".sb-foot-profile").first();
    if (await foot.count()) { await foot.click(); await wait(700); await shot("profile-sidebar"); }
  } catch (error) {
    console.log("FATAL", theme, error.message.split("\n")[0]);
  } finally {
    await app.close().catch(() => {});
    await fs.rm(data, { recursive: true, force: true }).catch(() => {});
  }
}
