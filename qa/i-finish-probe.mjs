// Stream I probe: does a fresh setup ever land on a finish the person didn't pick? Walks setup (Dark on the Look
// step, nothing else chosen) and prints colorPreset/browserTint after each step and when Make it yours opens.
// node qa/i-finish-probe.mjs [runs=2]   (needs .qa-profiles/first-run-seed + import-fixture, copied from stream F)
import { _electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd(), runs = Number(process.argv[2] || 2), wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let run = 1; run <= runs; run++) {
  const data = path.join(root, ".qa-profiles/i-finish-" + Date.now());
  await fs.cp(path.join(root, ".qa-profiles/first-run-seed"), data, { recursive: true, filter: (s) => !/lockfile$|Singleton/.test(s) });
  const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.join(root, ".qa-profiles/import-fixture") };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: [path.join(root, "desktop/main.cjs")], env, timeout: 30000 });
  let page;
  const finish = async () => page.evaluate(async () => { const s = (await window.acira.getSnapshot()).settings; return s.colorPreset + "/" + s.browserTint + "/" + s.appearance; }).catch((e) => "err " + e.message.slice(0, 40));
  try {
    for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((p) => p.url() === "acira-browser-ui://ui/index.html"); if (!page) await wait(200); }
    await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setContentSize(1440, 900); w.center(); });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForSelector(".setup-dialog", { timeout: 20000 });
    await wait(3000);
    const log = ["start " + (await finish())];
    for (let i = 0; i < 10; i++) {
      const next = page.locator(".setup-dialog [data-onboarding-next]");
      if (!(await next.count())) break;
      if (await page.locator(".fr-look").count()) { await page.locator(".fr-look", { hasText: "Dark" }).first().click(); await wait(600); log.push("look:dark " + (await finish())); }
      await next.first().click();
      await wait(1300);
      log.push("step" + (i + 1) + " " + (await finish()));
    }
    await wait(2500);
    log.push("panel " + (await finish()) + " | panel label: " + (await page.locator(".fr-yours-row em").first().textContent().catch(() => "?")));
    console.log("RUN " + run + ": " + log.join(" → "));
  } catch (error) {
    console.log("RUN " + run + " FATAL " + error.message.split("\n")[0]);
  } finally {
    await app.close().catch(() => {});
    await fs.rm(data, { recursive: true, force: true }).catch(() => {});
  }
}
