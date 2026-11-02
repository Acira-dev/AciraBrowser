// Stream K: setup on one grid. node qa/k-setup-sheet.mjs --tone=light|dark [--zoom=1.5 --size=1350x900] --tag=x   (cwd = worktree root)
// Walks every setup step (existing-install seed, tone by prefers-color-scheme), screenshots each one settled (Search also with
// the pointer on Bing), and records the grid: card, content column, every list group, each row's icon / text / trailing
// control edges, divider spans, and the footer's Back / counter / primary. One instance, closed in finally; loops capped.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
const { _electron } = require("playwright");
const arg = (name, fallback) => { const hit = process.argv.find((item) => item.startsWith("--" + name + "=")); return hit ? hit.slice(name.length + 3) : fallback; };
const tone = arg("tone", "light"), zoom = Number(arg("zoom", 1)), [width, height] = String(arg("size", "1440x900")).split("x").map(Number), tag = arg("tag", tone);
const out = path.join(root, "qa", "artifacts", "k-sheet-" + tag); await fs.mkdir(out, { recursive: true });
const data = path.join(root, ".qa-profiles/k-sheet-" + Date.now());
await fs.cp(path.join(root, ".qa-profiles/first-run-seed"), data, { recursive: true, filter: (s) => !/lockfile$|Singleton/.test(s) });
const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.join(root, ".qa-profiles/import-fixture") };
delete env.ELECTRON_RUN_AS_NODE; delete env.ACIRA_DEV;
const app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", path.join(root, "desktop/main.cjs")], env, colorScheme: tone, timeout: 30000 });
const shot = async (name) => {
  const png = await app.evaluate(async ({ webContents }) => { const c = webContents.getAllWebContents().find((w) => w.getURL() === "acira-browser-ui://ui/index.html"); await c.capturePage(); await new Promise((r) => setTimeout(r, 150)); return (await c.capturePage()).toPNG().toString("base64"); });
  await fs.writeFile(path.join(out, name + ".png"), Buffer.from(png, "base64"));
};
// Everything in card coordinates (CSS px from the card's top-left), rounded to 0.5.
const grid = (page) => page.evaluate(() => {
  const card = document.querySelector(".fr-card")?.getBoundingClientRect();
  if (!card) return null;
  const r = (b) => b && [b.left, b.top, b.right, b.bottom].map((v, i) => Math.round((v - (i % 2 ? card.top : card.left)) * 2) / 2);
  const box = (el) => el && r(el.getBoundingClientRect());
  const groups = [...document.querySelectorAll(".fr-card .fr-group")].map((g) => ({
    box: box(g),
    rows: [...g.querySelectorAll(":scope > .fr-row, :scope > label.fr-row, :scope > div.fr-row")].map((row) => {
      const before = getComputedStyle(row, "::before");
      const icon = row.querySelector("svg, img, .fr-row-icon, .profile-avatar, .fr-avatar");
      const text = row.querySelector(".fr-row-text, dt, b");
      const trail = row.querySelector(".fr-toggle, .fr-check, dd, .fr-val");
      return { box: box(row), icon: box(icon), text: box(text), trail: box(trail), divider: before.content !== "none" && before.content !== "normal" ? [before.left, before.right, before.backgroundColor, before.opacity].join(" ") : null };
    }),
  }));
  const foot = document.querySelector(".fr-foot");
  return {
    card: [Math.round(card.width), Math.round(card.height)],
    title: box(document.querySelector("#fr-title")), line: box(document.querySelector(".fr-card-line, .fr-lede, #fr-title + p")),
    looks: box(document.querySelector(".fr-looks")), profile: box(document.querySelector(".fr-profile")),
    groups,
    foot: foot && { box: box(foot), back: box(foot.querySelector(".fr-foot-start button")), counter: box(foot.querySelector(".fr-counter")), end: box(foot.querySelector(".fr-foot-end")), primary: box(foot.querySelector("[data-onboarding-primary]")) },
  };
});
// Leaf text with its colour and viewport box, for a contrast check against the real pixels behind it.
const texts = (page) => page.evaluate(() => [...document.querySelectorAll(".fr-stage h1, .fr-stage p, .fr-stage label, .fr-stage button, .fr-stage legend, .fr-stage span, .fr-stage b, .fr-stage small, .fr-stage dt, .fr-stage dd, .fr-stage em, .fr-stage a")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 && (e.tagName === "H1" || (e.childElementCount === 0 && !e.closest("h1"))) && e.textContent.trim() && getComputedStyle(e).visibility !== "hidden" && +getComputedStyle(e).opacity > .5 && !e.closest(".fr-avatar, .profile-avatar"); }).slice(0, 80).map((e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return { text: e.textContent.trim().slice(0, 40), color: s.color, size: s.fontSize, weight: s.fontWeight, box: [r.left, r.top, r.width, r.height].map(Math.round) }; }));
const report = { tone, zoom, steps: [] };
try {
  let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => w.url() === "acira-browser-ui://ui/index.html"); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  await page.waitForLoadState("domcontentloaded");
  await app.evaluate(({ BaseWindow }, s) => { const w = BaseWindow.getAllWindows()[0]; w?.setContentSize(s[0], s[1]); w?.center(); }, [width, height]);
  if (zoom !== 1) await app.evaluate(({ webContents }, f) => { for (const c of webContents.getAllWebContents()) if (c.getURL() === "acira-browser-ui://ui/index.html") c.setZoomFactor(f); }, zoom);
  await page.waitForSelector(".setup-dialog", { timeout: 20000 });
  await page.waitForTimeout(3500);
  const next = () => page.locator(".setup-dialog [data-onboarding-next]").first();
  // Setup starts dark; for the light sheet pick Light on the Look step, then walk back to the first step.
  if (tone === "light") {
    for (let i = 0; i < 5 && !(await page.locator(".fr-look").count()); i++) { await next().click(); await page.waitForTimeout(1300); }
    await page.locator(".fr-look").nth(0).click(); await page.waitForTimeout(900);
    for (let i = 0; i < 4 && (await page.locator(".fr-foot-start button").isVisible().catch(() => false)); i++) { await page.locator(".fr-foot-start button").click(); await page.waitForTimeout(1200); }
    for (let i = 0; i < 3 && !(await page.locator(".fr-welcome, .fr-w-hero").count()) && (await page.locator(".fr-foot-start button").isVisible().catch(() => false)); i++) { await page.locator(".fr-foot-start button").click(); await page.waitForTimeout(1200); }
  }
  await shot("00-first");
  for (let i = 1; i <= 8; i++) {
    if (i > 1 || !(await page.locator(".fr-card").count())) {
      if (!(await next().count())) break;
      await next().click(); await page.mouse.move(5, 5); await page.waitForTimeout(1500);
    }
    if (!(await page.locator(".setup-dialog").count())) break;
    const title = await page.evaluate(() => document.querySelector("#fr-title")?.getAttribute("aria-label") || "");
    const name = String(i).padStart(2, "0") + "-" + title.split(" ").slice(0, 2).join("-").replace(/[^a-z-]/gi, "").toLowerCase();
    await shot(name);
    report.steps.push({ step: i, title, shot: name, grid: await grid(page), texts: await texts(page) });
    if (/search engine/i.test(title)) {
      const bing = page.locator(".fr-row", { hasText: "Bing" }).first();
      if (await bing.count()) { await bing.hover(); await page.waitForTimeout(300); await shot(name + "-hover-bing"); await page.mouse.move(5, 5); await page.waitForTimeout(200); }
    }
  }
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 1));
  console.log("ok", out, report.steps.map((s) => s.title).join(" | "));
} finally {
  await app.close();
  await fs.rm(data, { recursive: true, force: true }).catch(() => {});
}
