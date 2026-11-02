// Stream K: put candidate LIGHT backgrounds behind the real setup card.  node qa/k-light-options.mjs <framesDir> [a,b,c] [--frames=96]
// Existing-install seed, isolated profile; picks Light on the Look step, goes to the Privacy step, hides the scene canvas
// (so the card's own CSS glass frosts whatever is behind it) and draws each option frame (opt-<x>-NNN.jpg, 1440×900)
// on a canvas in the scene's place, capturing the real window each time. Output: docs/launch/concepts/setup-light-options/
// <x>-card.png (frame 0) and <x>-frames/NNN.png for the clip. One instance, closed in finally; loops capped.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
const { _electron } = require("playwright");
const framesDir = process.argv[2];
const which = (process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "a,b,c").split(",");
const count = Math.min(240, Number((process.argv.find((a) => a.startsWith("--frames=")) || "--frames=96").slice(9)));
const out = path.join(root, (process.argv.find((a) => a.startsWith("--out=")) || "--out=docs/launch/concepts/setup-light-options").slice(6));
const data = path.join(root, ".qa-profiles/k-lightopt-" + Date.now());
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
  // The scene canvas steps aside; a plain canvas in its place shows the option, and the card's CSS glass frosts it.
  await page.evaluate(() => {
    const stage = document.querySelector(".fr-stage");
    for (const c of stage.querySelectorAll(":scope > canvas")) { c.style.display = "none"; delete c.dataset.glass; }
    const opt = document.createElement("canvas"); opt.id = "k-opt"; opt.width = 1440; opt.height = 900;
    Object.assign(opt.style, { position: "absolute", inset: "0", width: "100%", height: "100%", zIndex: "-2", pointerEvents: "none" });
    stage.prepend(opt);
  });
  for (const o of which) {
    const dir = path.join(out, `${o}-frames`); await fs.mkdir(dir, { recursive: true });
    for (let i = 0; i < count; i++) {
      const file = path.join(framesDir, `opt-${o}-${String(i).padStart(3, "0")}.jpg`);
      const b64 = (await fs.readFile(file)).toString("base64");
      await page.evaluate(async (b64) => { const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)); const bmp = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" })); document.getElementById("k-opt").getContext("2d").drawImage(bmp, 0, 0, 1440, 900); }, b64);
      const png = Buffer.from(await capture(), "base64");
      await fs.writeFile(path.join(dir, String(i).padStart(3, "0") + ".png"), png);
      if (i === 0) await fs.writeFile(path.join(out, `${o}-card.png`), png);
    }
    console.log("option", o, count, "frames");
  }
} finally {
  await app.close();
  await fs.rm(data, { recursive: true, force: true }).catch(() => {});
}
