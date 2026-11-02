// First-run capture: launches Acira with a fresh isolated profile and records the onboarding window.
// node qa/first-run-capture.mjs [--frames=12] [--interval=80] [--dark] [--reduced] [--size=1280x800] [--walk] [--keep=dir]
import { _electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd(),
  arg = (name, fallback) => {
    const hit = process.argv.find((item) => item.startsWith("--" + name + "="));
    return hit ? hit.slice(name.length + 3) : process.argv.includes("--" + name) ? true : fallback;
  };
const run = Date.now(),
  keep = arg("keep", ""),
  data = keep ? path.resolve(keep) : path.join(root, ".qa-profiles/first-run-" + run),
  out = path.join(root, "qa/artifacts/first-run-" + run),
  frames = Number(arg("frames", 12)),
  interval = Number(arg("interval", 80)),
  [width, height] = String(arg("size", "1280x800")).split("x").map(Number);
// The first launch of a new profile commits its native key and relaunches itself, which Playwright cannot follow.
// So each run copies a seed profile that already passed that restart and still has setup at "welcome".
const seed = path.join(root, ".qa-profiles/first-run-seed");
const exists = (file) => fs.access(file).then(() => true, () => false);
if (!(await exists(path.join(seed, "setup/onboarding.json")))) {
  // Build the seed once: launch plainly, let it relaunch for its key, wait for setup to record "welcome", stop it.
  const { spawn, execFileSync } = await import("node:child_process");
  const seedEnv = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: seed };
  delete seedEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(path.join(root, "node_modules/electron/dist/electron.exe"), [path.join(root, "desktop/main.cjs")], { env: seedEnv, stdio: "ignore" });
  for (let i = 0; i < 200 && !(await exists(path.join(seed, "setup/onboarding.json"))); i++) await new Promise((r) => setTimeout(r, 200));
  await new Promise((r) => setTimeout(r, 1500));
  // The relaunched instance is a new process; stop every Electron that runs this checkout's main.cjs with the seed.
  try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
  try {
    execFileSync("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "name='electron.exe'" | Where-Object { $_.CommandLine -like '*${root.replace(/'/g, "''")}*' -and $_.CommandLine -like '*native-key-bootstrap*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { stdio: "ignore" });
  } catch {}
  await new Promise((r) => setTimeout(r, 800));
}
if ((arg("import", false) || arg("fixture", false) || arg("undo", false)) && !(await exists(path.join(root, ".qa-profiles/import-fixture")))) {
  // A synthetic Chrome profile: 47 bookmarks in a bar and a folder, plus preferences. No real browser data.
  const user = path.join(root, ".qa-profiles/import-fixture/Google/Chrome/User Data");
  await fs.mkdir(path.join(user, "Default"), { recursive: true });
  // Two profiles: one signed in with a colour and email (no picture file in the fixture), one with a colour only.
  await fs.writeFile(path.join(user, "Local State"), JSON.stringify({ profile: { info_cache: { Default: { name: "Work", gaia_name: "Fixture Person", user_name: "fixture.person@example.com", profile_highlight_color: -13739862 }, "Profile 1": { name: "Personal", user_name: "personal@example.com", profile_highlight_color: -8773067 } } } }));
  const url = (name, href, id) => ({ type: "url", name, url: href, id: String(id), date_added: "13300000000000000" });
  const bar = [["Acira", "https://acira.example/"], ["MDN Web Docs", "https://developer.mozilla.org/"], ["Wikipedia", "https://www.wikipedia.org/"], ["The Met", "https://www.metmuseum.org/"], ["Hacker News", "https://news.ycombinator.com/"], ["GitHub", "https://github.com/"]].map(([n, u], i) => url(n, u, 10 + i));
  bar.push({ type: "folder", name: "Reading", id: "5", date_added: "13300000000000000", children: Array.from({ length: 40 }, (_, i) => url(`Article ${i + 1}`, `https://example.com/read/${i + 1}`, 101 + i)) });
  await fs.writeFile(path.join(user, "Default/Bookmarks"), JSON.stringify({ checksum: "", version: 1, roots: { bookmark_bar: { type: "folder", name: "Bookmarks bar", id: "1", children: bar }, other: { type: "folder", name: "Other bookmarks", id: "2", children: [url("Recipes", "https://example.com/recipes", 200)] }, synced: { type: "folder", name: "Mobile bookmarks", id: "3", children: [] } } }));
  await fs.writeFile(path.join(user, "Default/Preferences"), JSON.stringify({ homepage: "https://acira.example/", browser: {} }));
  await fs.mkdir(path.join(user, "Profile 1"), { recursive: true });
  for (const file of ["Bookmarks", "Preferences"]) await fs.copyFile(path.join(user, "Default", file), path.join(user, "Profile 1", file));
}
if (!keep) await fs.cp(seed, data, { recursive: true, filter: (source) => !/lockfile$|Singleton/.test(source) });
await fs.mkdir(out, { recursive: true });
const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data };
// --import points browser detection at a synthetic Chrome profile, never the user's real browsers.
// --fixture: the synthetic Chrome profiles instead of this machine's real ones (captures to share).
if (arg("import", false) || arg("fixture", false) || arg("undo", false)) env.LOCALAPPDATA = path.join(root, ".qa-profiles/import-fixture");
delete env.ELECTRON_RUN_AS_NODE;
delete env.ACIRA_DEV;
const app = await _electron.launch({
  executablePath: path.join(root, "node_modules/electron/dist/electron.exe"),
  // --scale=1.5 is Windows 150% display scaling (DIP sizes stay as given by --size).
  args: [...(arg("scale", "") ? ["--force-device-scale-factor=" + arg("scale", "1")] : []), path.join(root, "desktop/main.cjs")],
  env,
  timeout: 30000,
});
const shot = async (page, name) => {
  const file = path.join(out, name + ".png");
  await page.screenshot({ path: file });
  return file;
};
try {
  // The chrome UI is the dist/index.html webContents; page views and backdrops are separate pages.
  let page;
  for (let i = 0; i < 100 && !page; i++) {
    page = app.windows().find((item) => item.url() === "acira-browser-ui://ui/index.html");
    if (!page) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!page) throw new Error("UI window not found: " + app.windows().map((item) => item.url()).join(", "));
  await page.waitForLoadState("domcontentloaded");
  await app.evaluate(({ BaseWindow }, size) => {
    const win = BaseWindow.getAllWindows()[0];
    win?.setContentSize(size[0], size[1]);
    win?.center();
  }, [width, height]);
  // --zoom=1.5 stands in for 150% Windows scaling on the chrome UI (pair with --size=1350x900 for the 900×600 minimum).
  const zoom = Number(arg("zoom", 1));
  if (zoom !== 1)
    await app.evaluate(({ webContents }, factor) => {
      for (const contents of webContents.getAllWebContents()) if (contents.getURL() === "acira-browser-ui://ui/index.html") contents.setZoomFactor(factor);
    }, zoom);
  if (arg("dark", false)) await page.emulateMedia({ colorScheme: "dark" });
  if (arg("light", false)) await page.emulateMedia({ colorScheme: "light" });
  if (arg("forced", false)) await page.emulateMedia({ forcedColors: "active" });
  if (arg("reduced", false)) await page.emulateMedia({ reducedMotion: "reduce" });
  if (arg("expect", "") === "none") {
    // A finished or skipped setup must never come back on a later launch.
    await page.waitForSelector(".browser-root", { timeout: 20000 });
    await page.waitForTimeout(4000);
    const shown = await page.locator(".setup-dialog").count();
    await shot(page, "relaunch");
    console.log(shown ? "FAIL: setup shown again" : "OK: setup not shown");
    process.exitCode = shown ? 1 : 0;
    await app.close();
    process.exit();
  }
  await page.waitForSelector(".setup-dialog", { timeout: 20000 });
  if (arg("click-probe", false)) {
    // Bible 11: Get started must be clickable within 300ms of the welcome appearing.
    const start = Date.now();
    let at = null;
    while (Date.now() - start < 3000 && at === null) {
      const ok = await page.evaluate(() => {
        const button = document.querySelector(".fr-welcome [data-onboarding-next]");
        if (!button || button.disabled) return false;
        for (let n = button; n; n = n.parentElement) if (getComputedStyle(n).pointerEvents === "none") return false;
        return true;
      });
      if (ok) at = Date.now() - start;
      else await page.waitForTimeout(20);
    }
    console.log("get started clickable after", at, "ms");
  }
  if (arg("hero-probe", false)) {
    // When does "Get started" rest fully sharp: opacity 1 and no filter on it or any ancestor in the stage?
    const start = Date.now();
    let sharpAt = null;
    while (Date.now() - start < 4000 && sharpAt === null) {
      const sharp = await page.evaluate(() => {
        const button = document.querySelector(".fr-welcome [data-onboarding-next]");
        if (!button || button.disabled) return false;
        for (let n = button; n && !n.classList.contains("fr-stage"); n = n.parentElement) {
          const style = getComputedStyle(n);
          if (style.filter !== "none" || Number(style.opacity) < 0.999) return false;
        }
        return true;
      });
      if (sharp) sharpAt = Date.now() - start;
      else await page.waitForTimeout(40);
    }
    console.log("hero sharp after", sharpAt, "ms (from setup visible)");
  }
  for (let i = 0; i < frames; i++) {
    await shot(page, "welcome-" + String(i).padStart(2, "0"));
    await page.waitForTimeout(interval);
  }
  await page.waitForTimeout(1500);
  await shot(page, "welcome-rest");
  if (arg("probe", false))
    console.log(
      JSON.stringify(
        await page.evaluate(() => {
          const rect = (selector) => {
            const node = document.querySelector(selector);
            if (!node) return null;
            const r = node.getBoundingClientRect(), style = getComputedStyle(node);
            return { x: r.x, y: r.y, w: r.width, h: r.height, transform: style.transform, zoom: style.zoom, position: style.position };
          };
          return {
            inner: [innerWidth, innerHeight, devicePixelRatio],
            html: rect("html"), body: rect("body"), root: rect("#root"), app: rect(".app"),
            dialog: rect(".setup-dialog"), stage: rect(".fr-stage"), art: rect(".fr-art"),
          };
        }),
      ),
    );
  if (arg("fields", false))
    console.log(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll(".fr-stage canvas")].map((c) => [c.className, c.width, c.height, c.dataset.tone, getComputedStyle(c).opacity]))),
      await page.evaluate(() => [document.querySelector(".fr-stage")?.dataset.tone, document.querySelector(".app")?.dataset.theme, matchMedia("(prefers-color-scheme: dark)").matches, matchMedia("(prefers-reduced-motion: reduce)").matches]));
  if (arg("behind", false)) {
    await page.addStyleTag({ content: ".setup-dialog{opacity:0!important}" });
    await page.waitForTimeout(300);
    await shot(page, "behind");
    console.log(JSON.stringify(await page.evaluate(() => {
      const chain = [];
      for (let n = document.querySelector(".browser-root"); n && n !== document.documentElement; n = n.parentElement) {
        const s = getComputedStyle(n);
        chain.push([n.tagName + "." + String(n.className).slice(0, 40), Math.round(n.getBoundingClientRect().width), s.display, s.gridTemplateColumns?.slice(0, 60), s.width]);
      }
      return chain;
    })));
  }
  if (arg("skip", false)) {
    await page.locator(".fr-skip").click();
    for (const t of [120, 300, 500, 800]) {
      await page.waitForTimeout(t === 120 ? 120 : t - 120);
      await shot(page, "skip-" + t);
    }
    await page.waitForTimeout(600);
    console.log((await page.locator(".setup-dialog").count()) ? "FAIL: still open after skip" : "OK: closed after skip");
  }
  if (arg("import", false)) {
    const next = () => page.locator(".setup-dialog [data-onboarding-next]").first().click();
    await next();
    await page.waitForTimeout(1200);
    await shot(page, "import-0-sources");
    await page.locator(".fr-pick", { hasText: "fixture.person" }).click();
    await page.waitForTimeout(800);
    await shot(page, "import-1-picked");
    await page.locator("[data-onboarding-import]").click();
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(60);
      await shot(page, "import-2-run-" + i);
      console.log("run", i, JSON.stringify(await page.evaluate(() => [...document.querySelectorAll(".fr-pick")].map((n) => n.textContent))));
    }
    // Once the import lands the card moves on by itself (500ms); allow for a slow import on a busy machine.
    await page
      .waitForFunction(() => document.querySelector(".fr-card-title")?.getAttribute("aria-label") !== "Bring your work with you.", null, { timeout: 8000 })
      .catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, "import-3-next");
    console.log("after import:", await page.locator(".fr-card-title").getAttribute("aria-label"));
    // The imported Chrome profile's identity fills this profile's empty photo and email (D's profile details).
    await page.waitForTimeout(600);
    console.log(
      "profile identity:",
      JSON.stringify(
        await page.evaluate(async () => {
          const s = await window.acira.getSnapshot();
          const p = s.browserProfiles.find((x) => x.id === s.activeBrowserProfileId);
          return { email: p?.email || null, picture: p?.picture ? p.picture.slice(0, 15) : null };
        }),
      ),
    );
  }
  if (arg("undo", false)) {
    // Import during setup, finish, close Make it yours: "Imported … · Undo" appears over the browser and reverts it.
    const next = () => page.locator(".setup-dialog [data-onboarding-next]").first().click();
    await next();
    await page.waitForTimeout(1200);
    await page.locator(".fr-pick", { hasText: "fixture.person" }).click();
    await page.waitForTimeout(600);
    await page.locator("[data-onboarding-import]").click();
    await page.waitForFunction(() => document.querySelector(".fr-card-title")?.getAttribute("aria-label") !== "Bring your work with you.", null, { timeout: 8000 });
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(700);
      if (!(await page.locator(".setup-dialog [data-onboarding-next]").count())) break;
      await next();
    }
    await page.waitForSelector(".fr-yours-panel", { timeout: 8000 });
    await page.waitForTimeout(700);
    await page.locator("[data-yours-done]").click();
    await page.waitForSelector(".toast-action", { timeout: 6000 });
    await page.waitForTimeout(300);
    await shot(page, "undo-0-toast");
    console.log("toast:", await page.locator(".toast-row").last().textContent());
    const batches = () => page.evaluate(async () => ((await window.acira.setup({ type: "imports.discover" })).batches || []).map((b) => [b.browser, b.undone || b.undoneAt ? "undone" : "kept"]));
    console.log("before undo:", JSON.stringify(await batches()));
    await page.locator(".toast-action", { hasText: "Undo" }).click();
    await page.waitForTimeout(900);
    await shot(page, "undo-1-done");
    console.log("after undo:", JSON.stringify(await batches()), "| toast:", await page.locator(".toast-row").last().textContent().catch(() => "none"));
  }
  if (arg("a11y", false)) {
    // Keyboard-only walk: every Tab stop's role, name and focus ring (width, offset, clipped by an overflow ancestor),
    // the step's accessibility tree, then the step is left with Tab + Enter only.
    const stop = () =>
      page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const inside = !!el.closest(".fr-stage, .fr-yours");
        const label = el.getAttribute("aria-label") || (el.labels && el.labels[0]?.innerText) || el.innerText || el.getAttribute("title") || "";
        const role = el.getAttribute("role") || el.tagName.toLowerCase() + (el.type ? ":" + el.type : "");
        const own = el.getBoundingClientRect();
        // Hidden or transparent inputs draw their ring on the visible thing around or inside their label.
        let ring = el;
        if (own.width <= 2 || own.height <= 2 || getComputedStyle(el).opacity === "0") ring = el.closest("label") || el.parentElement;
        const parts = [ring, ...ring.querySelectorAll(":scope > span, .fr-thumb")];
        let width = 0, offset = 0, kind = "none", host = ring;
        for (const node of parts) {
          const cs = getComputedStyle(node);
          const ow = cs.outlineStyle !== "none" ? parseFloat(cs.outlineWidth) || 0 : 0;
          if (ow > width) (width = ow), (offset = parseFloat(cs.outlineOffset) || 0), (kind = "outline " + cs.outlineColor), (host = node);
          const spread = [...cs.boxShadow.matchAll(/(-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px/g)].map((m) => +m[4]);
          const ringy = spread.length ? Math.max(...spread) : 0;
          if (ringy > width && !/inset/.test(cs.boxShadow)) (width = ringy), (offset = 0), (kind = "shadow"), (host = node);
          if (/inset/.test(cs.boxShadow) && ringy > width) (width = ringy), (offset = -ringy), (kind = "inset"), (host = node);
        }
        const r = host.getBoundingClientRect(), grow = Math.max(0, offset + width);
        let clipped = "";
        for (let a = host.parentElement; a && a !== document.body; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (!/(hidden|clip|auto|scroll)/.test(cs.overflow)) continue;
          const b = a.getBoundingClientRect();
          if (r.left - grow < b.left - 0.5 || r.top - grow < b.top - 0.5 || r.right + grow > b.right + 0.5 || r.bottom + grow > b.bottom + 0.5) {
            clipped = String(a.className).slice(0, 30);
            break;
          }
        }
        return { inside, role, name: String(label).replace(/\s+/g, " ").trim().slice(0, 48), width, offset, kind, clipped, key: el.outerHTML.slice(0, 120) };
      });
    const tour = async (title) => {
      const rows = [], seen = new Set();
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press("Tab");
        await page.waitForTimeout(60);
        const s = await stop();
        if (!s || !s.inside || seen.has(s.key)) break;
        seen.add(s.key);
        rows.push(`${s.width >= 2 && !s.clipped ? "ok  " : "RING"} ${s.role} "${s.name}" ring ${s.width}px@${s.offset} ${s.kind}${s.clipped ? " CLIPPED by " + s.clipped : ""}`);
      }
      console.log(`\n== ${title}\n` + rows.join("\n"));
    };
    const until = async (selector) => {
      for (let i = 0; i < 40; i++) {
        if (await page.evaluate((sel) => document.activeElement?.matches(sel), selector)) return true;
        await page.keyboard.press("Tab");
      }
      return false;
    };
    await page.waitForTimeout(1500);
    await tour("welcome");
    console.log("tree welcome:\n" + (await page.locator(".setup-dialog").ariaSnapshot()).slice(0, 600));
    await until("[data-onboarding-next]");
    await page.keyboard.press("Enter");
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(1100);
      if (!(await page.locator(".fr-card").count())) break;
      const title = await page.locator(".fr-card-title").getAttribute("aria-label");
      console.log("\nfocus after step change:", await page.evaluate(() => document.activeElement?.tagName + " " + (document.activeElement?.getAttribute("aria-label") || "")));
      await tour(title);
      console.log("tree:\n" + (await page.locator(".fr-card").ariaSnapshot()).slice(0, 900));
      await shot(page, "a11y-" + i);
      // Arrow keys inside this step's radio group, when there is one.
      const radio = page.locator(".fr-card input[type=radio]:checked").first();
      if (await radio.count()) {
        const before = await radio.evaluate((n) => n.closest("label")?.innerText.trim().split("\n")[0]);
        await radio.focus();
        await page.keyboard.press("ArrowDown");
        await page.waitForTimeout(200);
        const after = await page.evaluate(() => document.querySelector(".fr-card input[type=radio]:checked")?.closest("label")?.innerText.trim().split("\n")[0]);
        console.log(`arrows: ${before} -> ${after}`);
        await page.keyboard.press("ArrowUp");
        await page.waitForTimeout(200);
      }
      // Leave by keyboard: Tab to the step's forward button and press Enter.
      if (!(await until("[data-onboarding-next]"))) {
        console.log("NO forward button reachable by Tab");
        break;
      }
      await page.keyboard.press("Enter");
    }
    await page.waitForSelector(".fr-yours-panel", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(900);
    if (await page.locator(".fr-yours-panel").count()) {
      console.log("\nfocus in Make it yours:", await page.evaluate(() => document.activeElement?.tagName + " " + document.activeElement?.textContent?.slice(0, 30)));
      await page.evaluate(() => {
        window.__tabLog = [];
        window.addEventListener("keydown", (event) => event.key === "Tab" && setTimeout(() => window.__tabLog.push([event.defaultPrevented, document.activeElement?.tagName + "." + String(document.activeElement?.className).slice(0, 30)]), 0), true);
      });
      await page.keyboard.press("Tab");
      await page.waitForTimeout(150);
      console.log("tab probe:", JSON.stringify(await page.evaluate(() => window.__tabLog)), "hasFocus", await page.evaluate(() => document.hasFocus()));
      console.log(
        "panel tabbables:",
        JSON.stringify(
          await page.evaluate(() => {
            const panel = document.querySelector(".fr-yours-panel");
            return {
              inert: panel?.closest("[inert]")?.className?.toString().slice(0, 40) || null,
              hidden: panel?.closest("[aria-hidden=true]")?.className?.toString().slice(0, 40) || null,
              buttons: [...(panel?.querySelectorAll("button") || [])].slice(0, 4).map((b) => [b.textContent?.slice(0, 14) || b.getAttribute("aria-label"), b.tabIndex, b.disabled]),
            };
          }),
        ),
      );
      await tour("Make it yours");
      console.log("tree:\n" + (await page.locator(".fr-yours-panel").ariaSnapshot()).slice(0, 900));
      await page.locator(".fr-seg button[aria-checked=true]").first().focus();
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(300);
      console.log("segmented arrows ->", await page.evaluate(() => document.querySelector(".fr-seg button[aria-checked=true]")?.textContent + " / focus " + document.activeElement?.textContent));
      await shot(page, "a11y-yours");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      console.log("Esc closes Make it yours:", (await page.locator(".fr-yours-panel").count()) === 0);
    }
  }
  if (arg("subs", false)) {
    // How each step's subtitle actually wraps: its rendered lines, split where the line boxes change.
    const lines = () =>
      page.evaluate(() => {
        const sub = document.querySelector(".fr-sub"), text = sub?.firstChild;
        if (!text || text.nodeType !== 3) return null;
        const range = document.createRange(), out = [];
        let top = null;
        for (let i = 0; i < text.length; i++) {
          range.setStart(text, i);
          range.setEnd(text, i + 1);
          const rect = range.getClientRects()[0];
          if (!rect) continue;
          if (top === null || Math.abs(rect.top - top) > 4) out.push(""), (top = rect.top);
          out[out.length - 1] += text.data[i] === " " ? "·" : text.data[i];
        }
        return out.map((line) => line.trim());
      });
    for (let i = 0; i < 8; i++) {
      if (!(await page.locator(".setup-dialog [data-onboarding-next]").count())) break;
      await page.locator(".setup-dialog [data-onboarding-next]").first().click();
      await page.waitForTimeout(900);
      const result = await lines();
      if (result) console.log("sub", JSON.stringify(result));
      await shot(page, "sub-" + i);
    }
  }
  if (arg("lag", false)) {
    // Main-process stalls across Get started → import step (B's profile found ~430ms of sync reg.exe spawns here).
    await app.evaluate(() => {
      globalThis.__lag = { max: 0, over50: 0 };
      let last = performance.now();
      globalThis.__lagTimer = setInterval(() => {
        const now = performance.now(), late = now - last - 10;
        last = now;
        if (late > globalThis.__lag.max) globalThis.__lag.max = late;
        if (late > 50) globalThis.__lag.over50++;
      }, 10);
    });
    await page.locator(".setup-dialog [data-onboarding-next]").first().click();
    await page.waitForTimeout(2500);
    const lag = await app.evaluate(() => (clearInterval(globalThis.__lagTimer), globalThis.__lag));
    const icons = await page.evaluate(() => [...document.querySelectorAll(".fr-badge img")].map((img) => img.getAttribute("src")?.slice(0, 22)));
    console.log("main lag", JSON.stringify({ maxMs: Math.round(lag.max), stallsOver50ms: lag.over50, icons }));
  }
  if (arg("fps", false)) {
    // Frame rate with the card on screen, once the scene frosts it (canvas data-glass, card without backdrop-filter).
    await page.locator(".setup-dialog [data-onboarding-next]").first().click();
    await page.waitForTimeout(2000);
    console.log(
      "fps",
      JSON.stringify(
        await page.evaluate(
          () =>
            new Promise((resolve) => {
              const card = document.querySelector(".fr-card"), canvas = document.querySelector(".fr-prism");
              const deltas = [];
              let last = 0;
              const start = performance.now();
              const tick = (time) => {
                if (last) deltas.push(time - last);
                last = time;
                if (time - start < 3000) requestAnimationFrame(tick);
                else {
                  deltas.sort((a, b) => a - b);
                  resolve({
                    fps: Math.round((deltas.length / (time - start)) * 1000),
                    p50: deltas[Math.floor(deltas.length * 0.5)].toFixed(1),
                    p95: deltas[Math.floor(deltas.length * 0.95)].toFixed(1),
                    sceneGlass: canvas?.hasAttribute("data-glass"),
                    cardTagged: card?.hasAttribute("data-prism-glass"),
                    cardBackdrop: card && getComputedStyle(card).backdropFilter,
                    cardFill: card && getComputedStyle(card).backgroundColor,
                  });
                }
              };
              requestAnimationFrame(tick);
            }),
        ),
      ),
    );
    await shot(page, "fps-card");
  }
  if (arg("appearance", false)) {
    // Picking Dark or Light restyles the whole first run at once.
    const next = () => page.locator(".setup-dialog [data-onboarding-next]").first().click();
    for (let i = 0; i < 3; i++) {
      await next();
      await page.waitForTimeout(1100);
    }
    for (const mode of ["Auto", "Dark", "Light"].slice(1)) {
      await page.locator(".fr-look", { hasText: mode }).click();
      await page.waitForTimeout(700);
      await shot(page, "appearance-" + mode.toLowerCase());
      console.log(mode, "->", await page.locator(".fr-stage").getAttribute("data-tone"));
    }
  }
  if (arg("bench", false)) {
    // GPU cost of the light shader at 2560x1440: the same fragment source, timed over 60 draws with gl.finish().
    const source = (await fs.readFile(path.join(root, "src/features/onboarding/PrismField.tsx"), "utf8")).match(/const fragment = `([\s\S]*?)`;/)[1];
    const result = await page.evaluate((frag) => {
      const c = document.createElement("canvas");
      c.width = 2560;
      c.height = 1440;
      const gl = c.getContext("webgl", { antialias: false, alpha: false });
      const sh = (k, src) => { const x = gl.createShader(k); gl.shaderSource(x, src); gl.compileShader(x); return x; };
      const pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}"));
      gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, frag));
      gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return "link failed";
      gl.useProgram(pr);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const u = (n) => gl.getUniformLocation(pr, n);
      gl.viewport(0, 0, 2560, 1440);
      gl.uniform2f(u("res"), 2560, 1440); gl.uniform1f(u("tone"), 0); gl.uniform1f(u("power"), 1); gl.uniform1f(u("clear"), 1);
      gl.uniform1f(u("swing"), 0); gl.uniform3f(u("bg"), 0.02, 0.02, 0.025); gl.uniform1f(u("unit"), 1);
      // A 1-pixel readPixels waits for the GPU; subtract the cost of a readPixels with no draw before it.
      const px = new Uint8Array(4);
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      sync();
      const idle = [];
      for (let i = 0; i < 30; i++) { const s0 = performance.now(); sync(); idle.push(performance.now() - s0); }
      idle.sort((a, b) => a - b);
      const times = [];
      for (let i = 0; i < 70; i++) {
        gl.uniform1f(u("t"), i * 0.033);
        const s0 = performance.now();
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        sync();
        if (i >= 10) times.push(performance.now() - s0 - idle[15]);
      }
      times.sort((a, b) => a - b);
      return { median: times[30].toFixed(2), p90: times[54].toFixed(2), renderer: gl.getParameter(gl.RENDERER) };
    }, source);
    console.log("bench 2560x1440", JSON.stringify(result));
  }
  if (arg("field-only", false)) {
    // The dialog stage's light with the dialog hidden: where do the beams fall?
    await page.locator(".setup-dialog [data-onboarding-next]").first().click();
    await page.waitForTimeout(2500);
    console.log(JSON.stringify(await page.evaluate(() => {
      const out = [];
      for (let n = document.querySelector(".fr-card"); n && !n.classList.contains("fr-stage"); n = n.parentElement) {
        const c = getComputedStyle(n);
        out.push([String(n.className).slice(0, 30), c.backgroundColor, c.opacity, c.filter, c.backdropFilter]);
      }
      return out;
    })));
    await shot(page, "field-with");
    await page.addStyleTag({ content: ".fr-card{visibility:hidden!important}" });
    await page.waitForTimeout(200);
    await shot(page, "field-only");
  }
  if (arg("burst", false)) {
    // ≤8 frames of one title swap (import → profile), clipped to the title, to read the sweep direction.
    const next = () => page.locator(".setup-dialog [data-onboarding-next]").first().click();
    await next();
    await page.waitForTimeout(1300);
    const box = await page.locator(".fr-card-title").boundingBox();
    const clip = { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: Math.min(760, box.width + 120), height: box.height + 16 };
    await next();
    const start = Date.now();
    for (let i = 0; i < 8; i++) {
      await page.screenshot({ path: path.join(out, `burst-${i}.png`), clip });
      console.log("burst", i, Date.now() - start, "ms");
    }
  }
  if (arg("focus", false)) {
    // Keyboard focus and hover states on the appearance step.
    const next = () => page.locator(".setup-dialog [data-onboarding-next]").first().click();
    for (let i = 0; i < 3; i++) {
      await next();
      await page.waitForTimeout(1000);
    }
    await page.locator(".fr-look").first().locator("input").focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(300);
    await shot(page, "focus-look");
  }
  if (arg("noscroll", false)) {
    // Bible 11: no step scrolls. On the fixed card, every step's content must end at least 16px above the footer
    // (the concept asks for 24 at full size) and the card itself must sit inside the window.
    const report = [];
    const measure = () =>
      page.evaluate(() => {
        const card = document.querySelector(".fr-card"), content = document.querySelector(".fr-content"), foot = document.querySelector(".fr-foot");
        if (!card || !content || !foot) return null;
        const zoom = Number(getComputedStyle(card).zoom) || 1, c = card.getBoundingClientRect();
        return {
          title: document.querySelector(".fr-card-title")?.getAttribute("aria-label"),
          air: Math.round(foot.getBoundingClientRect().top - content.getBoundingClientRect().bottom),
          fits: c.top >= 0 && c.bottom <= innerHeight && c.left >= 0 && c.right <= innerWidth,
          zoom,
        };
      });
    const line = (tag, m) => m && report.push(`${m.air >= 16 && m.fits ? "ok  " : "OVER"} ${m.title}${tag} air ${m.air}px zoom ${m.zoom}${m.fits ? "" : " (card outside window)"}`);
    for (let i = 0; i < 9 && (await page.locator(".setup-dialog [data-onboarding-next]").count()); i++) {
      await page.locator(".setup-dialog [data-onboarding-next]").first().click();
      await page.waitForTimeout(900);
      line("", await measure());
      // Import pages through long profile lists; every page must fit too.
      if (await page.locator(".fr-glabel-more").count()) {
        await page.locator(".fr-glabel-more").click();
        await page.waitForTimeout(400);
        line(" (next page)", await measure());
        await shot(page, "noscroll-page");
      }
    }
    console.log(["noscroll " + width + "x" + height, ...report].join(String.fromCharCode(10)));
  }
  if (arg("yours", false)) {
    // Finish setup, then the one-time "Make it yours" panel over the live browser: hover, pick, layout, Done.
    for (let i = 0; i < 9 && (await page.locator(".setup-dialog [data-onboarding-next]").count()); i++) {
      await page.locator(".setup-dialog [data-onboarding-next]").first().click();
      await page.waitForTimeout(900);
    }
    await page.waitForSelector(".fr-yours-panel", { timeout: 8000 });
    await page.waitForTimeout(700);
    await shot(page, "yours-0");
    // Founder, 24 Oct: hover and focus never change the colour; only click, Enter or Space do. Arrows only move focus.
    const look = () =>
      page.evaluate(async () => {
        const s = (await window.acira.getSnapshot()).settings, app = document.querySelector(".app");
        return { preset: s.colorPreset, tint: s.browserTint, label: document.querySelector(".fr-yours-row em")?.textContent, app: [...app.attributes].map((a) => a.name + "=" + a.value).join(" ").length + ":" + (app.dataset.previewTheme || "") + ":" + getComputedStyle(app).getPropertyValue("--accent") };
      });
    const start = await look();
    await page.locator(".fr-yours .finish-swatch").nth(1).hover();
    await page.waitForTimeout(600);
    await shot(page, "yours-1-hover");
    const hovered = await look();
    console.log("hover changes nothing:", JSON.stringify(hovered) === JSON.stringify(start), JSON.stringify(hovered));
    await page.locator(".fr-yours .finish-swatch").nth(0).focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(400);
    const arrowed = await look();
    console.log("arrows move focus only:", JSON.stringify(arrowed) === JSON.stringify(start), "| focused:", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    const entered = await look();
    console.log("Enter chooses:", entered.preset !== start.preset, JSON.stringify(entered));
    await page.locator(".fr-yours .finish-swatch").nth(3).click();
    await page.locator(".fr-yours .fr-seg button", { hasText: "In a sidebar" }).click();
    await page.waitForTimeout(900);
    const clicked = await look();
    console.log("click chooses:", clicked.preset !== entered.preset, "| label shows chosen:", clicked.label === clicked.preset, JSON.stringify(clicked));
    await page.locator(".fr-yours .finish-swatch").nth(5).hover();
    await page.waitForTimeout(400);
    console.log("label after hover stays chosen:", (await look()).label === clicked.preset);
    await shot(page, "yours-2-picked");
    await page.locator("[data-yours-done]").click();
    await page.waitForTimeout(800);
    await shot(page, "yours-3-done");
    console.log("yours", JSON.stringify(await page.evaluate(() => [document.querySelectorAll(".fr-yours-panel").length, window.__acira?.getState?.().settings?.colorPreset ?? null])));
  }
  if (arg("keys", false)) {
    // Enter begins once the mark has formed; Escape skips setup from a dialog step.
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    const after = await page.locator(".fr-stage").getAttribute("data-stage");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1200);
    console.log("enter ->", after, "| escape -> dialog open:", await page.locator(".setup-dialog").count());
  }
  if (arg("rerun", false)) {
    // Skip, then Settings → About → Run setup again must reopen the first run at its welcome.
    await page.locator(".fr-skip").click();
    await page.waitForTimeout(1200);
    await page.keyboard.press("Control+L");
    await page.keyboard.type("acira://settings");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /^About$/ }).first().click().catch(() => page.getByText("About", { exact: true }).first().click());
    await page.waitForTimeout(500);
    await page.locator('[data-setting="browser-setup"] button').click();
    await page.waitForTimeout(2500);
    await shot(page, "rerun");
    console.log("rerun stage:", await page.locator(".fr-stage").getAttribute("data-stage").catch(() => "none"));
  }
  if (arg("profiles", false)) {
    // Settings → Profiles: list, create with a colour, edit, remove confirmation.
    if (await page.locator(".fr-skip").count()) await page.locator(".fr-skip").click();
    await page.waitForTimeout(1200);
    // The omnibox refuses acira:// addresses; internal pages open through the browser itself.
    await page.evaluate(() => window.acira.dispatch({ type: "tab.new", url: "acira://settings" }));
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /^Profiles$/ }).first().click().catch(() => page.getByText("Profiles", { exact: true }).first().click());
    await page.waitForTimeout(600);
    await shot(page, "profiles-0");
    await page.getByRole("button", { name: "New profile", exact: true }).click();
    await page.locator(".pm-create input.st-input").fill("Work");
    await page.locator(".pm-create .pm-swatch").nth(5).click();
    await shot(page, "profiles-1-create");
    await page.locator(".pm-create button[type=submit]").click();
    await page.waitForTimeout(900);
    await shot(page, "profiles-2-created");
    await page.locator(".pm-item").last().locator("button", { hasText: "Edit" }).click();
    await page.waitForTimeout(300);
    await shot(page, "profiles-3-edit");
    await page.locator(".pm-item").last().locator(".pm-remove").click();
    await page.waitForTimeout(300);
    await shot(page, "profiles-4-confirm");
    await page.locator(".pm-item").last().locator(".acira-button-danger.acira-button-primary").click();
    await page.waitForTimeout(1500);
    await shot(page, "profiles-5-removed");
    // Rename + recolour + monogram on the remaining profile.
    await page.locator(".pm-item").first().locator("button", { hasText: "Edit" }).click();
    await page.waitForTimeout(300);
    await page.locator(".pm-editor input.st-input").first().fill("Alex");
    await page.locator(".pm-editor .pm-initial input").fill("F");
    await page.locator(".pm-editor .pm-swatch").nth(0).click();
    await page.locator(".pm-editor button[type=submit]").click();
    await page.waitForTimeout(900);
    await shot(page, "profiles-6-renamed");
    console.log(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll(".pm-item .st-title")].map((n) => n.textContent))));
  }
  if (arg("walk", false)) {
    for (let i = 0; i < 8; i++) {
      const next = page.locator(".setup-dialog [data-onboarding-next]");
      if (!(await next.count())) break;
      if (arg("finish-index", "") !== "" && (await page.locator(".fr-finish-swatch").count())) {
        await page.locator(".fr-finish-swatch").nth(Number(arg("finish-index", 0))).click();
        await page.waitForTimeout(400);
      }
      await next.first().click();
      await page.waitForTimeout(160);
      await shot(page, "step-" + i + "-mid");
      await page.waitForTimeout(900);
      await shot(page, "step-" + i);
      if (arg("probe", false))
        console.log(i, JSON.stringify(await page.evaluate(() => {
          const panel = document.querySelector(".fr-panel"), r = panel?.getBoundingClientRect(), s = panel && getComputedStyle(panel);
          return [innerWidth, innerHeight, document.querySelector(".fr-stage")?.getAttribute("data-stage"), r && [Math.round(r.y), Math.round(r.height)], s?.maxHeight, panel?.scrollHeight];
        })),
          JSON.stringify(await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().map((w) => [w.getContentBounds(), w.isMaximized()]))));
    }
  }
  console.log(out);
} finally {
  if (!arg("open", false)) await app.close();
}
