// Settings › Profiles (R5 founder note): the new-profile form on the list's grid, and "Bring in another account" with
// fixture browser profiles only (LOCALAPPDATA / APPDATA point at a fake Chrome / Edge / Firefox / Zen tree inside the
// disposable .qa-profiles dir, never this PC's real browsers). Real window pixels (desktopCapturer on this app's own
// window), plus measured alignment in metrics.json. One app per run, a native slot lock, closed in `finally`.
// node qa/pm-suggestions-capture.mjs --theme=dark|light [--scale=1.5] [--out=<dir>]
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { launchPreparedNative } from "./prepared-native.mjs";

const root = process.cwd(),
  arg = (name, fallback) => {
    const hit = process.argv.find((item) => item.startsWith("--" + name + "="));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
const theme = arg("theme", "dark"),
  scale = arg("scale", ""),
  tag = `${theme}-${scale ? "150" : "100"}`,
  data = path.join(root, ".qa-profiles", `pm-${tag}-${Date.now()}`),
  local = path.join(data, "fx", "Local"),
  roaming = path.join(data, "fx", "Roaming"),
  out = path.resolve(arg("out", path.join(root, "qa/artifacts/pm-suggestions")));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function png(rgb, size = 64) {
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

async function chromium(userData, people) {
  const cache = {};
  for (const [folder, name, email, color, photo] of people) {
    const location = path.join(userData, folder);
    await fs.mkdir(location, { recursive: true });
    cache[folder] = { name, user_name: email, gaia_name: email ? "Sam Rivera" : "", profile_highlight_color: color, ...(photo ? { gaia_picture_file_name: "Google Profile Picture.png" } : {}) };
    if (photo) await fs.writeFile(path.join(location, "Google Profile Picture.png"), png(photo));
    const pages = [1, 2].map((n) => [`https://${name.toLowerCase().replace(/\s+/g, "-")}.example.org/${n}`, `${name} ${n}`]);
    await fs.writeFile(path.join(location, "Bookmarks"), JSON.stringify({ roots: { bookmark_bar: { name: "Bookmarks bar", children: pages.map(([url, title], i) => ({ type: "url", name: title, url, guid: `${folder}-${i}` })) } } }));
    const history = new DatabaseSync(path.join(location, "History"));
    history.exec("CREATE TABLE urls(url TEXT,title TEXT,last_visit_time INTEGER)");
    for (const [url, title] of pages) history.prepare("INSERT INTO urls VALUES(?,?,?)").run(url, title, (BigInt(Date.now()) + 11644473600000n) * 1000n);
    history.close();
  }
  await fs.writeFile(path.join(userData, "Local State"), JSON.stringify({ profile: { info_cache: cache } }));
}

async function gecko(home, folder) {
  const profile = path.join(home, "Profiles", folder);
  await fs.mkdir(profile, { recursive: true });
  await fs.writeFile(path.join(home, "profiles.ini"), `[Profile0]\r\nName=default-release\r\nIsRelative=1\r\nPath=Profiles/${folder}\r\nDefault=1\r\n`);
  const places = new DatabaseSync(path.join(profile, "places.sqlite"));
  places.exec("CREATE TABLE moz_places(id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_date INTEGER, hidden INTEGER DEFAULT 0); CREATE TABLE moz_bookmarks(id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT, guid TEXT, dateAdded INTEGER)");
  places.prepare("INSERT INTO moz_places VALUES(1,'https://developer.mozilla.org/','MDN',?,0)").run(BigInt(Date.now()) * 1000n);
  const mark = places.prepare("INSERT INTO moz_bookmarks VALUES(?,?,?,?,?,?,?,0)");
  mark.run(1, 2, null, 0, 0, "", "root________");
  mark.run(2, 2, null, 1, 0, "toolbar", "toolbar_____");
  mark.run(10, 1, 1, 2, 0, "MDN", "pmFox0000001");
  places.close();
}

async function buildFixture() {
  await chromium(path.join(local, "Google/Chrome/User Data"), [
    ["Default", "Personal", "sam.rivera@example.com", -13739862, [214, 120, 72]],
    ["Profile 1", "Work", "sam@studio.example", -14983648, null],
  ]);
  await chromium(path.join(local, "Microsoft/Edge/User Data"), [["Default", "School", "s.rivera@uni.example", -8773067, null]]);
  await gecko(path.join(roaming, "Mozilla/Firefox"), "pm01.default-release");
  await gecko(path.join(roaming, "zen"), "pm02.default-release");
}

/** One of the three shared native slots (C:\ae\slot-N.lock, created with 'wx'); released by the caller in `finally`. */
async function takeSlot() {
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const n of [1, 2, 3]) {
      const file = `C:\\ae\\slot-${n}.lock`;
      try {
        const handle = await fs.open(file, "wx");
        await handle.writeFile(`pm-align ${new Date().toISOString()}`);
        await handle.close();
        return file;
      } catch {}
    }
    await wait(30000);
  }
  throw new Error("No native slot free after 20 minutes.");
}

await fs.mkdir(out, { recursive: true });
await buildFixture();
const slot = await takeSlot();
let app;
const metrics = {};
try {
  app = await launchPreparedNative({
    executablePath: createRequire(import.meta.url)("electron"),
    args: [...(scale ? ["--force-device-scale-factor=" + scale] : []), path.join(root, "desktop/main.cjs")],
    env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: local, APPDATA: roaming },
    timeout: 30000,
  });
  let page;
  for (let i = 0; i < 150 && !page; i++) {
    page = app.windows().find((item) => item.url() === "acira-browser-ui://ui/index.html");
    if (!page) await wait(200);
  }
  if (!page) throw new Error("UI page not found");
  await page.waitForLoadState("domcontentloaded");
  const size = async (w, h) => {
    await app.evaluate(({ BaseWindow }, [w, h]) => {
      const win = BaseWindow.getAllWindows().find((item) => item.isVisible()) || BaseWindow.getAllWindows()[0];
      win?.setContentSize(w, h);
    }, [w, h]);
    await wait(500);
  };
  const shot = async (name) => {
    let b64 = "";
    for (let i = 0; i < 10 && !b64; i++) {
      if (i) await wait(300);
      b64 = await app.evaluate(async ({ BaseWindow, desktopCapturer, screen }) => {
        const area = (w) => w.getBounds().width * w.getBounds().height;
        const win = BaseWindow.getAllWindows().filter((w) => w.isVisible() && !w.isMinimized()).sort((a, b) => area(b) - area(a))[0];
        if (!win) return "";
        const bounds = win.getBounds(), factor = screen.getDisplayMatching(bounds).scaleFactor;
        const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: Math.round(bounds.width * factor), height: Math.round(bounds.height * factor) } });
        const source = sources.find((item) => item.id === win.getMediaSourceId());
        return source && !source.thumbnail.isEmpty() ? source.thumbnail.toPNG().toString("base64") : "";
      });
    }
    const file = path.join(out, `${tag}-${name}.png`);
    await fs.writeFile(file, b64 ? Buffer.from(b64, "base64") : await page.screenshot());
    console.log("shot", file);
  };
  const dispatch = (action) => page.evaluate((value) => window.acira.dispatch(value), action);
  /** Where the form's pieces sit against the rows' columns, in CSS px. */
  const measure = () =>
    page.evaluate(() => {
      const box = (selector) => document.querySelector(selector)?.getBoundingClientRect();
      const row = box(".pm-item .pm-row .profile-avatar"), title = box(".pm-item .pm-row .st-title"), face = box(".pm-create-face");
      const label = box(".pm-create .pm-field > span"), input = box(".pm-create .st-input"), swatch = box(".pm-create .pm-swatch > span[aria-hidden]");
      const create = box(".pm-create .st-button.primary"), form = document.querySelector(".pm-create"), group = box(".pm-create")?.width;
      const line = form && getComputedStyle(form, "::before"), formBox = form?.getBoundingClientRect();
      const suggest = box(".pm-suggest .pm-suggest-face"), suggestTitle = box(".pm-suggest .st-title");
      const round = (value) => (value === undefined ? null : Math.round(value * 10) / 10);
      return {
        rowAvatarX: round(row?.left), formAvatarX: round(face?.left), suggestAvatarX: round(suggest?.left),
        rowTextX: round(title?.left), labelX: round(label?.left), inputX: round(input?.left), swatchX: round(swatch?.left), createX: round(create?.left), suggestTextX: round(suggestTitle?.left),
        formAvatarCenterY: round(face && face.top + face.height / 2), inputCenterY: round(input && input.top + input.height / 2),
        labelTop: round(label?.top), labelH: round(label?.height), inputTop: round(input?.top), inputH: round(input?.height), formTop: round(formBox?.top),
        dividerLeft: round(formBox && formBox.left + parseFloat(line.left)), dividerRight: round(formBox && formBox.right - parseFloat(line.right)),
        rowLeft: round(row?.left), listRight: round(box(".pm-item .pm-row") && box(".pm-item .pm-row").right - 12), formWidth: round(group),
        suggestions: document.querySelectorAll(".pm-suggest").length,
      };
    });
  const openProfiles = async () => {
    await dispatch({ type: "tab.new", url: "acira://settings" });
    await wait(1500);
    await page.getByText("Profiles", { exact: true }).first().click();
    await wait(2500); // discovery is async
  };

  await size(1280, 860);
  await page.emulateMedia({ colorScheme: theme });
  try {
    await page.getByRole("button", { name: "Skip setup", exact: true }).click({ timeout: 15000 });
  } catch {}
  await wait(1500);
  await dispatch({ type: "settings.update", patch: { appearance: theme } });
  await dispatch({ type: "browser.profile.create", name: "Studio" });
  await wait(4500); // let the "profile created" toast clear
  await openProfiles();
  await shot("01-closed-suggestions");
  await page.getByRole("button", { name: "New profile", exact: true }).click();
  await wait(400);
  await page.keyboard.type("Home");
  await page.locator(".pm-create .pm-swatch").nth(5).click();
  await wait(400);
  await shot("02-open-suggestions");
  metrics.open = await measure();
  await page.locator(".pm-create .st-input").focus();
  await page.keyboard.press("Tab"); // keyboard focus onto the chosen swatch
  await page.keyboard.press("ArrowRight");
  await wait(300);
  await shot("03-open-swatch-focus");
  await page.keyboard.press("Escape");
  await wait(300);
  // Narrow Settings: the same grid at a phone-like content width.
  await size(760, 860);
  await page.getByRole("button", { name: "New profile", exact: true }).click();
  await wait(400);
  await page.keyboard.type("Home");
  await wait(300);
  await shot("04-narrow-open-suggestions");
  metrics.narrow = await measure();
  await page.keyboard.press("Escape");
  await size(1280, 860);
  // One click: the source becomes its own profile, filled by setup's import pipeline.
  const first = page.locator(".pm-suggest").first();
  metrics.importing = await first.locator(".st-title").textContent();
  await first.getByRole("button").last().click();
  for (let i = 0; i < 40; i++) {
    if ((await first.getAttribute("data-state")) === "done" || (await first.getAttribute("data-state")) === "failed") break;
    await wait(250);
  }
  metrics.importState = await first.getAttribute("data-state");
  metrics.profiles = (await page.evaluate(() => window.acira.getSnapshot())).browserProfiles.map((p) => p.name);
  await wait(600);
  await shot("05-imported");
  // Revisit: an imported source is never offered again.
  await openProfiles();
  metrics.afterImport = await page.locator(".pm-suggest .st-title").allTextContents();
  await shot("06-revisit-after-import");
  // Without suggestions: the fixture browsers go away, so the section is hidden.
  for (const dir of [path.join(local, "Google"), path.join(local, "Microsoft"), path.join(roaming, "Mozilla"), path.join(roaming, "zen")]) await fs.rename(dir, dir + ".off");
  await openProfiles();
  metrics.withoutSources = await page.locator(".pm-suggest").count();
  await shot("07-closed-none");
  await page.getByRole("button", { name: "New profile", exact: true }).click();
  await wait(400);
  await page.keyboard.type("Home");
  await wait(300);
  await shot("08-open-none");
  metrics.none = await measure();
} catch (error) {
  console.log("FAIL", String(error?.message || error).split("\n")[0]);
  process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(out, `${tag}-metrics.json`), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics));
  try {
    await Promise.race([app?.close(), wait(15000)]);
  } catch {}
  try {
    app?.process().kill();
  } catch {}
  await fs.unlink(slot).catch(() => {});
}
