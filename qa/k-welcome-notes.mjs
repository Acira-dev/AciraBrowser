// Stream K: the welcome load, captured for the founder's older notes (soft beams, drifting fog lit by the beams, smooth
// rainbow travel, still non-repeating grain, logo and headline on the vapor reveal).  node qa/k-welcome-notes.mjs [--tag=x]
// An empty profile (a genuine first run, dark). Once the welcome is up the UI page is reloaded so the ~1.6 s sequence starts
// again under the capture: real frames as fast as capturePage allows for 2.4 s (capped at 30), then single frames 4 s and
// 8 s later for the drift. Writes qa/artifacts/k-welcome-<tag>/NN-<ms>.png and report.json. One instance, closed in finally.
import fs from "node:fs/promises";
import path from "node:path";
import { launchPreparedNative } from "./prepared-native.mjs";
const root = process.cwd();
const arg = (name, fallback) => { const hit = process.argv.find((item) => item.startsWith("--" + name + "=")); return hit ? hit.slice(name.length + 3) : fallback; };
const out = path.join(root, "qa", "artifacts", "k-welcome-" + arg("tag", "notes")); await fs.mkdir(out, { recursive: true });
const fixture = path.join(root, ".qa-profiles/import-fixture");
if (!(await fs.stat(fixture).then(() => true, () => false))) throw new Error("run qa/k-first-run-walk.mjs once to build the import fixture");
const data = path.join(root, ".qa-profiles/k-welcome-" + Date.now());
await fs.mkdir(data, { recursive: true });
const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: fixture };
delete env.ELECTRON_RUN_AS_NODE; delete env.ACIRA_DEV;
const app = await launchPreparedNative({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", path.join(root, "desktop/main.cjs")], env, colorScheme: "dark", timeout: 30000 });
const capture = () => app.evaluate(async ({ webContents }) => { const c = webContents.getAllWebContents().find((w) => w.getURL() === "acira-browser-ui://ui/index.html"); return (await c.capturePage()).toPNG().toString("base64"); });
const report = { frames: [] };
try {
  let page; for (let i = 0; i < 150 && !page; i++) { page = app.windows().find((w) => w.url() === "acira-browser-ui://ui/index.html"); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  if (!page) throw new Error("no UI page");
  await page.waitForLoadState("domcontentloaded");
  await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w?.setContentSize(1440, 900); w?.center(); });
  await page.waitForSelector(".fr-stage", { timeout: 20000 }); await page.waitForTimeout(2500);
  await capture();
  const t0 = Date.now();
  await page.reload();
  for (let i = 0; i < 30 && Date.now() - t0 < 2400; i++) {
    const png = await capture(), ms = Date.now() - t0;
    const name = `${String(i).padStart(2, "0")}-${ms}`;
    await fs.writeFile(path.join(out, name + ".png"), Buffer.from(png, "base64")); report.frames.push(name);
  }
  report.state = await page.evaluate(() => ({ tone: document.querySelector(".fr-stage")?.dataset.tone, title: document.querySelector("h1, .fr-hero")?.textContent?.trim(), canvases: document.querySelectorAll(".fr-stage canvas").length, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  for (const at of [6400, 10400]) {
    await page.waitForTimeout(Math.max(0, at - (Date.now() - t0)));
    const name = `drift-${Date.now() - t0}`;
    await fs.writeFile(path.join(out, name + ".png"), Buffer.from(await capture(), "base64")); report.frames.push(name);
  }
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log("ok", out, report.frames.length, "frames", JSON.stringify(report.state));
} finally {
  await app.close();
  await fs.rm(data, { recursive: true, force: true }).catch(() => {});
}
