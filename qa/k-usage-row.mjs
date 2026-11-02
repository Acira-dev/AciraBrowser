// Stream K: setup Privacy step, the opt-in "Anonymous usage" row (J's useMetrics) and its "What's sent" sheet.
//   node qa/k-usage-row.mjs [--tone=light|dark] [--zoom=1.5 --size=1350x900] [--tag=x]
// Existing-install seed, isolated profile (J's endpoint is empty in tests, so nothing can be sent). Checks the row's line
// and the step's air off and on, opens the sheet (exact payload, fits above its footer), closes it with Escape and Enter
// without leaving the step, and turns the switch off again. One instance, closed in finally; loops capped.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
const { _electron } = require("playwright");
const arg = (name, fallback) => { const hit = process.argv.find((item) => item.startsWith("--" + name + "=")); return hit ? hit.slice(name.length + 3) : process.argv.includes("--" + name) ? true : fallback; };
const tone = arg("tone", "dark"), zoom = Number(arg("zoom", 1)), [width, height] = String(arg("size", "1440x900")).split("x").map(Number), tag = arg("tag", tone + (zoom === 1 ? "" : "150")), apply = arg("apply", false);
const out = path.join(root, "qa", "artifacts", "k-usage-row-" + tag); await fs.mkdir(out, { recursive: true });
const data = path.join(root, ".qa-profiles/k-usage-" + Date.now());
await fs.cp(path.join(root, ".qa-profiles/first-run-seed"), data, { recursive: true, filter: (s) => !/lockfile$|Singleton/.test(s) });
const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.join(root, ".qa-profiles/import-fixture") };
delete env.ELECTRON_RUN_AS_NODE; delete env.ACIRA_DEV;
const app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", path.join(root, "desktop/main.cjs")], env, colorScheme: tone, timeout: 30000 });
const shot = async (name) => {
  const png = await app.evaluate(async ({ webContents }) => { const c = webContents.getAllWebContents().find((w) => w.getURL() === "acira-browser-ui://ui/index.html"); await c.capturePage(); await new Promise((r) => setTimeout(r, 150)); return (await c.capturePage()).toPNG().toString("base64"); });
  await fs.writeFile(path.join(out, name + ".png"), Buffer.from(png, "base64"));
};
const log = (...a) => console.log(...a);
try {
  let page; for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((w) => w.url() === "acira-browser-ui://ui/index.html"); if (!page) await new Promise((r) => setTimeout(r, 200)); }
  await page.waitForLoadState("domcontentloaded");
  await app.evaluate(({ BaseWindow }, s) => { const w = BaseWindow.getAllWindows()[0]; w?.setContentSize(s[0], s[1]); w?.center(); }, [width, height]);
  if (zoom !== 1) await app.evaluate(({ webContents }, f) => { for (const c of webContents.getAllWebContents()) if (c.getURL() === "acira-browser-ui://ui/index.html") c.setZoomFactor(f); }, zoom);
  await page.waitForSelector(".setup-dialog", { timeout: 20000 }); await page.waitForTimeout(2500);
  const next = () => page.locator(".setup-dialog [data-onboarding-next]").first();
  const title = () => page.evaluate(() => document.querySelector("#fr-title")?.getAttribute("aria-label") || "");
  if (tone === "light") { for (let i = 0; i < 5 && !(await page.locator(".fr-look").count()); i++) { await next().click(); await page.waitForTimeout(1300); } await page.locator(".fr-look").nth(0).click(); await page.waitForTimeout(800); }
  for (let i = 0; i < 7 && !/Private/.test(await title()); i++) { await next().click(); await page.waitForTimeout(1300); }
  await page.mouse.move(5, 5); await page.waitForTimeout(500);
  const fit = await page.evaluate(() => { const main = document.querySelector(".fr-card-main").getBoundingClientRect(), foot = document.querySelector(".fr-foot").getBoundingClientRect(), groups = [...document.querySelectorAll(".fr-card-main .fr-group")].map((g) => g.getBoundingClientRect()); const last = groups[groups.length - 1]; return { lastGroupBottom: Math.round(last.bottom), footTop: Math.round(foot.top), air: Math.round(foot.top - last.bottom), row: document.querySelector(".fr-more")?.closest(".fr-row")?.textContent }; });
  log("privacy step fit", await title(), JSON.stringify(fit));
  const row = () => page.locator(".fr-row", { has: page.locator("b", { hasText: "Anonymous usage" }) });
  const air = () => page.evaluate(() => { const foot = document.querySelector(".fr-card > .fr-foot, .fr-foot").getBoundingClientRect().top, groups = [...document.querySelectorAll(".fr-card-main .fr-group")]; return Math.round(foot - groups[groups.length - 1].getBoundingClientRect().bottom); });
  const line = () => row().locator("small").innerText();
  log("off:", JSON.stringify({ checked: await row().locator("input").isChecked(), line: await line(), air: await air(), rowH: Math.round((await row().boundingBox()).height) }));
  await shot("01-privacy-off");
  await row().locator("input").click(); await page.waitForTimeout(700);
  log("on:", JSON.stringify({ checked: await row().locator("input").isChecked(), line: await line(), air: await air(), rowH: Math.round((await row().boundingBox()).height) }));
  await shot("02-privacy-on");
  await row().locator(".fr-inline-link").click(); await page.waitForTimeout(500);
  const sheet = await page.evaluate(() => { const s = document.querySelector(".fr-sheet"); if (!s) return null; const main = s.querySelector(".fr-sheet-main"), foot = s.querySelector(".fr-foot").getBoundingClientRect(), kids = [...main.children], last = kids[kids.length - 1].getBoundingClientRect(), code = s.querySelector(".fr-sheet-code"); return { title: s.querySelector("h2")?.textContent, air: Math.round(foot.top - last.bottom), codeScroll: code.scrollHeight > code.clientHeight + 1, payload: code.textContent.replace(/\s+/g, " ").slice(0, 160), focus: document.activeElement?.textContent }; });
  log("sheet:", JSON.stringify(sheet));
  await shot("03-whats-sent");
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  log("after Escape: sheet", await page.locator(".fr-sheet").count(), "| step", await title());
  await row().locator(".fr-inline-link").click(); await page.waitForTimeout(400);
  await page.keyboard.press("Enter"); await page.waitForTimeout(400);
  log("after Enter: sheet", await page.locator(".fr-sheet").count(), "| step", await title());
  await row().locator("input").click(); await page.waitForTimeout(700);
  log("off again:", await row().locator("input").isChecked(), "|", await line());
} finally {
  await app.close();
  await fs.rm(data, { recursive: true, force: true }).catch(() => {});
}
