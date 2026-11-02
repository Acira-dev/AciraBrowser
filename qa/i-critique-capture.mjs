// Design-critique capture (stream I): every onboarding step, new tab, menu, tab viewer, Settings, error page and
// sidebar in one isolated launch, full size plus a half-size copy for review.
// node qa/i-critique-capture.mjs --theme=dark|light [--size=1440x900] [--round=1]
import { _electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd(),
  arg = (name, fallback) => {
    const hit = process.argv.find((item) => item.startsWith("--" + name + "="));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
const theme = arg("theme", "dark"),
  round = arg("round", "1"),
  [width, height] = String(arg("size", "1440x900")).split("x").map(Number),
  data = path.join(root, `.qa-profiles/i-r${round}-${theme}-${Date.now()}`),
  out = path.join(root, `qa/artifacts/i-r${round}-${theme}${arg("finish", "") !== "" ? "-f" + arg("finish", "") : ""}${arg("scale", "") ? "-x" + arg("scale", "") : ""}`),
  seed = path.join(root, ".qa-profiles/first-run-seed");
// The seed already passed the native-key relaunch (copied from stream F's QA profile).
await fs.cp(seed, data, { recursive: true, filter: (source) => !/lockfile$|Singleton/.test(source) });
await fs.mkdir(path.join(out, "half"), { recursive: true });
// Browser detection reads a synthetic Chrome profile (stream F's fixture), never the user's real browsers.
const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.join(root, ".qa-profiles/import-fixture") };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ACIRA_DEV;
// --scale=1.5 stands in for Windows 150% display scaling (sizes stay in DIPs, pixels are 1.5x).
const scaleArgs = arg("scale", "") ? ["--force-device-scale-factor=" + arg("scale", "1")] : [];
const app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: [...scaleArgs, path.join(root, "desktop/main.cjs")], env, timeout: 30000 });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let page;
// Real composited window pixels (chrome, overlay menus and web views together) via desktopCapturer.
const shot = async (name) => {
  let b64 = "";
  // The window can be hidden for a moment while setup hands over; retry before falling back.
  for (let i = 0; i < 12 && !b64; i++) {
    if (i) await wait(400);
    b64 = await capture();
  }
  const buffer = b64 ? Buffer.from(b64, "base64") : await page.screenshot({ timeout: 8000 });
  await fs.writeFile(path.join(out, name + ".png"), buffer);
  const half = await app.evaluate(({ nativeImage }, b64) => nativeImage.createFromBuffer(Buffer.from(b64, "base64")).resize({ width: 720, quality: "best" }).toPNG().toString("base64"), buffer.toString("base64"));
  await fs.writeFile(path.join(out, "half", name + ".png"), Buffer.from(half, "base64"));
  console.log("shot", name);
};
const capture = () =>
  app.evaluate(async ({ BaseWindow, desktopCapturer, screen }) => {
    // The largest visible window: finishing setup can hand over to a new browser window.
    const area = (w) => w.getBounds().width * w.getBounds().height;
    const win = BaseWindow.getAllWindows().filter((w) => w.isVisible() && !w.isMinimized()).sort((a, b) => area(b) - area(a))[0];
    if (!win) return "";
    const bounds = win.getBounds(), scale = screen.getDisplayMatching(bounds).scaleFactor;
    const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: Math.round(bounds.width * scale), height: Math.round(bounds.height * scale) } });
    const source = sources.find((item) => item.id === win.getMediaSourceId());
    return source && !source.thumbnail.isEmpty() ? source.thumbnail.toPNG().toString("base64") : "";
  });
const step = async (label, fn) => {
  try { await fn(); } catch (error) { console.log("FAIL", label, String(error.message || error).split("\n")[0]); }
};
try {
  for (let i = 0; i < 100 && !page; i++) {
    page = app.windows().find((item) => item.url() === "acira-browser-ui://ui/index.html");
    if (!page) await wait(200);
  }
  await page.waitForLoadState("domcontentloaded");
  await app.evaluate(({ BaseWindow }, size) => { const win = BaseWindow.getAllWindows()[0]; win?.setContentSize(size[0], size[1]); win?.center(); }, [width, height]);
  await page.emulateMedia({ colorScheme: theme });
  await page.waitForSelector(".setup-dialog", { timeout: 20000 });
  await wait(900);
  await shot("ob-00-welcome-forming");
  await wait(2600);
  await shot("ob-01-welcome");
  // Walk every step; pick the theme on the appearance step so the rest of the app follows it.
  for (let i = 0; i < 10; i++) {
    const next = page.locator(".setup-dialog [data-onboarding-next]");
    if (!(await next.count())) break;
    // Look step: v1-v3 used .fr-mode, the single-column card (round 4+) uses .fr-look.
    if (await page.locator(".fr-mode, .fr-look").count()) {
      await page.locator(".fr-mode, .fr-look", { hasText: theme === "dark" ? "Dark" : "Light" }).first().click().catch(() => {});
      // --finish=N picks the Nth finish swatch (e.g. burgundy) so the whole run uses that finish.
      if (arg("finish", "") !== "") await page.locator(".fr-finish-swatch").nth(Number(arg("finish", 0))).click().catch(() => {});
      await wait(700);
    }
    await next.first().click();
    await wait(1300);
    const stage = await page.locator(".fr-stage").getAttribute("data-stage").catch(() => "closed");
    if (!(await page.locator(".setup-dialog").count())) break;
    await shot(`ob-${String(i + 2).padStart(2, "0")}-${stage}`);
  }
  await wait(2500);
  // Re-resolve the chrome page in case setup handed over to another window.
  page = app.windows().filter((item) => item.url() === "acira-browser-ui://ui/index.html").pop() || page;
  await app.evaluate(({ BaseWindow }, size) => { for (const win of BaseWindow.getAllWindows()) if (win.isVisible()) { win.setContentSize(size[0], size[1]); win.center(); } }, [width, height]);
  await page.emulateMedia({ colorScheme: theme });
  // Pin the app theme too: menus and popovers live in another view that follows the app setting, not the emulation.
  await page.evaluate((mode) => window.acira.dispatch({ type: "settings.update", patch: { appearance: mode } }), theme);
  await wait(600);
  // Post-setup "Make it yours" panel: capture it, then dismiss so the rest of the browser is reachable.
  const done = page.getByRole("button", { name: /^Done$/ });
  if (await done.count()) {
    await shot("my-01-make-it-yours");
    await done.first().click().catch(() => {});
    await wait(800);
  }
  await shot("nt-01-newtab");
  await step("newtab focus", async () => { await page.keyboard.press("Control+L"); await wait(400); await shot("nt-02-omnibox-focus"); await page.keyboard.press("Escape"); });
  await step("menu", async () => { await page.getByRole("button", { name: "Acira menu" }).first().click(); await wait(500); await shot("mn-01-acira-menu"); await page.keyboard.press("Escape"); await wait(300); });
  // A few tabs so the tab viewer and sidebar have content; the active tab stays on the new tab page.
  await step("tabs", async () => {
    for (const url of ["https://example.com/", "https://en.wikipedia.org/wiki/Typography", "https://developer.mozilla.org/en-US/", "https://news.ycombinator.com/"])
      await page.evaluate((href) => window.acira.dispatch({ type: "tab.new", url: href }), url);
    await wait(2500);
    await page.evaluate(() => window.acira.dispatch({ type: "tab.new" }));
    await wait(1200);
  });
  await step("tab viewer", async () => { await page.getByRole("button", { name: /Your tabs/ }).first().click(); await wait(600); await shot("tv-01-tab-viewer"); await page.keyboard.press("Escape"); await wait(300); });
  // Panels and popovers (round 9+): profile switcher, site information, bookmarks, extensions.
  for (const [label, name] of [["Switch profile", "pn-01-profile"], ["Page information", "pn-02-site-info"], ["All bookmarks", "pn-03-bookmarks"], ["Extensions", "pn-04-extensions"]]) {
    await step(name, async () => {
      const trigger = page.getByRole("button", { name: label, exact: true }).first();
      if (!(await trigger.count())) { console.log("SKIP", name, "no trigger"); return; }
      await trigger.click({ timeout: 5000 }); await wait(600); await shot(name); await page.keyboard.press("Escape"); await wait(300);
    });
  }
  await step("tab context menu", async () => { await page.locator("[data-tab-id], .tab").first().click({ button: "right" }); await wait(500); await shot("mn-02-tab-context"); await page.keyboard.press("Escape"); await wait(300); });
  await step("settings", async () => {
    await page.evaluate(() => window.acira.dispatch({ type: "tab.new", url: "acira://settings" }));
    await wait(1800); await shot("st-01-settings");
    for (const name of ["Appearance", "Privacy", "Sidebar", "Extensions", "Downloads"]) {
      const target = page.getByText(name, { exact: true }).first();
      if (await target.count()) { await target.click(); await wait(700); await shot("st-02-" + name.toLowerCase()); }
    }
    await page.keyboard.press("Control+F").catch(() => {}); await wait(200); await page.keyboard.type("cook"); await wait(700); await shot("st-03-search");
  });
  await step("error", async () => {
    await page.evaluate(() => window.acira.dispatch({ type: "tab.new", url: "http://127.0.0.1:61800/" }));
    await wait(3500); await shot("er-01-connection-refused");
    await page.evaluate(() => window.acira.dispatch({ type: "tab.new", url: "https://expired.badssl.com/" }));
    await wait(5000); await shot("er-02-certificate");
  });
  await step("sidebar", async () => {
    await page.evaluate(() => window.acira.dispatch({ type: "settings.update", patch: { verticalTabs: true } }));
    await page.evaluate(() => window.acira.dispatch({ type: "ui.update", patch: { workspaceOpen: true, webWorkspaceOpen: true } }));
    await page.evaluate(() => window.acira.dispatch({ type: "tab.new" }));
    await wait(1500); await shot("sb-01-sidebar-newtab");
    await page.evaluate(() => window.acira.dispatch({ type: "tab.new", url: "https://en.wikipedia.org/wiki/Typography" }));
    await wait(3500); await shot("sb-02-sidebar-website");
    const info = page.getByRole("button", { name: "Page information", exact: true }).first();
    if (await info.count()) { await info.click({ timeout: 5000 }).catch(() => {}); await wait(600); await shot("pn-05-site-info-website"); await page.keyboard.press("Escape"); await wait(300); }
    await page.keyboard.press("Control+F"); await wait(300); await page.keyboard.type("type"); await wait(700);
    await shot("fb-01-find-bar"); await page.keyboard.press("Escape");
  });
} catch (error) {
  console.log("FATAL", error.message);
  if (page) await shot("fatal").catch(() => {});
} finally {
  await app.close().catch(() => {});
}
