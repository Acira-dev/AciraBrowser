// Stream K: setup in another language, checked for clipped text.  node qa/k-setup-i18n.mjs --lang=de [--zoom=1.5 --size=1350x900] [--tone=dark] [--tag=x]
// Existing-install seed, isolated profile. Picks the language with the welcome's own picker, then walks every step, opens
// the Connection sheet (both sides), the "What's sent" sheet and, after Start browsing, Make it yours. On each it runs M's
// clip scan (qa/m-clip-scan.js rules) with one difference: an ellipsis counts as clipped too, since a truncated
// translation is still cut off. It also measures the air between each card's content and its footer. Shots and
// report.json go to qa/artifacts/k-i18n-<tag>. One instance, closed in finally; every loop is capped.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
const { _electron } = require("playwright");
const arg = (name, fallback) => { const hit = process.argv.find((item) => item.startsWith("--" + name + "=")); return hit ? hit.slice(name.length + 3) : fallback; };
const lang = arg("lang", "de"), tone = arg("tone", "dark"), zoom = Number(arg("zoom", 1.5)), [width, height] = String(arg("size", zoom === 1 ? "1440x900" : "1350x900")).split("x").map(Number);
const tag = arg("tag", lang + (zoom === 1 ? "" : "-" + zoom * 100));
const out = path.join(root, "qa", "artifacts", "k-i18n-" + tag); await fs.mkdir(out, { recursive: true });
const data = path.join(root, ".qa-profiles/k-i18n-" + Date.now());
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
// M's rules, scoped to setup's surfaces; ellipsis truncation is reported too.
const scan = () => page.evaluate(() => {
  const scope = document.querySelector(".fr-yours-panel") || document.querySelector(".fr-stage") || document.body;
  const hits = [], seen = new Set();
  const clipAnc = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p); if (o.overflowX !== "visible" || o.overflowY !== "visible") return p; } return document.documentElement; };
  for (const el of scope.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || el.closest("[inert], .fr-visually-hidden, [aria-hidden=true]")) continue;
    // An account address may give way to an ellipsis by design (the counts beside it stay whole).
    if (el.classList.contains("fr-detail-who")) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own.length) continue;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    const rg = document.createRange(); rg.selectNodeContents(el); const tr = rg.getBoundingClientRect();
    const text = el.textContent.replace(/\s+/g, " ").trim().slice(0, 60);
    const anc = clipAnc(el), ar = anc.getBoundingClientRect();
    const pad = anc === document.documentElement ? { l: 0, r: innerWidth } : { l: ar.left + parseFloat(getComputedStyle(anc).borderLeftWidth), r: ar.right - parseFloat(getComputedStyle(anc).borderRightWidth) };
    const ell = cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none";
    const trunc = el.scrollWidth > el.clientWidth + 1;
    let why = null;
    if (trunc && ell) why = "ellipsis";
    else if (trunc && cs.overflowX !== "visible") why = "clipped sw=" + el.scrollWidth + " cw=" + el.clientWidth;
    else if (tr.right > pad.r + 0.5 && tr.width > 0) why = "crosses right by " + (tr.right - pad.r).toFixed(1);
    else if (tr.left < pad.l - 0.5 && tr.width > 0) why = "crosses left by " + (pad.l - tr.left).toFixed(1);
    else if (tr.right > innerWidth + 0.5) why = "off screen right";
    if (why && !seen.has(text + why)) { seen.add(text + why); hits.push(why + " :: " + text); }
  }
  // The card and any sheet: the last content above the footer.
  const air = (main, foot) => {
    if (!main || !foot) return null;
    let bottom = 0;
    // Folded content (a closed .fr-disclose) keeps its box inside a zero-height clip; it takes no room, so it is skipped.
    for (const el of main.querySelectorAll("*")) { const b = el.getBoundingClientRect(); if (b.height > 0 && b.width > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[inert], .fr-disclose:not([data-open])")) bottom = Math.max(bottom, b.bottom); }
    return Math.round(foot.getBoundingClientRect().top - bottom);
  };
  const sheet = document.querySelector(".fr-sheet");
  return {
    hits,
    cardAir: air(document.querySelector(".fr-card-main"), document.querySelector(".fr-card > .fr-foot")),
    sheetAir: sheet ? air(sheet.querySelector(".fr-sheet-main"), sheet.querySelector(".fr-foot")) : null,
    lang: document.documentElement.lang,
    title: document.querySelector("#fr-title, #fr-yours-title")?.textContent?.trim().slice(0, 60) || "",
  };
});
const record = async (name) => { await shot(name); const result = await scan(); report.views.push({ name, ...result }); console.log(name.padEnd(22), "air", String(result.cardAir ?? "-").padStart(4), result.sheetAir !== null ? "sheet " + result.sheetAir : "", "|", result.hits.length ? result.hits.join(" || ") : "no hits"); };
try {
  for (let i = 0; i < 150 && !page; i++) { page = app.windows().find((w) => w.url() === "acira-browser-ui://ui/index.html"); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  if (!page) throw new Error("no UI page");
  await page.waitForLoadState("domcontentloaded");
  await app.evaluate(({ BaseWindow }, s) => { const w = BaseWindow.getAllWindows()[0]; w?.setContentSize(s[0], s[1]); w?.center(); }, [width, height]);
  if (zoom !== 1) await app.evaluate(({ webContents }, f) => { for (const c of webContents.getAllWebContents()) if (c.getURL() === "acira-browser-ui://ui/index.html") c.setZoomFactor(f); }, zoom);
  await page.waitForSelector(".setup-dialog", { timeout: 20000 }); await page.waitForTimeout(3500);
  // The welcome's own picker.
  await page.locator(".fr-w-lang-button").click(); await page.waitForTimeout(400);
  await record("00-language-list");
  await page.locator(`.fr-w-lang-list li[data-value="${lang}"]`).click(); await page.waitForTimeout(1200); await page.mouse.move(5, 5);
  await record("01-welcome");
  const next = () => page.locator(".setup-dialog [data-onboarding-next]").first();
  for (let i = 2; i <= 9; i++) {
    if (!(await next().count())) break;
    await next().click(); await page.mouse.move(5, 5); await page.waitForTimeout(1500);
    if (!(await page.locator(".fr-card").count())) break;
    const name = String(i).padStart(2, "0") + "-step";
    await record(name);
    if (await page.locator(".fr-card .fr-more").count()) {
      await page.locator(".fr-card .fr-more").first().click(); await page.waitForTimeout(600); await page.mouse.move(5, 5);
      await record(name + "-vpn");
      const providers = page.locator('.fr-sheet .fr-more[aria-expanded="false"]');
      if (await providers.count()) { await providers.click(); await page.waitForTimeout(500); await page.mouse.move(5, 5); await record(name + "-vpn-open"); }
      await page.locator(".fr-sheet .acira-seg").first().locator("button").nth(1).click(); await page.waitForTimeout(500);
      await record(name + "-proxy");
      await page.keyboard.press("Escape"); await page.waitForTimeout(500);
      if (await page.locator(".fr-card .fr-inline-link").count()) { await page.locator(".fr-card .fr-inline-link").click(); await page.waitForTimeout(500); await record(name + "-usage"); await page.keyboard.press("Escape"); await page.waitForTimeout(500); }
    }
    if (!(await page.locator(".fr-foot-end [data-onboarding-next]").count())) break;
  }
  // The last step's Start browsing, then Make it yours over the browser.
  const primary = page.locator(".setup-dialog [data-onboarding-primary]").first();
  if (await primary.count()) await primary.click();
  for (let i = 0; i < 24 && !(await page.locator(".fr-yours-panel").count()); i++) await page.waitForTimeout(250);
  await page.waitForTimeout(900);
  if (await page.locator(".fr-yours-panel").count()) await record("09-make-it-yours");
  else console.log("09-make-it-yours       not shown");
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 1));
  const bad = report.views.filter((v) => v.hits.length || (v.cardAir !== null && v.cardAir < 8) || (v.sheetAir !== null && v.sheetAir < 8));
  console.log(bad.length ? `FAIL ${bad.length} view(s)` : "PASS", "| lang", report.views.at(-1)?.lang, "|", out);
} finally {
  await app.close();
  await fs.rm(data, { recursive: true, force: true }).catch(() => {});
}
