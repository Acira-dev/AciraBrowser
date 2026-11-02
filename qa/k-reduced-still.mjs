// Stream K: the light setup scene under reduced motion holds one still frame.  node qa/k-reduced-still.mjs
// Existing-install seed, isolated profile; picks Light, goes to the Privacy step, emulates prefers-reduced-motion and
// captures twice 1.5 s apart (a, b: must match), then again without it (c, d: must differ). One instance, closed in finally.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
const { _electron } = require("playwright");
const out = path.join(root, "qa", "artifacts", "k-reduced-still"); await fs.mkdir(out, { recursive: true });
const data = path.join(root, ".qa-profiles/k-reduced-" + Date.now());
await fs.cp(path.join(root, ".qa-profiles/first-run-seed"), data, { recursive: true, filter: (s) => !/lockfile$|Singleton/.test(s) });
const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.join(root, ".qa-profiles/import-fixture") };
delete env.ELECTRON_RUN_AS_NODE; delete env.ACIRA_DEV;
const app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", path.join(root, "desktop/main.cjs")], env, colorScheme: "light", timeout: 30000 });
const capture = () => app.evaluate(async ({ webContents }) => { const c = webContents.getAllWebContents().find((w) => w.getURL() === "acira-browser-ui://ui/index.html"); await c.capturePage(); await new Promise((r) => setTimeout(r, 60)); return (await c.capturePage()).toPNG().toString("base64"); });
try {
  let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => w.url() === "acira-browser-ui://ui/index.html"); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  await page.waitForLoadState("domcontentloaded");
  await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w?.setContentSize(1440, 900); w?.center(); });
  await page.waitForSelector(".setup-dialog", { timeout: 20000 }); await page.waitForTimeout(2500);
  const next = () => page.locator(".setup-dialog [data-onboarding-next]").first();
  const title = () => page.evaluate(() => document.querySelector("#fr-title")?.getAttribute("aria-label") || "");
  for (let i = 0; i < 5 && !(await page.locator(".fr-look").count()); i++) { await next().click(); await page.waitForTimeout(1300); }
  await page.locator(".fr-look").nth(0).click(); await page.waitForTimeout(900);
  for (let i = 0; i < 5 && !/Private/.test(await title()); i++) { await next().click(); await page.waitForTimeout(1300); }
  await page.mouse.move(5, 5); await page.waitForTimeout(600);
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.waitForTimeout(1200);
  const reduced = await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  await fs.writeFile(path.join(out, "a.png"), Buffer.from(await capture(), "base64")); await page.waitForTimeout(1500);
  await fs.writeFile(path.join(out, "b.png"), Buffer.from(await capture(), "base64"));
  await page.emulateMedia({ reducedMotion: "no-preference" }); await page.waitForTimeout(1200);
  await fs.writeFile(path.join(out, "c.png"), Buffer.from(await capture(), "base64")); await page.waitForTimeout(1500);
  await fs.writeFile(path.join(out, "d.png"), Buffer.from(await capture(), "base64"));
  console.log("ok reduced:", reduced, out);
} finally {
  await app.close();
  await fs.rm(data, { recursive: true, force: true }).catch(() => {});
}
