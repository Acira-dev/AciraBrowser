// Stream K: setup starts dark whatever Windows is set to; only the Look step changes it.
//   node qa/k-dark-first.mjs [--os=light|dark] [--pick=light|dark|auto] [--zoom=1.5 --size=1350x900] [--tag=x]   (cwd = worktree root)
// Windows is simulated with Playwright's launch colorScheme (prefers-color-scheme from the first frame; the system theme is
// never touched). Walks welcome -> Look, samples the stage tone, the dissolve ghost and the title colour every frame around
// the pick (tone, crossfade progress, title colour), captures real frames, then continues one step and, after setup, reads the stored choice. One instance, closed
// in finally; every loop is capped.
import fs from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
import { launchPreparedNative } from "./prepared-native.mjs";
const arg = (name, fallback) => { const hit = process.argv.find((item) => item.startsWith("--" + name + "=")); return hit ? hit.slice(name.length + 3) : fallback; };
const os = arg("os", "light"), pick = arg("pick", "light"), zoom = Number(arg("zoom", 1)), [width, height] = String(arg("size", "1440x900")).split("x").map(Number);
const tag = arg("tag", `os-${os}-pick-${pick}` + (zoom === 1 ? "" : "-" + zoom * 100));
const out = path.join(root, "qa", "artifacts", "k-dark-first-" + tag); await fs.mkdir(out, { recursive: true });
const fixture = path.join(root, ".qa-profiles/import-fixture");
if (!(await fs.stat(fixture).then(() => true, () => false))) throw new Error("run qa/k-first-run-walk.mjs once to build the import fixture");
const data = path.join(root, ".qa-profiles/k-darkfirst-" + Date.now());
// An empty profile: a genuine first run (no stored settings), prepared with its own native key like M's rig.
await fs.mkdir(data, { recursive: true });
const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: fixture };
delete env.ELECTRON_RUN_AS_NODE; delete env.ACIRA_DEV;
const app = await launchPreparedNative({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", path.join(root, "desktop/main.cjs")], env, colorScheme: os, timeout: 30000 });
const shot = async (name) => {
  const png = await app.evaluate(async ({ webContents }) => { const c = webContents.getAllWebContents().find((w) => w.getURL() === "acira-browser-ui://ui/index.html"); await c.capturePage(); await new Promise((r) => setTimeout(r, 120)); return (await c.capturePage()).toPNG().toString("base64"); });
  await fs.writeFile(path.join(out, name + ".png"), Buffer.from(png, "base64"));
};
const report = { os, pick, zoom };
try {
  let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => w.url() === "acira-browser-ui://ui/index.html"); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  await page.waitForLoadState("domcontentloaded");
  await app.evaluate(({ BaseWindow }, s) => { const w = BaseWindow.getAllWindows()[0]; w?.setContentSize(s[0], s[1]); w?.center(); }, [width, height]);
  if (zoom !== 1) await app.evaluate(({ webContents }, f) => { for (const c of webContents.getAllWebContents()) if (c.getURL() === "acira-browser-ui://ui/index.html") c.setZoomFactor(f); }, zoom);
  await page.waitForSelector(".setup-dialog", { timeout: 20000 });
  const probe = () => page.evaluate(() => ({ os: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light", app: document.querySelector(".app")?.dataset.theme, stage: document.querySelector(".fr-stage")?.dataset.tone, title: document.querySelector("#fr-title")?.getAttribute("aria-label") || document.querySelector("#fr-title")?.textContent?.slice(0, 30) }));
  await page.waitForTimeout(3300);
  report.welcome = await probe(); await shot("00-welcome");
  // To the Look step: Not now (Import), Continue (Profile), landing on the Look step.
  const next = () => page.locator(".setup-dialog [data-onboarding-next]").first();
  for (let i = 0; i < 6 && !(await page.locator(".fr-look").count()); i++) { await next().click(); await page.waitForTimeout(1500); if (i === 0) report.firstStep = await probe(); }
  await page.waitForTimeout(600);
  report.look = { ...(await probe()), selected: await page.$$eval(".fr-look", (items) => items.map((i) => i.querySelector("input").checked)) };
  await shot("01-look-before");
  // Sample every frame for 1.4s around the pick.
  await page.evaluate(() => { const stage = document.querySelector(".fr-stage"), title = document.querySelector("#fr-title"); const vt = () => { const a = document.getAnimations().find((x) => String(x.effect?.pseudoElement || "").includes("view-transition-new")); return a ? +(a.effect.getComputedTiming().progress ?? -1).toFixed(2) : -1; }; const rows = []; window.__tone = rows; const t0 = performance.now(); const tick = () => { rows.push([Math.round(performance.now() - t0), stage.dataset.tone, document.documentElement.hasAttribute("data-fr-switch") ? "x" : "-", vt(), getComputedStyle(title).color.replace(/rgba?\(|\)/g, ""), [...document.querySelectorAll(".fr-look input")].map((i) => (i.checked ? 1 : 0)).join("")]); if (performance.now() - t0 < 4200 && rows.length < 700) requestAnimationFrame(tick); }; tick(); });
  const index = { light: 0, dark: 1, auto: 2 }[pick];
  await page.waitForTimeout(150);
  await page.locator(".fr-look").nth(index).click();
  const shots = []; for (let i = 0; i < 3; i++) { await page.waitForTimeout(40); shots.push(shot(`02-look-after-click-${i}`)); await shots[i]; }
  await page.waitForTimeout(3600);
  const rows = await page.evaluate(() => window.__tone);
  const compact = []; let last = ""; for (const r of rows) { const key = [r[1], r[2], r[5]].join("|"); if (key !== last || compact.length === 0) { compact.push(r.join(" ")); last = key; } }
  report.samples = { frames: rows.length, changes: compact.slice(0, 30), maxGapMs: Math.max(...rows.slice(1).map((r, i) => r[0] - rows[i][0])) };
  report.afterPick = await probe(); await shot("03-look-after");
  await next().click(); await page.waitForTimeout(1600);
  report.nextStep = await probe(); await shot("04-next-step");
  for (let i = 0; i < 8 && (await page.locator(".setup-dialog").count()); i++) { await next().click(); await page.waitForTimeout(1300); }
  await page.waitForTimeout(1500);
  report.afterSetup = await probe();
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
} finally {
  await app.close();
  await fs.rm(data, { recursive: true, force: true }).catch(() => {});
}
