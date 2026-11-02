// Stream I: capture the sidebar with real content (14 tabs, two groups, pinned tabs, bookmarks with folders) in both
// themes, so the sidebar concept is judged against today's build. Real window pixels; isolated profile.
// node qa/i-sidebar-shot.mjs   (needs .qa-profiles/first-run-seed + import-fixture, copied from stream F)
import { _electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd(), wait = (ms) => new Promise((r) => setTimeout(r, ms)), out = path.join(root, "qa/artifacts/i-sidebar");
await fs.mkdir(out, { recursive: true });
const pages = ["https://example.com/", "https://en.wikipedia.org/wiki/Typography", "https://developer.mozilla.org/en-US/", "https://news.ycombinator.com/",
  "https://github.com/", "https://www.figma.com/", "https://linear.app/", "https://vercel.com/", "https://www.metmuseum.org/", "https://www.bbc.com/news",
  "https://en.wikipedia.org/wiki/Swiss_Style_(design)", "https://stackoverflow.com/questions", "https://www.nytimes.com/", "https://arxiv.org/"];
for (const theme of ["dark", "light"]) {
  const data = path.join(root, ".qa-profiles/i-sidebar-" + Date.now());
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
    const act = (a) => page.evaluate((x) => window.acira.dispatch(x), a);
    await act({ type: "settings.update", patch: { appearance: theme, verticalTabs: true } });
    await act({ type: "ui.update", patch: { workspaceOpen: true, webWorkspaceOpen: true } });
    for (const url of pages) await act({ type: "tab.new", url });
    await wait(6000);
    const snap = await page.evaluate(() => window.acira.getSnapshot());
    const ids = snap.tabs.filter((t) => t.url && t.url.startsWith("http")).map((t) => t.id);
    // Two groups and two pinned tabs.
    await act({ type: "tab.group.create", tabId: ids[4], name: "Design", color: "blue" });
    let s2 = await page.evaluate(() => window.acira.getSnapshot());
    const g1 = s2.tabGroups.find((g) => g.name === "Design")?.id;
    if (g1) await act({ type: "tab.group.assign", tabIds: [ids[5], ids[6], ids[7]], groupId: g1 });
    await act({ type: "tab.group.create", tabId: ids[9], name: "Reading", color: "orange" });
    s2 = await page.evaluate(() => window.acira.getSnapshot());
    const g2 = s2.tabGroups.find((g) => g.name === "Reading")?.id;
    if (g2) await act({ type: "tab.group.assign", tabIds: [ids[10], ids[12]], groupId: g2 });
    for (const id of [ids[3], ids[0]]) await act({ type: "tab.pin", id }).catch(() => {});
    // Bookmarks: a folder with pages, plus loose ones.
    for (const url of [pages[1], pages[2], pages[8], pages[13]]) await act({ type: "bookmark.toggle", url });
    await act({ type: "bookmark.folder", title: "Research", parentId: null });
    await act({ type: "tab.select", id: ids[6] });
    await wait(2500);
    await shot("sidebar-full");
    console.log("groups", JSON.stringify((await page.evaluate(() => window.acira.getSnapshot())).tabGroups.map((g) => g.name)));
  } catch (error) {
    console.log("FATAL", theme, error.message.split("\n")[0]);
  } finally {
    await app.close().catch(() => {});
    await fs.rm(data, { recursive: true, force: true }).catch(() => {});
  }
}
