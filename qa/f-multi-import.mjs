// Multi-account import, end to end in the real app, on fixture profiles only (LOCALAPPDATA and APPDATA point at
// .qa-profiles/multi-import-fixture: five Chrome profiles and a Firefox one, so the list scrolls). One app instance:
// setup's Import step (scroll, keyboard, choose three), the profiles it makes, the toast, then the short setup in a new
// profile's window. Closed in `finally`.
// node qa/f-multi-import.mjs [--theme=dark|light] [--size=1440x900]
import { _electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd(),
  arg = (name, fallback) => {
    const hit = process.argv.find((item) => item.startsWith("--" + name + "="));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
const theme = arg("theme", "dark"),
  [width, height] = String(arg("size", "1440x900")).split("x").map(Number),
  fixture = path.join(root, ".qa-profiles/multi-import-fixture"),
  data = path.join(root, `.qa-profiles/f-multi-${theme}-${Date.now()}`),
  out = path.join(root, `qa/artifacts/f-multi-import-${theme}-${Date.now()}`),
  seed = path.join(root, ".qa-profiles/first-run-seed");

function png(rgb, size = 32) {
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from(rgb))]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const chunk = (type, body) => {
    const length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), body])) >>> 0);
    return Buffer.concat([length, Buffer.from(type), body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function buildFixture() {
  await fs.rm(fixture, { recursive: true, force: true });
  const chrome = path.join(fixture, "Local/Google/Chrome/User Data");
  const people = [
    ["Default", "Personal", "sam.rivera@example.com", -13739862, null],
    ["Profile 1", "Work", "sam@studio.example", -14983648, [52, 120, 246]],
    ["Profile 2", "School", "s.rivera@uni.example", -8773067, null],
    ["Profile 3", "Side project", "", -2201331, null],
    ["Profile 4", "Travel", "", -16121, null],
  ];
  const cache = {};
  for (const [folder, name, email, color, photo] of people) {
    const location = path.join(chrome, folder);
    await fs.mkdir(location, { recursive: true });
    cache[folder] = { name, user_name: email, gaia_name: email ? "Sam Rivera" : "", profile_highlight_color: color, ...(photo ? { gaia_picture_file_name: "Google Profile Picture.png" } : {}) };
    if (photo) await fs.writeFile(path.join(location, "Google Profile Picture.png"), png(photo, 64));
    const pages = [1, 2, 3].map((n) => [`https://${name.toLowerCase().replace(/\s+/g, "-")}.example.org/page-${n}`, `${name} page ${n}`]);
    await fs.writeFile(path.join(location, "Bookmarks"), JSON.stringify({ roots: { bookmark_bar: { name: "Bookmarks bar", children: pages.map(([url, title], i) => ({ type: "url", name: title, url, guid: `${folder}-${i}` })) } } }));
    const history = new DatabaseSync(path.join(location, "History"));
    history.exec("CREATE TABLE urls(url TEXT,title TEXT,last_visit_time INTEGER)");
    for (const [url, title] of pages) history.prepare("INSERT INTO urls VALUES(?,?,?)").run(url, title, (BigInt(Date.now()) + 11644473600000n) * 1000n);
    history.close();
  }
  await fs.writeFile(path.join(chrome, "Local State"), JSON.stringify({ profile: { info_cache: cache } }));
  const ffHome = path.join(fixture, "Roaming/Mozilla/Firefox"), ff = path.join(ffHome, "Profiles/qa12.default-release");
  await fs.mkdir(ff, { recursive: true });
  await fs.writeFile(path.join(ffHome, "profiles.ini"), "[Profile0]\r\nName=default-release\r\nIsRelative=1\r\nPath=Profiles/qa12.default-release\r\nDefault=1\r\n");
  const places = new DatabaseSync(path.join(ff, "places.sqlite"));
  places.exec("CREATE TABLE moz_places(id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_date INTEGER, hidden INTEGER DEFAULT 0); CREATE TABLE moz_bookmarks(id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT, guid TEXT, dateAdded INTEGER)");
  places.prepare("INSERT INTO moz_places VALUES(1,'https://developer.mozilla.org/','MDN',?,0)").run(BigInt(Date.now()) * 1000n);
  const mark = places.prepare("INSERT INTO moz_bookmarks VALUES(?,?,?,?,?,?,?,0)");
  mark.run(1, 2, null, 0, 0, "", "root________");
  mark.run(2, 2, null, 1, 0, "toolbar", "toolbar_____");
  mark.run(10, 1, 1, 2, 0, "MDN", "qaFox0000001");
  places.close();
}

await buildFixture();
await fs.cp(seed, data, { recursive: true, filter: (source) => !/lockfile$|Singleton/.test(source) });
await fs.mkdir(out, { recursive: true });
const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.join(fixture, "Local"), APPDATA: path.join(fixture, "Roaming") };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ACIRA_DEV;
const app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: [path.join(root, "desktop/main.cjs")], env, timeout: 30000 });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let page;
const errors = [];
app.on("window", (w) => w.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200))));
const shot = async (name, which = 0) => {
  const b64 = await app.evaluate(async ({ BaseWindow, desktopCapturer, screen }, which) => {
    const wins = BaseWindow.getAllWindows().filter((w) => w.isVisible());
    // 1: the window that has focus (a profile's own window opens in front).
    const win = (which === 1 && (BaseWindow.getFocusedWindow?.() || wins[wins.length - 1])) || wins[0];
    if (!win) return "";
    const bounds = win.getBounds(), scale = screen.getDisplayMatching(bounds).scaleFactor;
    const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: Math.round(bounds.width * scale), height: Math.round(bounds.height * scale) } });
    const source = sources.find((item) => item.id === win.getMediaSourceId());
    return source && !source.thumbnail.isEmpty() ? source.thumbnail.toPNG().toString("base64") : "";
  }, which);
  await fs.writeFile(path.join(out, name + ".png"), b64 ? Buffer.from(b64, "base64") : await page.screenshot());
  console.log("shot", name);
};
const listState = () =>
  page.evaluate(() => {
    const list = document.querySelector(".fr-import-list");
    return {
      rows: [...document.querySelectorAll(".fr-import-list .fr-row")].map((row) => [row.querySelector("b")?.textContent, row.querySelector("input")?.checked, row.querySelector(".fr-tag")?.textContent || ""]),
      scroll: list ? [list.scrollTop, list.clientHeight, list.scrollHeight] : null,
      fade: list ? [list.hasAttribute("data-fade-top"), list.hasAttribute("data-fade-bottom")] : null,
      primary: document.querySelector("[data-onboarding-import]")?.textContent,
      air: Math.round(document.querySelector(".fr-foot").getBoundingClientRect().top - document.querySelector(".fr-content").getBoundingClientRect().bottom),
    };
  });
try {
  for (let i = 0; i < 100 && !page; i++) {
    page = app.windows().find((item) => item.url() === "acira-browser-ui://ui/index.html");
    if (!page) await wait(200);
  }
  await page.waitForLoadState("domcontentloaded");
  await app.evaluate(({ BaseWindow }, size) => {
    const win = BaseWindow.getAllWindows()[0];
    win?.setContentSize(size[0], size[1]);
    win?.center();
  }, [width, height]);
  await page.emulateMedia({ colorScheme: theme });
  await page.waitForSelector(".fr-welcome [data-onboarding-next]", { timeout: 20000 });
  await wait(2500);
  await page.locator(".fr-welcome [data-onboarding-next]").click();
  await page.waitForSelector(".fr-import-list .fr-pick", { timeout: 15000 });
  await wait(1500);
  console.log("start:", JSON.stringify(await listState()));
  await shot("01-list-top");
  await page.locator(".fr-import-list").hover();
  await page.mouse.wheel(0, 400);
  await wait(700);
  console.log("scrolled:", JSON.stringify((await listState()).fade));
  await shot("02-list-bottom");
  await page.mouse.wheel(0, -400);
  await wait(500);
  // Keyboard: from the first box, two rows down, Space chooses it; End then Space chooses the last.
  await page.locator(".fr-import-list input").first().focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await page.keyboard.press("End");
  await page.keyboard.press("Space");
  await wait(600);
  const chosen = await listState();
  console.log("chosen:", JSON.stringify(chosen.rows.filter((row) => row[1])), "| primary:", chosen.primary, "| fade:", JSON.stringify(chosen.fade), "| air:", chosen.air);
  await shot("03-three-chosen");
  const title = await page.locator(".fr-card-title").getAttribute("aria-label");
  await page.locator("[data-onboarding-import]").click();
  for (let i = 0; i < 80 && (await page.locator(".fr-card-title").getAttribute("aria-label")) === title; i++) await wait(250);
  let s = await page.evaluate(() => window.acira.getSnapshot());
  const perProfile = s.browserProfiles.map((profile) => [profile.name, profile.picture ? "photo" : "", profile.email || "", s.bookmarkNodes.filter((node) => node.browserProfileId === profile.id && node.url).length, s.browsingHistory.filter((visit) => visit.browserProfileId === profile.id).length]);
  console.log("profiles:", JSON.stringify(perProfile));
  await shot("04-after-import");
  for (let i = 0; i < 8 && (await page.locator(".setup-dialog [data-onboarding-next]").count()); i++) {
    await page.locator(".setup-dialog [data-onboarding-next]").first().click();
    await wait(900);
  }
  await page.waitForSelector(".fr-yours-panel", { timeout: 8000 }).catch(() => {});
  if (await page.locator("[data-yours-done]").count()) await page.locator("[data-yours-done]").click();
  await wait(1200);
  console.log("toast:", await page.locator(".toast-row").first().textContent().catch(() => "none"), "| state toasts:", JSON.stringify(await page.evaluate(async () => { const snap = await window.acira.getSnapshot(); return [snap.toast, snap.toasts].map((value) => JSON.stringify(value || null).slice(0, 200)); })));
  await shot("05-toast");
  // Open a profile the import made: its window starts with the short setup.
  s = await page.evaluate(() => window.acira.getSnapshot());
  const made = s.browserProfiles.find((profile) => profile.name === "School") || s.browserProfiles[1];
  const before = new Set(app.windows());
  await page.evaluate((id) => window.acira.dispatch({ type: "browser.profile.select", id }), made.id);
  let second;
  for (let i = 0; i < 60 && !second; i++) {
    second = app.windows().find((item) => !before.has(item) && item.url() === "acira-browser-ui://ui/index.html");
    if (!second) await wait(250);
  }
  if (!second) throw new Error("the profile's window did not open");
  page = second;
  await page.waitForLoadState("domcontentloaded");
  await app.evaluate(({ BaseWindow }, size) => {
    for (const win of BaseWindow.getAllWindows()) if (win.isVisible()) (win.setContentSize(size[0], size[1]), win.center());
  }, [width, height]);
  await page.emulateMedia({ colorScheme: theme });
  await page.waitForSelector(".fr-card-title", { timeout: 15000 });
  await wait(1500);
  console.log("short setup:", await page.locator(".fr-card-title").getAttribute("aria-label"), "|", await page.locator(".fr-counter").textContent());
  await shot("06-short-setup", 1);
  // School's own choices: Light and DuckDuckGo (Personal keeps the global ones).
  const personalBefore = await app.windows().find((w) => w !== page && w.url() === "acira-browser-ui://ui/index.html")?.evaluate(() => window.acira.getSnapshot().then((s) => [s.settings.appearance, s.settings.searchEngine]));
  await page.locator(".fr-content").getByText("Light", { exact: true }).first().click();
  await wait(700);
  await shot("06b-short-setup-light", 1);
  await page.locator("[data-onboarding-primary]").click();
  await wait(800);
  console.log("step:", await page.locator(".fr-card-title").getAttribute("aria-label").catch(() => "closed"));
  await page.locator(".fr-content").getByText("DuckDuckGo", { exact: true }).first().click();
  await wait(400);
  for (let i = 0; i < 2; i++) {
    await page.locator("[data-onboarding-primary]").click();
    await wait(800);
    console.log("step:", await page.locator(".fr-card-title").getAttribute("aria-label").catch(() => "closed"));
  }
  const schoolView = await page.evaluate(() => window.acira.getSnapshot().then((s) => [s.settings.appearance, s.settings.searchEngine, JSON.stringify(s.browserProfiles.find((p) => p.id === s.activeBrowserProfileId)?.settings)]));
  const personalAfter = await app.windows().find((w) => w !== page && w.url() === "acira-browser-ui://ui/index.html")?.evaluate(() => window.acira.getSnapshot().then((s) => [s.settings.appearance, s.settings.searchEngine]));
  console.log("School sees:", JSON.stringify(schoolView), "| Personal before/after:", JSON.stringify(personalBefore), JSON.stringify(personalAfter));
  console.log("native theme (School focused):", await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource));
  await page.evaluate(() => window.acira.dispatch({ type: "tab.new", url: "acira profiles" }));
  await wait(800);
  console.log("School search goes to:", await page.evaluate(() => window.acira.getSnapshot().then((s) => s.tabs.find((t) => t.id === s.activeTabId)?.url)));
  await page.evaluate(() => window.acira.dispatch({ type: "tab.new", url: "acira://settings" }));
  await wait(1500);
  await page.getByRole("button", { name: "Appearance", exact: true }).first().click().catch(() => {});
  await wait(800);
  console.log("Settings scope rows:", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-setting="appearance-scope"], [data-setting="search-scope"]')].map((row) => row.textContent.replace(/\s+/g, " ").trim().slice(0, 120)))));
  await shot("06c-settings-applies-to", 1);
  await wait(800);
  console.log("setup closed in the new window:", (await page.locator(".setup-dialog, .fr-stage").count()) === 0);
  await shot("07-new-profile-window", 1);
  console.log("console errors:", JSON.stringify(errors.slice(0, 6)));
} catch (failure) {
  console.log("FATAL", failure.message.split("\n")[0]);
  if (page) await shot("fatal").catch(() => {});
} finally {
  await app.close();
}
console.log(out);
