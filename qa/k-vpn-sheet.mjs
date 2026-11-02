// Stream K: setup Privacy step, "Use my VPN app" side of the Connection sheet (J's detected VPN apps and the folded
// "Get a VPN app" providers).  node qa/k-vpn-sheet.mjs [--tone=light|dark] [--zoom=1.5 --size=1350x900] [--tag=x]
// Existing-install seed, isolated profile. Captures the row, the folded sheet, the disclosure opening (height per frame)
// and open, checks the sheet still fits above its footer, and never clicks a provider (no external site is opened).
// One instance, closed in finally; loops capped.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
const { _electron } = require("playwright");
const arg = (name, fallback) => { const hit = process.argv.find((item) => item.startsWith("--" + name + "=")); return hit ? hit.slice(name.length + 3) : process.argv.includes("--" + name) ? true : fallback; };
const tone = arg("tone", "dark"), zoom = Number(arg("zoom", 1)), [width, height] = String(arg("size", "1440x900")).split("x").map(Number), tag = arg("tag", tone + (zoom === 1 ? "" : "150")), apply = arg("apply", false);
const out = path.join(root, "qa", "artifacts", "k-vpn-sheet-" + tag); await fs.mkdir(out, { recursive: true });
const data = path.join(root, ".qa-profiles/k-vpn-" + Date.now());
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
  await shot("01-privacy");
  // No VPN app runs on the test PC, so the detected lines are measured by putting them in the row: it must keep air above the footer.
  log("detected lines:", JSON.stringify(await page.evaluate((lines) => { const small = document.querySelector(".fr-more small"), was = small.textContent, foot = document.querySelector(".fr-foot").getBoundingClientRect().top; const fits = lines.map((line) => { small.textContent = line; const groups = [...document.querySelectorAll(".fr-card-main .fr-group")]; return [line.length, Math.round(small.getBoundingClientRect().height / 16), Math.round(foot - groups[groups.length - 1].getBoundingClientRect().bottom)]; }); small.textContent = was; return fits; }, ["Mullvad VPN is running. Acira already follows it.", "Private Internet Access is running. Acira already follows it.", "OpenVPN or a similar VPN is set up. Acira follows it when on.", "Mullvad VPN and Tailscale are running. Acira already follows them."])));
  await page.locator(".fr-more").first().click(); await page.waitForTimeout(600);
  const sheetFit = () => page.evaluate(() => { const main = document.querySelector(".fr-sheet-main"), foot = document.querySelector(".fr-sheet .fr-foot").getBoundingClientRect(), kids = [...main.children].filter((k) => k.getBoundingClientRect().height > 0), last = kids[kids.length - 1].getBoundingClientRect(); return { lastBottom: Math.round(last.bottom), footTop: Math.round(foot.top), air: Math.round(foot.top - last.bottom), rows: [...document.querySelectorAll(".fr-sheet .fr-row")].filter((r) => r.getBoundingClientRect().height > 1).map((r) => r.textContent.replace(/\s+/g, " ").trim().slice(0, 70)) }; });
  log("sheet, folded:", JSON.stringify(await sheetFit()));
  await shot("02-sheet-folded");
  const toggle = page.locator('.fr-sheet .fr-more[aria-expanded]');
  log("disclosure rows:", await toggle.count());
  if (await toggle.count()) {
    await toggle.hover(); await page.waitForTimeout(250); await shot("03-disclosure-hover");
    // Motion: sample the folded block's height every frame while it opens (it must grow over several frames, not jump).
    const heights = page.evaluate(() => new Promise((done) => { const box = document.querySelector("#fr-vpn-providers"), out = []; let n = 0; const tick = () => { out.push(Math.round(box.getBoundingClientRect().height)); if (++n < 24) requestAnimationFrame(tick); else done(out); }; requestAnimationFrame(tick); }));
    await toggle.click();
    log("open motion heights:", JSON.stringify(await heights));
    await page.waitForTimeout(400); await page.mouse.move(5, 5); await page.waitForTimeout(300);
    log("sheet, open:", JSON.stringify(await sheetFit()), "| expanded:", await toggle.getAttribute("aria-expanded"));
    await shot("04-sheet-open");
    await page.locator(".fr-sheet .fr-out").first().hover(); await page.waitForTimeout(250); await shot("05-provider-hover");
    await page.mouse.move(5, 5);
    await toggle.click(); await page.waitForTimeout(500);
    log("folded again:", await toggle.getAttribute("aria-expanded"), "| providers inert:", await page.evaluate(() => document.querySelector("#fr-vpn-providers")?.inert));
  }
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  log("after Escape: sheet", await page.locator(".fr-sheet").count(), "| step", await title());
} finally {
  await app.close();
  await fs.rm(data, { recursive: true, force: true }).catch(() => {});
}
