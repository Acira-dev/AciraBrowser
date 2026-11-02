// Stream K: the Look step's live theme switch, measured.  node qa/k-theme-switch.mjs [--to=dark|light] [--zoom=1.5 --size=1350x900] [--profile] [--tag=x]
// Existing-install seed, isolated profile, Windows simulated light. Goes to the Look step in the other tone, then picks
// --to and records every animation frame for 1.5 s (gap, stage tone, card background colour, ghost opacity), main-thread
// long tasks, and with --profile a CPU profile of the switch (qa/artifacts/k-theme-switch-<tag>/switch.cpuprofile).
// One instance, closed in finally; loops capped.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
const { _electron } = require("playwright");
const arg = (n, d) => { const h = process.argv.find((a) => a.startsWith("--" + n + "=")); return h ? h.slice(n.length + 3) : process.argv.includes("--" + n) ? true : d; };
const to = arg("to", "dark"), zoom = Number(arg("zoom", 1)), [width, height] = String(arg("size", "1440x900")).split("x").map(Number), tag = arg("tag", "to-" + to + (zoom === 1 ? "" : "-150")), profile = arg("profile", false);
const out = path.join(root, "qa", "artifacts", "k-theme-switch-" + tag); await fs.mkdir(out, { recursive: true });
const data = path.join(root, ".qa-profiles/k-switch-" + Date.now());
await fs.cp(path.join(root, ".qa-profiles/first-run-seed"), data, { recursive: true, filter: (s) => !/lockfile$|Singleton/.test(s) });
const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.join(root, ".qa-profiles/import-fixture") };
delete env.ELECTRON_RUN_AS_NODE; delete env.ACIRA_DEV;
const app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", path.join(root, "desktop/main.cjs")], env, colorScheme: "light", timeout: 30000 });
try {
  let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => w.url() === "acira-browser-ui://ui/index.html"); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  await page.waitForLoadState("domcontentloaded");
  await app.evaluate(({ BaseWindow }, s) => { const w = BaseWindow.getAllWindows()[0]; w?.setContentSize(s[0], s[1]); w?.center(); }, [width, height]);
  if (zoom !== 1) await app.evaluate(({ webContents }, f) => { for (const c of webContents.getAllWebContents()) if (c.getURL() === "acira-browser-ui://ui/index.html") c.setZoomFactor(f); }, zoom);
  await page.waitForSelector(".setup-dialog", { timeout: 20000 }); await page.waitForTimeout(2500);
  const next = () => page.locator(".setup-dialog [data-onboarding-next]").first();
  for (let i = 0; i < 5 && !(await page.locator(".fr-look").count()); i++) { await next().click(); await page.waitForTimeout(1300); }
  const index = { light: 0, dark: 1 };
  const from = to === "dark" ? "light" : "dark";
  await page.locator(".fr-look").nth(index[from]).click(); await page.waitForTimeout(1800);
  // Long tasks and every frame from 150ms before the click to 1.5s after.
  await page.evaluate(() => {
    window.__long = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: "longtask", buffered: false }); } catch {}
    const stage = document.querySelector(".fr-stage"), card = document.querySelector(".fr-card");
    const rows = []; window.__frames = rows; let last = performance.now(); const t0 = last; window.__t0 = t0;
    window.addEventListener("pointerdown", (e) => { window.__down = Math.round(e.timeStamp - t0); }, { capture: true, once: true });
    // The crossfade's progress: the view transition's "new" animation, 0..1 (-1 when none is running).
    const vt = () => { const a = document.getAnimations().find((x) => String(x.effect?.pseudoElement || "").includes("view-transition-new")); if (!a) return -1; const d = a.effect.getComputedTiming(); return +(d.progress ?? -1).toFixed(2); };
    const tick = (now) => { rows.push([Math.round(now - t0), +(now - last).toFixed(1), stage.dataset.tone, getComputedStyle(card).backgroundColor, vt()]); last = now; if (now - t0 < 1650 && rows.length < 600) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  let cdp; if (profile) { cdp = await page.context().newCDPSession(page); await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 200 }); await cdp.send("Profiler.start"); }
  await page.waitForTimeout(150);
  const clickAt = await page.evaluate(() => Math.round(performance.now() - window.__t0));
  await page.locator(".fr-look").nth(index[to]).click();
  // Real composited frames while the crossfade runs.
  for (let i = 0; i < 3; i++) { await page.waitForTimeout(70); const png = await app.evaluate(async ({ webContents }) => { const c = webContents.getAllWebContents().find((w) => w.getURL() === "acira-browser-ui://ui/index.html"); return (await c.capturePage()).toPNG().toString("base64"); }); await fs.writeFile(path.join(out, `mid-${i}.png`), Buffer.from(png, "base64")); }
  await page.waitForTimeout(1300);
  if (cdp) { const { profile: p } = await cdp.send("Profiler.stop"); await fs.writeFile(path.join(out, "switch.cpuprofile"), JSON.stringify(p)); }
  const frames = await page.evaluate(() => window.__frames), long = await page.evaluate(() => window.__long.map(([s, d]) => [s - Math.round(window.__t0), d]));
  const after = frames.filter((f) => f[0] >= clickAt);
  const gaps = after.map((f) => f[1]).sort((a, b) => a - b);
  const down = await page.evaluate(() => window.__down ?? null);
  const firstDark = after.find((f) => f[2] === to), vtStart = after.find((f) => f[4] >= 0), vtEnd = [...after].reverse().find((f) => f[4] >= 0);
  const report = { to, zoom, pointerDown: down, clickAt, frames: after.length, p95: gaps[Math.floor(gaps.length * 0.95)], max: gaps[gaps.length - 1], longTasks: long.filter(([s]) => s >= clickAt - 50), toneFlipAfterPointer: firstDark && down !== null ? firstDark[0] - down : null, crossfadeFirstFrameAfterPointer: vtStart && down !== null ? vtStart[0] - down : null, crossfadeMs: vtStart && vtEnd ? vtEnd[0] - vtStart[0] : null, progress: after.filter((f) => f[4] >= 0).map((f) => f[4]).join(" ") };
  console.log(JSON.stringify(report));
  const big = after.filter((f) => f[1] > 20).slice(0, 12).map((f) => `${f[0] - clickAt}ms gap ${f[1]} tone ${f[2]} card ${f[3]} crossfade ${f[4]}`);
  console.log(big.join("\n"));
  await fs.writeFile(path.join(out, "frames.json"), JSON.stringify({ report, frames: after.map((f) => [f[0] - clickAt, ...f.slice(1)]) }, null, 1));
} finally {
  await app.close();
  await fs.rm(data, { recursive: true, force: true }).catch(() => {});
}
