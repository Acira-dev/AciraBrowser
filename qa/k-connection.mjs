// Stream K: setup Privacy step's Connection row and proxy sheet.  node qa/k-connection.mjs [--tone=light|dark] [--zoom=1.5 --size=1350x900] [--apply] [--tag=x]
// Existing-install seed, isolated profile. Opens the sheet, switches to a proxy, fills 127.0.0.1:9 (a closed local port, so the
// test fails without touching the network), tests it, checks that Escape and Enter stay in the sheet, cancels, and with --apply
// applies through Acira's own confirm window. One instance, closed in finally; loops capped.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
const { _electron } = require("playwright");
const arg = (name, fallback) => { const hit = process.argv.find((item) => item.startsWith("--" + name + "=")); return hit ? hit.slice(name.length + 3) : process.argv.includes("--" + name) ? true : fallback; };
const tone = arg("tone", "dark"), zoom = Number(arg("zoom", 1)), [width, height] = String(arg("size", "1440x900")).split("x").map(Number), tag = arg("tag", tone + (zoom === 1 ? "" : "150")), apply = arg("apply", false);
const out = path.join(root, "qa", "artifacts", "k-connection-" + tag); await fs.mkdir(out, { recursive: true });
const data = path.join(root, ".qa-profiles/k-conn-" + Date.now());
await fs.cp(path.join(root, ".qa-profiles/first-run-seed"), data, { recursive: true, filter: (s) => !/lockfile$|Singleton/.test(s) });
const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.join(root, ".qa-profiles/import-fixture") };
delete env.ELECTRON_RUN_AS_NODE; delete env.ACIRA_DEV;
const app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", path.join(root, "desktop/main.cjs")], env, colorScheme: tone, timeout: 30000 });
const shot = async (name) => {
  const png = await app.evaluate(async ({ webContents }) => { const c = webContents.getAllWebContents().find((w) => w.getURL() === "acira-browser-ui://ui/index.html"); await c.capturePage(); await new Promise((r) => setTimeout(r, 150)); return (await c.capturePage()).toPNG().toString("base64"); });
  await fs.writeFile(path.join(out, name + ".png"), Buffer.from(png, "base64"));
};
const log = (...a) => console.log(...a);
// Acira's confirm window is one pooled window; it only takes trusted input. Wait until it is shown, then click by text.
const answerConfirm = async (label) => {
  for (let i = 0; i < 40; i++) {
    const shown = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().some((w) => w.isVisible() && w.getBounds().width <= 700 && w.getBounds().height <= 520));
    const dlg = app.windows().find((w) => /native-dialog/.test(w.url()));
    if (shown && dlg) {
      const box = await dlg.evaluate((label) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === label); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, document.body.innerText.slice(0, 80).replace(/\s+/g, " ")]; }, label);
      if (box) { await dlg.mouse.click(box[0], box[1]); return box[2]; }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
};
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
  await page.locator(".fr-more").click(); await page.waitForTimeout(500);
  log("sheet open:", await page.locator(".fr-sheet").count(), "| focus:", await page.evaluate(() => document.activeElement?.textContent || document.activeElement?.tagName));
  await shot("02-sheet-vpn");
  await page.locator(".fr-sheet .acira-seg").first().locator("button").nth(1).click(); await page.waitForTimeout(400);
  await page.locator('.fr-sheet input[aria-label="Proxy host"]').fill("127.0.0.1");
  await page.locator('.fr-sheet input[aria-label="Proxy port"]').fill("9");
  if (!apply) { await page.keyboard.press("Enter"); await page.waitForTimeout(300); }   // must not leave the step; with a valid address it applies (confirm window)
  const afterEnter = { title: await title(), sheet: await page.locator(".fr-sheet").count() };
  log("after Enter:", JSON.stringify(afterEnter));
  // Enter applies from the address field: Acira's confirm opens; answer Cancel so nothing changes yet.
  if (!apply) log("confirm after Enter, answered Cancel:", await answerConfirm("Cancel"));
  await page.waitForTimeout(500);
  await page.locator(".fr-sheet button", { hasText: "Test proxy" }).click(); await page.waitForTimeout(2500);
  log("test line:", await page.locator(".fr-sheet [role=status]").textContent());
  await shot("03-sheet-proxy");
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);
  log("after Escape: sheet", await page.locator(".fr-sheet").count(), "| setup still open", await page.locator(".setup-dialog").count(), "| step", await title(), "| row", await page.evaluate(() => document.querySelector(".fr-more")?.closest(".fr-row")?.querySelector("small")?.textContent));
  if (apply) {
    await page.locator(".fr-more").click(); await page.waitForTimeout(400);
    await page.locator(".fr-sheet .acira-seg").first().locator("button").nth(1).click();
    await page.locator('.fr-sheet input[aria-label="Proxy host"]').fill("127.0.0.1"); await page.locator('.fr-sheet input[aria-label="Proxy port"]').fill("9");
    await page.locator(".fr-sheet button", { hasText: "Apply" }).click();
    log("confirm after Apply, answered Use this proxy:", await answerConfirm("Use this proxy"));
    const t0 = Date.now(); for (let i = 0; i < 60 && (await page.locator(".fr-sheet").count()); i++) await page.waitForTimeout(250);
    log("sheet closed after ms:", Date.now() - t0);
    log("visible windows:", JSON.stringify(await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().filter((w) => w.isVisible()).map((w) => w.getBounds()))));
    log("sheet note:", await page.locator(".fr-sheet .fr-sheet-note").textContent().catch(() => "-"), "| apply disabled:", await page.locator(".fr-sheet button", { hasText: "Apply" }).isDisabled().catch(() => "-"));
    log("after apply: sheet", await page.locator(".fr-sheet").count(), "| row", await page.evaluate(() => document.querySelector(".fr-more")?.closest(".fr-row")?.querySelector("small")?.textContent));
    await shot("04-applied");
  }
} finally {
  await app.close();
  await fs.rm(data, { recursive: true, force: true }).catch(() => {});
}
