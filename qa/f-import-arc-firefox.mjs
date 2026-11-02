// Arc and Firefox import, end to end in the real app, on fixture profiles only (LOCALAPPDATA and APPDATA point at
// .qa-profiles/arc-firefox-fixture, so no real browser data is read). Setup's Import step with Arc → Favourites in the
// sidebar, Spaces as collapsed tab groups, the "Imported … · Undo" toast and Undo; then Settings → Import & export with
// Firefox → bookmarks with their imported site icons (in M's favicon store, shown by History, Bookmarks and new tab).
// node qa/f-import-arc-firefox.mjs [--theme=dark|light] [--size=1440x900]
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
  fixture = path.join(root, ".qa-profiles/arc-firefox-fixture"),
  data = path.join(root, `.qa-profiles/f-import-${theme}-${Date.now()}`),
  out = path.join(root, `qa/artifacts/f-import-arc-firefox-${theme}-${Date.now()}`),
  seed = path.join(root, ".qa-profiles/first-run-seed");

/** A w×h PNG filled with one colour, so imported site icons are visible and distinct. */
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
  // Arc: the MSIX package's LocalCache, as Arc lays it out on Windows.
  const arcRoot = path.join(fixture, "Local/Packages/TheBrowserCompany.Arc_ttt1ap7aakyb4/LocalCache/Local/Arc"), userData = path.join(arcRoot, "User Data");
  await fs.mkdir(path.join(userData, "Default"), { recursive: true });
  await fs.writeFile(path.join(userData, "Local State"), JSON.stringify({ profile: { info_cache: { Default: { name: "Personal", user_name: "arc.person@example.com" } } } }));
  const items = [], tab = (id, url, title) => items.push(id, { id, title: null, createdAt: 760000000, childrenIds: [], data: { tab: { savedURL: url, savedTitle: title } } });
  const container = (id, children) => items.push(id, { id, childrenIds: children, data: { itemContainer: { containerType: {} } } });
  const folder = (id, title, children) => items.push(id, { id, title, childrenIds: children, data: { list: {} } });
  container("fav", ["f1", "f2", "f3", "f4"]);
  tab("f1", "https://github.com/", "GitHub");
  tab("f2", "https://www.figma.com/files", "Figma");
  tab("f3", "https://calendar.example.com/", "Calendar");
  tab("f4", "https://music.example.com/", "Music");
  container("pw", ["w1", "w2", "wf"]);
  tab("w1", "https://linear.app/team", "Linear");
  tab("w2", "https://docs.example.com/roadmap", "Roadmap");
  folder("wf", "Design reviews", ["w3", "w4"]);
  tab("w3", "https://www.figma.com/file/review-1", "Review 1");
  tab("w4", "https://www.figma.com/file/review-2", "Review 2");
  container("ph", ["h1", "h2"]);
  tab("h1", "https://news.example.net/", "News");
  tab("h2", "https://recipes.example.org/", "Recipes");
  const spaces = [
    "work", { id: "work", title: "Work", profile: { default: true }, containerIDs: ["pinned", "pw", "unpinned", "uw"] },
    "home", { id: "home", title: "Home", profile: { default: true }, containerIDs: ["pinned", "ph", "unpinned", "uh"] },
  ];
  await fs.writeFile(path.join(arcRoot, "StorableSidebar.json"), JSON.stringify({ sidebar: { containers: [{ global: {} }, { items, spaces, topAppsContainerIDs: [{ default: true }, "fav"] }] } }));
  const history = new DatabaseSync(path.join(userData, "Default/History"));
  history.exec("CREATE TABLE urls(url TEXT,title TEXT,last_visit_time INTEGER)");
  history.prepare("INSERT INTO urls VALUES(?,?,?)").run("https://linear.app/team", "Linear", (BigInt(Date.now()) + 11644473600000n) * 1000n);
  history.close();
  const chromeIcons = new DatabaseSync(path.join(userData, "Default/Favicons"));
  chromeIcons.exec("CREATE TABLE icon_mapping(page_url TEXT, icon_id INTEGER); CREATE TABLE favicon_bitmaps(icon_id INTEGER, image_data BLOB, width INTEGER)");
  [["https://linear.app/team", [94, 106, 210]], ["https://news.example.net/", [220, 80, 60]], ["https://github.com/", [30, 30, 30]]].forEach(([url, rgb], index) => {
    chromeIcons.prepare("INSERT INTO icon_mapping VALUES(?,?)").run(url, index + 1);
    chromeIcons.prepare("INSERT INTO favicon_bitmaps VALUES(?,?,?)").run(index + 1, png(rgb), 32);
  });
  chromeIcons.close();
  // Firefox: profiles.ini in Roaming, places.sqlite and favicons.sqlite in the profile.
  const ffHome = path.join(fixture, "Roaming/Mozilla/Firefox"), ff = path.join(ffHome, "Profiles/qa12.default-release");
  await fs.mkdir(ff, { recursive: true });
  await fs.writeFile(path.join(ffHome, "profiles.ini"), "[Install308046B0AF4A39CB]\r\nDefault=Profiles/qa12.default-release\r\n\r\n[Profile0]\r\nName=default-release\r\nIsRelative=1\r\nPath=Profiles/qa12.default-release\r\n");
  await fs.writeFile(path.join(ff, "signedInUser.json"), JSON.stringify({ accountData: { email: "fox.person@example.com" } }));
  const places = new DatabaseSync(path.join(ff, "places.sqlite"));
  places.exec("CREATE TABLE moz_places(id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_date INTEGER, hidden INTEGER DEFAULT 0); CREATE TABLE moz_bookmarks(id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT, guid TEXT, dateAdded INTEGER)");
  const now = BigInt(Date.now()) * 1000n, pages = [["https://developer.mozilla.org/", "MDN"], ["https://www.wikipedia.org/", "Wikipedia"], ["https://blog.example.org/post", "A post"], ["https://maps.example.com/", "Maps"]];
  pages.forEach(([url, title], index) => places.prepare("INSERT INTO moz_places VALUES(?,?,?,?,0)").run(index + 1, url, title, now - BigInt(index) * 3600000000n));
  const mark = places.prepare("INSERT INTO moz_bookmarks VALUES(?,?,?,?,?,?,?,0)");
  mark.run(1, 2, null, 0, 0, "", "root________");
  mark.run(2, 2, null, 1, 0, "toolbar", "toolbar_____");
  mark.run(3, 2, null, 1, 1, "unfiled", "unfiled_____");
  mark.run(10, 1, 1, 2, 0, "MDN", "qaFox0000001");
  mark.run(11, 1, 2, 2, 1, "Wikipedia", "qaFox0000002");
  mark.run(12, 2, null, 2, 2, "Reading", "qaFox0000003");
  mark.run(13, 1, 3, 12, 0, "A post", "qaFox0000004");
  mark.run(14, 1, 4, 3, 0, "Maps", "qaFox0000005");
  places.close();
  const icons = new DatabaseSync(path.join(ff, "favicons.sqlite"));
  icons.exec("CREATE TABLE moz_icons(id INTEGER PRIMARY KEY, icon_url TEXT, width INTEGER, data BLOB); CREATE TABLE moz_pages_w_icons(id INTEGER PRIMARY KEY, page_url TEXT); CREATE TABLE moz_icons_to_pages(page_id INTEGER, icon_id INTEGER)");
  [[0, [0, 0, 0]], [1, [240, 240, 240]], [2, [230, 140, 30]], [3, [40, 160, 90]]].forEach(([index, rgb]) => {
    icons.prepare("INSERT INTO moz_icons VALUES(?,?,32,?)").run(index + 1, pages[index][0] + "favicon.png", png(rgb));
    icons.prepare("INSERT INTO moz_pages_w_icons VALUES(?,?)").run(index + 1, pages[index][0]);
    icons.prepare("INSERT INTO moz_icons_to_pages VALUES(?,?)").run(index + 1, index + 1);
  });
  icons.close();
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
const shot = async (name) => {
  const b64 = await app.evaluate(async ({ BaseWindow, desktopCapturer, screen }) => {
    const win = BaseWindow.getAllWindows().filter((w) => w.isVisible())[0];
    if (!win) return "";
    const bounds = win.getBounds(), scale = screen.getDisplayMatching(bounds).scaleFactor;
    const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: Math.round(bounds.width * scale), height: Math.round(bounds.height * scale) } });
    const source = sources.find((item) => item.id === win.getMediaSourceId());
    return source && !source.thumbnail.isEmpty() ? source.thumbnail.toPNG().toString("base64") : "";
  });
  await fs.writeFile(path.join(out, name + ".png"), b64 ? Buffer.from(b64, "base64") : await page.screenshot());
  console.log("shot", name);
};
const snapshot = () => page.evaluate(() => window.acira.getSnapshot());
const sidebarApps = () => page.evaluate(async () => {
  const s = await window.acira.getSnapshot();
  return JSON.parse(localStorage.getItem("acira-sidebar-apps:" + s.activeBrowserProfileId) || "{}").apps?.map((app) => app.title) || [];
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
  await page.waitForSelector(".setup-dialog .fr-import", { timeout: 15000 });
  await page.waitForSelector(".fr-import .fr-row b, .fr-import [role=radio]", { timeout: 15000 });
  await wait(1800);
  console.log("sources:", JSON.stringify(await page.locator(".fr-import .fr-row").allTextContents()));
  await shot("01-setup-import");
  const title = await page.locator(".fr-card-title").getAttribute("aria-label");
  await page.locator("[data-onboarding-import]").click();
  for (let i = 0; i < 60 && (await page.locator(".fr-card-title").getAttribute("aria-label")) === title; i++) await wait(250);
  let s = await snapshot();
  const groups = s.tabGroups.map((group) => [group.name, group.collapsed, s.tabs.filter((tab) => tab.group === group.name).map((tab) => tab.title)]);
  console.log("groups:", JSON.stringify(groups));
  console.log("favourites:", JSON.stringify(await sidebarApps()));
  console.log("arc bookmarks:", JSON.stringify(s.bookmarkNodes.filter((node) => !node.parentId).map((node) => node.title)));
  // Through the rest of setup to the browser, where the toast offers Undo.
  for (let i = 0; i < 8 && (await page.locator(".setup-dialog [data-onboarding-next]").count()); i++) {
    await page.locator(".setup-dialog [data-onboarding-next]").first().click();
    await wait(900);
  }
  await page.waitForSelector(".fr-yours-panel", { timeout: 8000 }).catch(() => {});
  if (await page.locator("[data-yours-done]").count()) {
    await page.locator(".fr-yours .fr-seg button", { hasText: "In a sidebar" }).click().catch(() => {});
    await wait(500);
    await page.locator("[data-yours-done]").click();
  }
  await wait(900);
  await page.evaluate(() => window.acira.dispatch({ type: "ui.update", patch: { workspaceOpen: true, webWorkspaceOpen: true } }));
  await wait(700);
  console.log("toast:", await page.locator(".toast-row").first().textContent().catch(() => "none"));
  await shot("02-browser-after-arc");
  // Open the Work group so its pinned tabs show.
  await page.locator("[aria-expanded]", { hasText: "Work" }).first().click({ timeout: 1500 }).catch(() => console.log("group header not clickable by text"));
  await wait(600);
  await shot("03-work-group-open");
  if (await page.locator(".toast-action", { hasText: "Undo" }).count()) {
    await page.locator(".toast-action", { hasText: "Undo" }).first().click();
    await wait(1200);
    s = await snapshot();
    console.log("after undo: groups", s.tabGroups.length, "| imported tabs", s.tabs.filter((tab) => tab.group).length, "| favourites", JSON.stringify(await sidebarApps()), "| bookmark roots", JSON.stringify(s.bookmarkNodes.filter((node) => !node.parentId).map((node) => node.title)));
    await shot("04-after-undo");
  } else console.log("no Undo toast visible");
  // Settings → Import & export with Firefox.
  await page.evaluate(() => window.acira.dispatch({ type: "tab.new", url: "acira://settings" }));
  await wait(1500);
  await page.getByRole("button", { name: "Import & export", exact: true }).click();
  await wait(1500);
  await shot("05-settings-sources");
  await page.locator(".aip-source", { hasText: "fox.person@example.com" }).first().click({ timeout: 5000 });
  await wait(1500);
  console.log("firefox categories:", JSON.stringify(await page.locator(".aip-category").allTextContents()));
  await shot("06-settings-firefox");
  await page.getByRole("button", { name: "Import selected data" }).click();
  await wait(2500);
  console.log("receipt:", JSON.stringify(await page.locator(".aip-copy").allTextContents()));
  await page.evaluate(() => window.acira.dispatch({ type: "tab.new", url: "acira://bookmarks" }));
  await wait(1800);
  await page.getByText("Bookmarks bar", { exact: true }).last().click().catch(() => {});
  await wait(900);
  const icons = () => page.evaluate(() => [...document.querySelectorAll("img.site-identity-icon")].map((img) => [img.getAttribute("src").slice(0, 60), img.naturalWidth]).slice(0, 8));
  console.log("bookmark icons:", JSON.stringify(await icons()));
  console.log("row icons:", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll(".site-identity-icon")].map((node) => node.tagName + ":" + (node.getAttribute("src") || "").slice(0, 50)).slice(0, 6))));
  await shot("07-bookmarks-with-icons");
  await page.evaluate(() => window.acira.dispatch({ type: "tab.new", url: "acira://history" }));
  await wait(1500);
  console.log("history icons:", JSON.stringify(await icons()));
  await shot("08-history-with-icons");
} catch (failure) {
  console.log("FATAL", failure.message.split("\n")[0]);
  if (page) await shot("fatal").catch(() => {});
} finally {
  await app.close();
}
console.log(out);
