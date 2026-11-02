import { chromium } from "playwright";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const root = process.cwd(),
  out = path.resolve("qa/artifacts/accounts-profile-cleanup-ui-" + Date.now());
await fs.mkdir(out, { recursive: true });
const selected = [
    "cleanup-types.ts",
    "cleanup-model.ts",
    "ProfileCleanupSettings.tsx",
    "profile-cleanup.css",
  ].map((file) => "src/features/profile-privacy/" + file),
  hashes = async () =>
    Object.fromEntries(
      await Promise.all(
        selected.map(async (file) => [
          file,
          createHash("sha256")
            .update(await fs.readFile(file))
            .digest("hex"),
        ]),
      ),
    ),
  before = await hashes();
const sourceGraph = new Map();
const bundle = await build({
  entryPoints: ["qa/accounts-profile-cleanup-renderer.tsx"],
  bundle: true,
  format: "iife",
  jsx: "automatic",
  write: false,
  outfile: path.join(out, "ui.js"),
  external: ["/fonts/*"],
  loader: { ".woff2": "file", ".woff": "file", ".png": "file", ".svg": "file" },
  define: { "process.env.NODE_ENV": '"test"' },
  plugins: [
    {
      name: "record-exact-source-bytes",
      setup(build) {
        build.onLoad(
          { filter: /\.(?:[cm]?[jt]sx?|css|json)$/ },
          async ({ path: file }) => {
            const contents = await fs.readFile(file),
              extension = path.extname(file).slice(1),
              loader = ["mjs", "cjs"].includes(extension) ? "js" : extension;
            sourceGraph.set(
              path.relative(root, file).replaceAll("\\", "/"),
              createHash("sha256").update(contents).digest("hex"),
            );
            return { contents, loader, resolveDir: path.dirname(file) };
          },
        );
      },
    },
  ],
});
const assets = new Map(
  bundle.outputFiles.map((file) => [
    "/" + path.basename(file.path),
    Buffer.from(file.contents),
  ]),
);
const html = `<!doctype html><meta charset="utf-8"><title>Profile cleanup UI qualification</title><link rel="stylesheet" href="/ui.css"><style>html,body,#root{height:auto;min-height:100%;overflow:visible}.app{min-height:100vh;height:auto}.cleanup-qa-scale{zoom:var(--qa-scale,1);width:auto;min-height:calc(100vh / var(--qa-scale,1))}.cleanup-qa-host{width:100%;max-width:760px;padding:24px;margin:auto}.cleanup-qa-host>h2{font-size:20px;margin:0 0 18px}</style><div id="root"></div><script src="/ui.js"></script>`;
const server = http.createServer(async (request, response) => {
  const route = new URL(request.url, "http://fixture").pathname;
  if (route === "/") {
    response.setHeader("Content-Type", "text/html");
    return response.end(html);
  }
  let value = assets.get(route);
  if (!value && route.startsWith("/fonts/"))
    try {
      value = await fs.readFile(path.join(root, "public", route));
      sourceGraph.set(
        "public" + route,
        createHash("sha256").update(value).digest("hex"),
      );
    } catch {}
  if (!value) return response.writeHead(404).end();
  response.setHeader(
    "Content-Type",
    route.endsWith(".css")
      ? "text/css"
      : route.endsWith(".js")
        ? "text/javascript"
        : "application/octet-stream",
  );
  response.end(value);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port,
  browser = await chromium.launch({ channel: "msedge", headless: true }),
  checks = [],
  errors = [],
  layouts = [];
async function scene(scenario = "default", width = 900, scale = 1) {
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    reducedMotion: "reduce",
  });
  page.on("pageerror", (error) =>
    errors.push({ scenario, message: error.message }),
  );
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === base
      ? route.continue()
      : route.abort(),
  );
  await page.goto(base + "/?scenario=" + scenario);
  await page.locator(".profile-cleanup").waitFor();
  await page.evaluate(
    (scale) =>
      document.documentElement.style.setProperty("--qa-scale", String(scale)),
    scale,
  );
  if (scenario !== "defer-status")
    await page
      .getByText("Loading cleanup settings…", { exact: true })
      .waitFor({ state: "detached" });
  return page;
}
const toggle = (page) =>
    page.getByRole("switch", { name: /^Clear selected data/ }),
  cookie = (page) =>
    page.getByRole("checkbox", { name: /^Cookies and sign-ins/ }),
  review = (page) =>
    page.getByRole("button", { name: "Review and save", exact: true }),
  origins = (page) =>
    page.getByLabel("Sites to keep Optional", { exact: true }),
  qa = (page) => page.evaluate(() => window.cleanupQa.snapshot());
async function edit(page) {
  await toggle(page).check();
  await cookie(page).check();
}
try {
  {
    const page = await scene("cancel");
    await edit(page);
    await review(page).click();
    await page
      .getByText("Not saved. Your edits are still here.", { exact: true })
      .waitFor();
    assert.equal((await qa(page)).states.a.choice.enabled, false);
    assert.equal(await toggle(page).isChecked(), true);
    await page.evaluate(() => window.cleanupQa.setMode("success"));
    await origins(page).fill(
      "HTTPS://MAIL.EXAMPLE.COM:443/\nhttps://mail.example.com",
    );
    await review(page).click();
    await page.getByText("Cleanup settings saved.", { exact: true }).waitFor();
    const state = await qa(page);
    assert.equal(state.calls.filter((call) => call.type === "set").length, 2);
    assert.deepEqual(state.states.a.choice.keepOrigins, [
      "https://mail.example.com",
    ]);
    assert.deepEqual(
      Object.keys(
        state.calls.find((call) => call.type === "set").choice,
      ).sort(),
      ["categories", "enabled", "keepOrigins"],
    );
    assert.equal(await review(page).isDisabled(), true);
    checks.push(
      "native cancellation preserves saved state and edits; later confirmed save canonicalizes origins and sends only choice fields",
    );
    await page.close();
  }
  {
    const page = await scene();
    await toggle(page).check();
    await review(page).click();
    await page
      .getByText("Choose at least one type of data to clear.", { exact: true })
      .waitFor();
    assert.equal(
      await cookie(page).evaluate((node) => node === document.activeElement),
      true,
    );
    await cookie(page).check();
    await origins(page).fill("https://user:secret@example.com/path");
    await review(page).click();
    await page.getByText(/^Line 1: enter an HTTP/).waitFor();
    assert.equal(
      (await qa(page)).calls.filter((call) => call.type === "set").length,
      0,
    );
    await origins(page).fill(
      Array.from(
        { length: 101 },
        (_, index) => "https://site" + index + ".example",
      ).join("\n"),
    );
    await review(page).click();
    await page
      .getByText("Use at most 100 site origins, one per line.", { exact: true })
      .waitFor();
    assert.equal(
      (await qa(page)).calls.filter((call) => call.type === "set").length,
      0,
    );
    checks.push(
      "invalid categories, credential/path origins and over100lists never invoke native set and focus the invalid field",
    );
    await page.close();
  }
  {
    const page = await scene("save-error");
    await edit(page);
    await review(page).click();
    await page
      .getByText(
        "The save could not be confirmed. Check status before trying again.",
        { exact: true },
      )
      .waitFor();
    assert.equal(await review(page).isDisabled(), true);
    assert.equal(await toggle(page).isChecked(), true);
    await page
      .getByRole("button", { name: "Check status", exact: true })
      .click();
    await page
      .getByText("Status updated. Your edits are still here.", { exact: true })
      .waitFor();
    assert.equal(await review(page).isEnabled(), true);
    checks.push(
      "uncertain save error preserves draft, labels last-known state and requires a real status read before another save",
    );
    await page.close();
  }
  {
    const page = await scene("applied-error");
    await edit(page);
    await review(page).click();
    await page
      .getByText(
        "The save could not be confirmed. Check status before trying again.",
        { exact: true },
      )
      .waitFor();
    await page
      .getByRole("button", { name: "Check status", exact: true })
      .click();
    await page.getByText("Cleanup status updated.", { exact: true }).waitFor();
    assert.equal(await review(page).isDisabled(), true);
    assert.equal(
      (await qa(page)).calls.filter((call) => call.type === "set").length,
      1,
    );
    checks.push(
      "status confirms a save whose response failed without duplicate mutation or false unsaved state",
    );
    await page.close();
  }
  for (const scenario of ["running", "recovery"]) {
    const page = await scene(scenario);
    assert.equal(await toggle(page).isDisabled(), true);
    assert.equal(await review(page).isDisabled(), true);
    assert.equal(
      await page
        .getByRole("button", { name: "Check status", exact: true })
        .isEnabled(),
      true,
    );
    assert.equal(
      await page
        .getByRole("button", { name: /retry|recover now|run cleanup/i })
        .count(),
      0,
    );
    const reads = (await qa(page)).calls.length;
    await page
      .getByRole("button", { name: "Check status", exact: true })
      .click();
    await page.getByText("Cleanup status updated.", { exact: true }).waitFor();
    assert.equal((await qa(page)).calls.length, reads + 1);
    checks.push(
      scenario +
        " locks changes without inventing a recovery action; status refresh is read-only",
    );
    await page.close();
  }
  {
    const page = await scene("pending");
    await page.getByText("Cleanup is queued", { exact: true }).waitFor();
    assert.equal(await toggle(page).isEnabled(), true);
    assert.equal(
      await page.getByText(/cleanup (?:complete|completed|finished)/i).count(),
      0,
    );
    checks.push(
      "pending queued data never reads as cleared and does not incorrectly lock an editable native choice",
    );
    await page.close();
  }
  {
    const page = await scene("private");
    assert.equal((await qa(page)).calls.length, 0);
    assert.equal(await page.getByRole("switch").count(), 0);
    checks.push(
      "private rendering performs no ordinary-profile status or mutation requests",
    );
    await page.close();
  }
  {
    const page = await scene("defer-status");
    await page.evaluate(() => window.cleanupQa.switchProfile("b"));
    await origins(page).waitFor();
    assert.equal(await origins(page).inputValue(), "https://b.example");
    await page.evaluate(() => window.cleanupQa.releaseRead());
    await page.waitForTimeout(80);
    assert.equal(await origins(page).inputValue(), "https://b.example");
    checks.push(
      "late initial status cannot replace another profile's fresh fields",
    );
    await page.close();
  }
  {
    const page = await scene("defer-save");
    await edit(page);
    await review(page).click();
    assert.equal(
      await page
        .getByRole("button", { name: "Saving…", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      (await qa(page)).calls.filter((call) => call.type === "set").length,
      1,
    );
    await page.evaluate(() => window.cleanupQa.switchProfile("b"));
    await origins(page).waitFor();
    await page.evaluate(() => window.cleanupQa.releaseSave());
    await page.waitForTimeout(80);
    assert.equal(await origins(page).inputValue(), "https://b.example");
    assert.equal(await toggle(page).isEnabled(), true);
    checks.push(
      "pending native review rejects duplicate submit and cannot disable or overwrite the next profile",
    );
    await page.close();
  }
  {
    const page = await scene("defer-save");
    await edit(page);
    await review(page).click();
    await page.evaluate(() => window.cleanupQa.unmount());
    await page.getByText("Panel closed", { exact: true }).waitFor();
    await page.evaluate(() => window.cleanupQa.releaseSave());
    await page.waitForTimeout(80);
    assert.equal(await page.locator(".profile-cleanup").count(), 0);
    checks.push("unmounted panel ignores a completed native review");
    await page.close();
  }
  {
    const page = await scene("load-error");
    await page
      .getByText("Cleanup settings could not be loaded.", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Reload settings", exact: true })
      .click();
    await toggle(page).waitFor();
    checks.push(
      "initial getter failure remains truthful and recovers through the implemented status operation",
    );
    await page.close();
  }
  {
    const page = await scene("wrong-status");
    await page
      .getByText("Cleanup settings could not be loaded.", { exact: true })
      .waitFor();
    assert.equal(await toggle(page).count(), 0);
    assert.equal(
      (await qa(page)).calls.filter((call) => call.type === "set").length,
      0,
    );
    checks.push(
      "wrong-profile status fails closed without rendering another profile's controls",
    );
    await page.close();
  }
  for (const privateMode of [false, true]) {
    const page = await scene("defer-save");
    await edit(page);
    await review(page).click();
    await page.evaluate(
      (privateMode) => window.cleanupQa.switchProfile("b", privateMode),
      privateMode,
    );
    if (privateMode)
      await page
        .getByText(/Private windows use separate temporary storage/)
        .waitFor();
    else await origins(page).waitFor();
    const before = (await qa(page)).calls.length;
    await page.evaluate(() => window.cleanupQa.releaseSave("cancel"));
    await page.waitForTimeout(80);
    assert.equal((await qa(page)).calls.length, before);
    assert.equal(
      await page
        .getByText("Not saved. Your edits are still here.", { exact: true })
        .count(),
      0,
    );
    if (privateMode) assert.equal(await toggle(page).count(), 0);
    else assert.equal(await origins(page).inputValue(), "https://b.example");
    checks.push(
      privateMode
        ? "switching to private mode cancels ordinary UI ownership; late cancellation triggers no requests or feedback"
        : "late native cancellation cannot leak feedback into the next profile",
    );
    await page.close();
  }
  {
    const page = await scene("strict");
    await edit(page);
    await review(page).click();
    await page.getByText("Cleanup settings saved.", { exact: true }).waitFor();
    assert.equal(
      (await qa(page)).calls.filter((call) => call.type === "set").length,
      1,
    );
    checks.push(
      "React StrictMode effect replay accepts the current status and never duplicates a save",
    );
    await page.close();
  }
  {
    const page = await scene("cancel", 600, 1.5);
    await toggle(page).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    for (let index = 0; index < 4; index++) await page.keyboard.press("Tab");
    assert.equal(
      await origins(page).evaluate((node) => node === document.activeElement),
      true,
    );
    await page.keyboard.type("https://keyboard.example");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    assert.equal(
      await review(page).evaluate((node) => node === document.activeElement),
      true,
    );
    await page.keyboard.press("Enter");
    await page
      .getByText("Not saved. Your edits are still here.", { exact: true })
      .waitFor();
    checks.push(
      "real sequential Tab/Space/Enter covers toggle, category, origin, details and native-review action at150percent",
    );
    await page.close();
  }
  for (const state of [
    "empty",
    "configured",
    "error",
    "cancel",
    "pending",
    "private",
    "changed-profile",
    "recovery",
  ])
    for (const width of [900, 360])
      for (const scale of [1, 1.5])
        for (const dark of [false, true]) {
          const scenario =
            state === "error"
              ? "save-error"
              : state === "changed-profile"
                ? "default"
                : state;
          const page = await scene(scenario, width, scale);
          if (state === "error" || state === "cancel") {
            await edit(page);
            await review(page).click();
            await page
              .getByText(
                state === "cancel"
                  ? "Not saved. Your edits are still here."
                  : "The save could not be confirmed. Check status before trying again.",
                { exact: true },
              )
              .waitFor();
          }
          if (state === "changed-profile") {
            await page.evaluate(() => window.cleanupQa.switchProfile("b"));
            await origins(page).waitFor();
          }
          await page.evaluate(
            (dark) => window.cleanupQa.setTheme("Porcelain", dark),
            dark,
          );
          await page.waitForTimeout(60);
          await page.evaluate(() => document.fonts.ready);
          const metrics = await page
            .locator(".profile-cleanup")
            .evaluate((card) => {
              const rect = card.getBoundingClientRect();
              return {
                width: innerWidth,
                right: rect.right,
                overflow: document.documentElement.scrollWidth - innerWidth,
                clipped: [
                  ...card.querySelectorAll("button,input,textarea"),
                ].filter((node) => {
                  const r = node.getBoundingClientRect();
                  return (
                    r.width > 0 &&
                    (r.left < rect.left - 1 || r.right > rect.right + 1)
                  );
                }).length,
              };
            });
          assert.ok(metrics.overflow <= 1, JSON.stringify(metrics));
          assert.equal(metrics.clipped, 0);
          const name = `${state}-${width}-${scale}-${dark ? "dark" : "light"}.png`;
          await page.screenshot({ path: path.join(out, name), fullPage: true });
          layouts.push({ state, width, scale, dark, ...metrics, image: name });
          await page.close();
        }
  {
    const page = await scene("configured", 600, 1.5),
      names = await page.evaluate(() => window.cleanupQa.paletteNames);
    for (const name of names)
      for (const dark of [false, true]) {
        await page.evaluate(
          ({ name, dark }) => window.cleanupQa.setTheme(name, dark),
          { name, dark },
        );
        await page.waitForTimeout(20);
        const result = await page
          .locator(".profile-cleanup")
          .evaluate((card) => ({
            text: getComputedStyle(card).color,
            surface: getComputedStyle(card).backgroundColor,
            overflow: document.documentElement.scrollWidth - innerWidth,
          }));
        assert.ok(result.overflow <= 1);
        layouts.push({ palette: name, dark, ...result });
      }
    checks.push(
      "all canonical finishes/light-dark render with the full shared stylesheet graph; normal/narrow100/150 geometry has no horizontal clipping",
    );
    await page.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(await hashes(), before);
  const exactSourceGraph = Object.fromEntries(
    [...sourceGraph].sort(([a], [b]) => a.localeCompare(b)),
  );
  for (const [file, hash] of Object.entries(exactSourceGraph))
    assert.equal(
      createHash("sha256")
        .update(await fs.readFile(path.resolve(root, file)))
        .digest("hex"),
      hash,
      `Source changed during qualification: ${file}`,
    );
  const result = {
    status: "PASS",
    checks,
    layouts,
    errors,
    selectedSources: before,
    selectedSourcesStable: true,
    exactSourceGraph,
    exactSourceGraphStable: true,
    native: false,
    qualification:
      "Actual React component and shared style/theme/font graph with explicit in-memory status/set fixtures in headless Edge. No product/native Settings route, confirmation, persistence, cleanup or private-worker fix claim.",
  };
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify(
      { status: result.status, checks, layouts: layouts.length, out },
      null,
      2,
    ),
  );
} catch (error) {
  await fs.writeFile(
    path.join(out, "partial.json"),
    JSON.stringify(
      { checks, layouts, errors, failure: error.stack || error.message },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
