// Profiles beyond setup (stream F): the profile panel, Settings → Profiles (edit, remove, new) and the private-window
// entry, as real composited window pixels (the panel lives in the overlay view, so page.screenshot can't see it).
// node qa/f-profiles-capture.mjs --theme=dark|light [--size=1440x900] [--scale=1.5]
import { _electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd(),
  arg = (name, fallback) => {
    const hit = process.argv.find((item) => item.startsWith("--" + name + "="));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
const theme = arg("theme", "dark"),
  [width, height] = String(arg("size", "1440x900")).split("x").map(Number),
  data = path.join(root, `.qa-profiles/f-profiles-${theme}-${Date.now()}`),
  out = path.join(root, `qa/artifacts/f-profiles-${theme}${arg("scale", "") ? "-x" + arg("scale", "") : ""}-${Date.now()}`),
  seed = path.join(root, ".qa-profiles/first-run-seed");
await fs.cp(seed, data, { recursive: true, filter: (source) => !/lockfile$|Singleton/.test(source) });
await fs.mkdir(out, { recursive: true });
const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.join(root, ".qa-profiles/import-fixture") };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ACIRA_DEV;
const scaleArgs = arg("scale", "") ? ["--force-device-scale-factor=" + arg("scale", "1")] : [];
const app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: [...scaleArgs, path.join(root, "desktop/main.cjs")], env, timeout: 30000 });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let page;
const capture = () =>
  app.evaluate(async ({ BaseWindow, desktopCapturer, screen }) => {
    const area = (w) => w.getBounds().width * w.getBounds().height;
    const win = BaseWindow.getAllWindows().filter((w) => w.isVisible() && !w.isMinimized()).sort((a, b) => area(b) - area(a))[0];
    if (!win) return "";
    const bounds = win.getBounds(), scale = screen.getDisplayMatching(bounds).scaleFactor;
    const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: Math.round(bounds.width * scale), height: Math.round(bounds.height * scale) } });
    const source = sources.find((item) => item.id === win.getMediaSourceId());
    return source && !source.thumbnail.isEmpty() ? source.thumbnail.toPNG().toString("base64") : "";
  });
const shot = async (name) => {
  let b64 = "";
  for (let i = 0; i < 10 && !b64; i++) {
    if (i) await wait(300);
    b64 = await capture();
  }
  await fs.writeFile(path.join(out, name + ".png"), b64 ? Buffer.from(b64, "base64") : await page.screenshot());
  console.log("shot", name);
};
const step = async (label, fn) => {
  try {
    await fn();
  } catch (failure) {
    console.log("FAIL", label, String(failure.message || failure).split("\n")[0]);
  }
};
if (process.argv.includes("--details")) app.on("window", (w) => w.on("console", (m) => m.type() === "error" && console.log("console:", m.text().slice(0, 200))));
const dispatch = (action) => page.evaluate((value) => window.acira.dispatch(value), action);
const snapshot = () => page.evaluate(() => window.acira.getSnapshot());
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
  await page.waitForSelector(".fr-skip", { timeout: 20000 });
  await page.locator(".fr-skip").click();
  await wait(1500);
  await dispatch({ type: "settings.update", patch: { appearance: theme, verticalTabs: true } });
  await dispatch({ type: "ui.update", patch: { workspaceOpen: true, webWorkspaceOpen: true } });
  // Three profiles with their own colours, so the panel and the manager have something real to show.
  for (const [name, color] of [["Work", "#266a98"], ["Studio", "#7d4f8a"]]) {
    await dispatch({ type: "browser.profile.create", name });
    await wait(400);
    const created = (await snapshot()).browserProfiles.find((profile) => profile.name === name);
    if (created) await dispatch({ type: "browser.profile.update", id: created.id, color });
  }
  await wait(4500); // let the "profile created" toasts clear
  await step("panel", async () => {
    await page.locator('[aria-label$="Switch profile"]').first().click();
    await wait(900);
    await shot("pf-01-panel");
    await page.locator(".pf-row", { hasText: "New private window" }).first().hover().catch(() => {});
    await wait(300);
    await shot("pf-02-panel-hover-private");
    await page.keyboard.press("Escape");
    await wait(400);
  });
  await step("settings", async () => {
    await dispatch({ type: "tab.new", url: "acira://settings" });
    await wait(1600);
    await page.getByText("Profiles", { exact: true }).first().click();
    await wait(900);
    await shot("st-01-profiles");
  });
  await step("edit", async () => {
    await page.getByRole("button", { name: "Edit", exact: true }).nth(1).click();
    await wait(600);
    await shot("st-02-profile-edit");
  });
  await step("remove", async () => {
    await page.getByRole("button", { name: "Remove profile…", exact: true }).click();
    await wait(500);
    await shot("st-03-profile-remove");
    await page.keyboard.press("Escape");
    await wait(200);
    await page.keyboard.press("Escape");
    await wait(300);
  });
  await step("create", async () => {
    await page.getByRole("button", { name: "New profile", exact: true }).click();
    await wait(400);
    await page.keyboard.type("Home");
    await wait(400);
    await shot("st-04-profile-create");
    await page.keyboard.press("Escape");
  });
  if (process.argv.includes("--details"))
    await step("details", async () => {
      // Photo, email and default on D's API, read back from the browser's own state after each change.
      const work = () => snapshot().then((s) => [s.browserProfiles.find((p) => p.name === "Work"), s.settings.defaultProfileId]);
      // A fresh Settings tab, so no editor is left open from the earlier steps; Work's row is found by its name.
      await dispatch({ type: "tab.new", url: "acira://settings" });
      await wait(1400);
      await page.getByText("Profiles", { exact: true }).first().click();
      await wait(700);
      const editWork = () => page.locator(".pm-item", { hasText: "Work" }).getByRole("button", { name: "Edit", exact: true }).click();
      await editWork();
      await page.waitForTimeout(400);
      await page.locator(".pm-photo-col input[type=file]").setInputFiles(path.join(root, "public/app-icon.png"));
      await wait(900);
      console.log("editor problem after photo:", await page.locator(".pm-editor-problem").textContent().catch(() => "none"));
      let [profile, defaultId] = await work();
      console.log("photo:", profile?.picture ? `${profile.picture.slice(0, 22)}… ${Math.round(profile.picture.length / 1024)}KB` : "none");
      const email = page.locator(".pm-editor input[type=email]");
      await email.fill("work@");
      await wait(200);
      console.log("bad email blocks Save:", await page.locator(".pm-editor button[type=submit]").isDisabled(), "|", await page.locator(".pm-editor input[type=email] + small").textContent());
      await email.fill("work@example.com");
      await page.locator(".pm-editor button[type=submit]").click();
      await wait(800);
      console.log("editor problem after email:", await page.locator(".pm-editor-problem").textContent().catch(() => "none"), "| editor open:", await page.locator(".pm-editor").count());
      [profile, defaultId] = await work();
      console.log("email:", profile?.email);
      await editWork();
      await page.waitForTimeout(400);
      await page.getByRole("switch", { name: "Default profile" }).click();
      await wait(800);
      [profile, defaultId] = await work();
      console.log("default is Work:", defaultId === profile?.id);
      await shot("st-05-details");
      await page.keyboard.press("Escape");
      await wait(300);
      console.log("step: open panel");
      // This Settings view has no browser sidebar; the panel opens from a new tab's sidebar chip.
      await dispatch({ type: "tab.new" });
      await dispatch({ type: "ui.update", patch: { workspaceOpen: true, webWorkspaceOpen: true } });
      await wait(900);
      await page.locator('[aria-label$="Switch profile"]').filter({ visible: true }).first().click({ timeout: 5000 });
      await wait(900);
      await shot("pf-05-panel-photo");
      await page.keyboard.press("Escape");
      await wait(300);
      console.log("step: remove photo");
      await dispatch({ type: "tab.new", url: "acira://settings" });
      await wait(1400);
      await page.getByText("Profiles", { exact: true }).first().click();
      await wait(700);
      await editWork();
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: "Remove photo", exact: true }).click({ timeout: 5000 });
      await wait(800);
      [profile] = await work();
      console.log("photo removed:", !profile?.picture);
      console.log("all:", JSON.stringify((await snapshot()).browserProfiles.map((p) => [p.name, p.picture ? "photo" : "", p.email || ""])));
      await page.keyboard.press("Escape");
    });
  await step("private window", async () => {
    const before = new Set(app.windows());
    await page.evaluate(() => window.acira.openWindow("private"));
    let next;
    for (let i = 0; i < 50 && !next; i++) {
      next = app.windows().find((item) => !before.has(item) && item.url() === "acira-browser-ui://ui/index.html");
      if (!next) await wait(200);
    }
    if (!next) throw new Error("private window did not open");
    page = next;
    await page.waitForLoadState("domcontentloaded");
    await wait(1500);
    await app.evaluate(({ BaseWindow }, size) => {
      for (const win of BaseWindow.getAllWindows()) if (win.isVisible()) (win.setContentSize(size[0], size[1]), win.center());
    }, [width, height]);
    await page.emulateMedia({ colorScheme: theme });
    await wait(600);
    await shot("pf-03-private-window");
    console.log("private labels", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("[aria-label]")].map((n) => n.getAttribute("aria-label")).filter((l) => /profile|private/i.test(l)))));
    // A private window may offer no profile control (the sidebar chip is a plain "Private" label there).
    const control = page.locator('[aria-label$="Switch profile"]');
    if (!(await control.count())) {
      console.log("private window: no profile control to open");
      return;
    }
    const opened = await control
      .first()
      .click({ timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (!opened) {
      console.log("private window: the profile control is not interactive here");
      return;
    }
    await wait(900);
    await shot("pf-04-panel-private-window");
  });
} catch (failure) {
  console.log("FATAL", failure.message);
  if (page) await shot("fatal").catch(() => {});
} finally {
  await app.close();
}
console.log(out);
