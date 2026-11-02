// Stream K: node qa/k-first-run-walk.mjs --tone=light [--zoom=1.5 --size=1350x900] [--tag=x]   (cwd = worktree root)
// Walks the whole first run: each step settled, a frame mid-transition, frame pacing during each transition, and the
// text colours/positions needed for a contrast check against the real pixels behind them.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
const { _electron } = require("playwright");
const arg = (name, fallback) => { const hit = process.argv.find((item) => item.startsWith("--" + name + "=")); return hit ? hit.slice(name.length + 3) : process.argv.includes("--" + name) ? true : fallback; };
const tone = arg("tone", "light"), zoom = Number(arg("zoom", 1)), tag = arg("tag", tone + (zoom === 1 ? "" : zoom * 100)), [width, height] = String(arg("size", "1440x900")).split("x").map(Number);
const out = path.join(root, "qa", "artifacts", "k-walk-" + tag); await fs.mkdir(out, { recursive: true });
// The synthetic Chrome profiles the Import step lists (no real browser data); rebuilt when another session cleans .qa-profiles.
if (!(await fs.stat(path.join(root, ".qa-profiles/import-fixture")).then(() => true, () => false))) {
  // A synthetic Chrome profile: 47 bookmarks in a bar and a folder, plus preferences. No real browser data.
  const user = path.join(root, ".qa-profiles/import-fixture/Google/Chrome/User Data");
  await fs.mkdir(path.join(user, "Default"), { recursive: true });
  // Two profiles: one signed in with a colour and email (no picture file in the fixture), one with a colour only.
  await fs.writeFile(path.join(user, "Local State"), JSON.stringify({ profile: { info_cache: { Default: { name: "Work", gaia_name: "Fixture Person", user_name: "fixture.person@example.com", profile_highlight_color: -13739862 }, "Profile 1": { name: "Personal", user_name: "personal@example.com", profile_highlight_color: -8773067 } } } }));
  const url = (name, href, id) => ({ type: "url", name, url: href, id: String(id), date_added: "13300000000000000" });
  const bar = [["Acira", "https://acira.example/"], ["MDN Web Docs", "https://developer.mozilla.org/"], ["Wikipedia", "https://www.wikipedia.org/"], ["The Met", "https://www.metmuseum.org/"], ["Hacker News", "https://news.ycombinator.com/"], ["GitHub", "https://github.com/"]].map(([n, u], i) => url(n, u, 10 + i));
  bar.push({ type: "folder", name: "Reading", id: "5", date_added: "13300000000000000", children: Array.from({ length: 40 }, (_, i) => url(`Article ${i + 1}`, `https://example.com/read/${i + 1}`, 101 + i)) });
  await fs.writeFile(path.join(user, "Default/Bookmarks"), JSON.stringify({ checksum: "", version: 1, roots: { bookmark_bar: { type: "folder", name: "Bookmarks bar", id: "1", children: bar }, other: { type: "folder", name: "Other bookmarks", id: "2", children: [url("Recipes", "https://example.com/recipes", 200)] }, synced: { type: "folder", name: "Mobile bookmarks", id: "3", children: [] } } }));
  await fs.writeFile(path.join(user, "Default/Preferences"), JSON.stringify({ homepage: "https://acira.example/", browser: {} }));
  await fs.mkdir(path.join(user, "Profile 1"), { recursive: true });
  for (const file of ["Bookmarks", "Preferences"]) await fs.copyFile(path.join(user, "Default", file), path.join(user, "Profile 1", file));
}
const data = path.join(root, ".qa-profiles/k-walk-" + Date.now());
await fs.cp(path.join(root, ".qa-profiles/first-run-seed"), data, { recursive: true, filter: (s) => !/lockfile$|Singleton/.test(s) });
const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.join(root, ".qa-profiles/import-fixture") };
delete env.ELECTRON_RUN_AS_NODE; delete env.ACIRA_DEV;
const app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", path.join(root, "desktop/main.cjs")], env, timeout: 30000 });
const shot = async (name) => {
  const png = await app.evaluate(async ({ webContents }) => { const c = webContents.getAllWebContents().find((w) => w.getURL() === "acira-browser-ui://ui/index.html"); await c.capturePage(); await new Promise((r) => setTimeout(r, 150)); return (await c.capturePage()).toPNG().toString("base64"); });
  await fs.writeFile(path.join(out, name + ".png"), Buffer.from(png, "base64"));
};
const pacing = (page, ms) => page.evaluate((ms) => new Promise((resolve) => { const d = []; let last = performance.now(); const start = last; const tick = (now) => { d.push(now - last); last = now; if (now - start < ms) requestAnimationFrame(tick); else { d.shift(); d.sort((a, b) => a - b); resolve({ fps: +(d.length / ((now - start) / 1000)).toFixed(1), p95: +d[Math.floor(d.length * .95)].toFixed(1), max: +d[d.length - 1].toFixed(1) }); } }; requestAnimationFrame(tick); }), ms);
const texts = (page) => page.evaluate(() => [...document.querySelectorAll(".fr-stage h1, .fr-stage p, .fr-stage label, .fr-stage button, .fr-stage legend, .fr-stage span, .fr-stage b, .fr-stage small, .fr-stage dt, .fr-stage dd, .fr-stage em, .fr-stage a")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 && (e.tagName === "H1" || (e.childElementCount === 0 && !e.closest("h1"))) && e.textContent.trim() && getComputedStyle(e).visibility !== "hidden" && +getComputedStyle(e).opacity > .5; }).slice(0, 80).map((e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return { text: e.textContent.trim().slice(0, 40), color: s.color, size: s.fontSize, weight: s.fontWeight, box: [r.left, r.top, r.width, r.height].map(Math.round) }; }));
const report = { tone, zoom, steps: [] };
try {
  let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => w.url() === "acira-browser-ui://ui/index.html"); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  await page.waitForLoadState("domcontentloaded");
  await app.evaluate(({ BaseWindow }, s) => { const w = BaseWindow.getAllWindows()[0]; w?.setContentSize(s[0], s[1]); w?.center(); }, [width, height]);
  if (zoom !== 1) await app.evaluate(({ webContents }, f) => { for (const c of webContents.getAllWebContents()) if (c.getURL() === "acira-browser-ui://ui/index.html") c.setZoomFactor(f); }, zoom);
  await page.emulateMedia({ colorScheme: tone === "light" ? "light" : "dark" });
  await page.waitForSelector(".setup-dialog", { timeout: 20000 });
  await page.waitForTimeout(3500);
  await shot("00-welcome");
  report.steps.push({ step: "welcome", pacing: await pacing(page, 1500), texts: await texts(page), dpr: await page.evaluate(() => devicePixelRatio) });
  for (let i = 1; i <= 9; i++) {
    const next = page.locator(".setup-dialog [data-onboarding-next]").first();
    if (!(await next.count())) break;
    const label = (await next.textContent())?.trim();
    const pace = pacing(page, 900);
    await next.click();
    await page.waitForTimeout(140); await shot(String(i).padStart(2, "0") + "-mid");
    const during = await pace;
    await page.waitForTimeout(1400); await shot(String(i).padStart(2, "0") + "-step");
    const title = await page.evaluate(() => document.querySelector("#fr-title")?.getAttribute("aria-label") || document.querySelector("#fr-title")?.textContent || "");
    // Unrounded boxes: the footer's primary button must sit on the same (whole-pixel) y on every step (M25).
    const geom = await page.evaluate(() => Object.fromEntries(Object.entries({ card: ".fr-card", foot: ".fr-foot", next: ".setup-dialog [data-onboarding-next]", primary: "[data-onboarding-primary]" }).map(([k, s]) => { const b = document.querySelector(s)?.getBoundingClientRect(); return [k, b && [b.x, b.y, b.width, b.height].map((v) => +v.toFixed(3))]; })));
    report.steps.push({ step: i, clicked: label, title, transition: during, geom, texts: await texts(page) });
    if (!(await page.locator(".setup-dialog").count())) break;
  }
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 1));
  console.log(report.steps.map((s) => `${s.step} ${s.title || ""} | clicked ${s.clicked || "-"} | ${JSON.stringify(s.transition || s.pacing)}${s.geom?.next ? " | next y " + s.geom.next[1] + " card y " + s.geom.card?.[1] : ""}`).join("\n"));
} finally {
  await app.close();
  await fs.rm(data, { recursive: true, force: true }).catch(() => {});
}
