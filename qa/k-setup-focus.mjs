// Stream K: keyboard focus across setup, with M's focus scan.  node qa/k-setup-focus.mjs --lang=en|de [--zoom=1.5 --size=1350x900] [--tone=dark]
// Existing-install seed, isolated profile. Picks the language with the welcome's picker, then on the welcome, every step,
// the Connection sheet (providers open, then proxy) and the "What's sent" sheet, presses Tab through the view (capped) and
// records M's findings: a focus ring clipped by, or touching, an overflow ancestor, and text that sits too close to its
// focus box. Report in qa/artifacts/k-focus-<tag>. One instance, closed in finally; every loop is capped.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
const { _electron } = require("playwright");
const arg = (name, fallback) => { const hit = process.argv.find((item) => item.startsWith("--" + name + "=")); return hit ? hit.slice(name.length + 3) : fallback; };
const lang = arg("lang", "de"), tone = arg("tone", "dark"), zoom = Number(arg("zoom", 1.5)), [width, height] = String(arg("size", zoom === 1 ? "1440x900" : "1350x900")).split("x").map(Number);
const tag = arg("tag", lang + (zoom === 1 ? "" : "-" + zoom * 100));
const out = path.join(root, "qa", "artifacts", "k-focus-" + tag); await fs.mkdir(out, { recursive: true });
const data = path.join(root, ".qa-profiles/k-focus-" + Date.now());
await fs.cp(path.join(root, ".qa-profiles/first-run-seed"), data, { recursive: true, filter: (s) => !/lockfile$|Singleton/.test(s) });
const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.join(root, ".qa-profiles/import-fixture") };
delete env.ELECTRON_RUN_AS_NODE; delete env.ACIRA_DEV;
const app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", path.join(root, "desktop/main.cjs")], env, colorScheme: tone, timeout: 30000 });
const report = { lang, zoom, size: [width, height], views: [] };
let page;
const shot = async (name) => {
  const png = await app.evaluate(async ({ webContents }) => { const c = webContents.getAllWebContents().find((w) => w.getURL() === "acira-browser-ui://ui/index.html"); await c.capturePage(); await new Promise((r) => setTimeout(r, 150)); return (await c.capturePage()).toPNG().toString("base64"); });
  await fs.writeFile(path.join(out, name + ".png"), Buffer.from(png, "base64"));
};
// M's focus scan (qa/m-edge-scan.js, the same check as the M driver's /focusscan): Tab through the view, at each stop
// read __edge.focus() (ring clipped or touching an overflow ancestor, text closer than 6-8 px to its focus box).
const edge = await fs.readFile(path.join(root, "qa/m-edge-scan.js"), "utf8");
const focusScan = async (name, stops = 24) => {
  await page.evaluate(edge);
  const seen = new Set(), findings = [], labels = [];
  for (let i = 0; i < stops; i++) {
    await page.keyboard.press("Tab"); await page.waitForTimeout(70);
    const r = await page.evaluate(() => window.__edge.focus());
    if (!r) continue;
    labels.push(r.label);
    for (const f of r.findings) { const k = f.box + f.problem; if (!seen.has(k)) { seen.add(k); findings.push(r.label + " | " + f.box + " | " + f.problem); } }
  }
  report.views.push({ name, labels, findings });
  console.log(name.padEnd(18), labels.length, "stops |", findings.length ? "\n   " + findings.join("\n   ") : "clean");
};
try {
  for (let i = 0; i < 150 && !page; i++) { page = app.windows().find((w) => w.url() === "acira-browser-ui://ui/index.html"); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  if (!page) throw new Error("no UI page");
  await page.waitForLoadState("domcontentloaded");
  await app.evaluate(({ BaseWindow }, s) => { const w = BaseWindow.getAllWindows()[0]; w?.setContentSize(s[0], s[1]); w?.center(); }, [width, height]);
  if (zoom !== 1) await app.evaluate(({ webContents }, f) => { for (const c of webContents.getAllWebContents()) if (c.getURL() === "acira-browser-ui://ui/index.html") c.setZoomFactor(f); }, zoom);
  await page.waitForSelector(".setup-dialog", { timeout: 20000 }); await page.waitForTimeout(3500);
  if (lang !== "en") { await page.locator(".fr-w-lang-button").click(); await page.waitForTimeout(300); await page.locator(`.fr-w-lang-list li[data-value="${lang}"]`).click(); await page.waitForTimeout(1000); }
  await focusScan("01-welcome", 8);
  const next = () => page.locator(".setup-dialog [data-onboarding-next]").first();
  for (let i = 2; i <= 9; i++) {
    if (!(await next().count())) break;
    await next().click(); await page.mouse.move(5, 5); await page.waitForTimeout(1500);
    if (!(await page.locator(".fr-card").count())) break;
    const name = String(i).padStart(2, "0") + "-step";
    await focusScan(name);
    if (await page.locator(".fr-card .fr-more").count()) {
      await page.locator(".fr-card .fr-more").first().click(); await page.waitForTimeout(600);
      const providers = page.locator('.fr-sheet .fr-more[aria-expanded="false"]');
      if (await providers.count()) { await providers.click(); await page.waitForTimeout(500); }
      await focusScan(name + "-vpn", 14);
      await page.locator(".fr-sheet .acira-seg").first().locator("button").nth(1).click(); await page.waitForTimeout(500);
      await focusScan(name + "-proxy", 12);
      await page.keyboard.press("Escape"); await page.waitForTimeout(500);
      if (await page.locator(".fr-card .fr-inline-link").count()) { await page.locator(".fr-card .fr-inline-link").click(); await page.waitForTimeout(500); await focusScan(name + "-usage", 4); await page.keyboard.press("Escape"); await page.waitForTimeout(500); }
    }
    if (!(await page.locator(".fr-foot-end [data-onboarding-next]").count())) break;
  }
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 1));
  const n = report.views.reduce((sum, v) => sum + v.findings.length, 0);
  console.log(n ? `FAIL ${n} finding(s)` : "PASS", "| lang", lang, "|", out);
} finally {
  await app.close();
  await fs.rm(data, { recursive: true, force: true }).catch(() => {});
}
