import { chromium } from "playwright";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// UI recovery behavior only: actual React components with explicit failed/deferred
// bridge fixtures in headless Edge. No Electron/native/OS/provider claim.
// Drives the single-card setup (welcome → import → profile → look → search → privacy → default → ready).
const root = process.cwd(),
  out = path.join(root, "qa/artifacts/accounts-errors-" + Date.now());
await fs.mkdir(out, { recursive: true });
const bundle = await build({
  entryPoints: ["qa/accounts-renderer.tsx"],
  bundle: true,
  format: "iife",
  jsx: "automatic",
  write: false,
  outfile: "ui.js",
  // Vite replaces import.meta.env at build time; an iife bundle has to say it explicitly.
  define: { "process.env.NODE_ENV": '"test"', "import.meta.env.DEV": "false" },
});
const assets = new Map(
  bundle.outputFiles.map((file) => [
    "/" + path.basename(file.path),
    Buffer.from(file.contents),
  ]),
);
for (const name of [
  "acira-logo.svg",
  "acira-logo-light.svg",
  "acira-symbol.svg",
])
  assets.set("/" + name, await fs.readFile(path.join(root, "public", name)));
const html =
  '<!doctype html><meta charset="utf-8"><title>Setup recovery fixtures</title><link rel="stylesheet" href="/ui.css"><style>body{margin:0;font:14px/1.5 system-ui;background:#faf7f5;color:#30272b;--text:#30272b;--muted:#62565c;--surface:#faf7f5;--field-bg:#eee8eb;--border:#bbafb5;--accent:#682c46;--surface-tone:light}button{font:inherit;color:inherit}.btn{padding:9px 13px;background:#f3edef;border:1px solid #bca8b2;border-radius:8px}.onboarding-brand img{width:125px;max-height:38px}.brand-dark{display:none}</style><div id="root"></div><script src="/ui.js"></script>';
const server = http.createServer((request, response) => {
  const route = request.url.split("?")[0];
  if (route === "/") {
    response.setHeader("Content-Type", "text/html");
    return response.end(html);
  }
  const value = assets.get(route);
  if (!value) return response.writeHead(404).end();
  response.setHeader(
    "Content-Type",
    route.endsWith(".css")
      ? "text/css"
      : route.endsWith(".svg")
        ? "image/svg+xml"
        : "text/javascript",
  );
  response.end(value);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port,
  browser = await chromium.launch({ channel: "msedge", headless: true }),
  checks = [],
  errors = [];
async function scene(scenario) {
  const page = await browser.newPage({
    viewport: { width: 900, height: 900 },
    reducedMotion: "reduce",
  });
  page.on("pageerror", (error) =>
    errors.push({ scenario, message: error.message }),
  );
  await page.addInitScript(
    ({ scenario }) => {
      const progress = {
        step: ["preference", "handoff-preference"].includes(scenario)
          ? "privacy"
          : ["discovery", "import", "handoff-discovery"].includes(scenario)
            ? "import"
            : scenario === "default"
              ? "default"
              : "welcome",
        complete: false,
        skipped: false,
        upgraded: false,
        importBatchIds: [],
        importInterrupted: false,
      };
      const preferences = {
          appearance: "light",
          searchEngine: "duckduckgo",
          addressSuggestions: true,
          blocking: true,
        },
        source = {
          id: "fixture-source",
          browser: "Fixture browser",
          name: "Personal",
          available: {
            bookmarks: true,
            history: false,
            preferences: false,
            extensions: false,
          },
        };
      let currentProfile = "local-a",
        asked = false,
        initial = true;
      const state = () => ({
        ok: true,
        profileId: currentProfile,
        progress: { ...progress },
        preferences: { ...preferences },
        profiles: [{ id: "local-a", name: "Personal", color: "#62666d" }],
        defaults: {
          supported: true,
          isDefault: asked,
          statusKnown: true,
          note: "Choose Acira in operating system settings.",
        },
      });
      window.switchSetupQaProfile = () => {
        currentProfile = "local-b";
        progress.step = "welcome";
        preferences.appearance = "system";
        window.dispatchEvent(
          new CustomEvent("local-setup-qa-profile", { detail: currentProfile }),
        );
      };
      window.localSetupQa = {
        setup: async (request) => {
          if (
            (scenario === "handoff-preference" &&
              request.type === "preferences") ||
            (scenario === "handoff-discovery" &&
              request.type === "imports.discover") ||
            (scenario === "handoff-skip" && request.type === "skip")
          ) {
            const previous = state();
            return new Promise((resolve) => {
              window.releasePrevious = () => resolve(previous);
            });
          }
          if (request.type === "status" && initial) {
            initial = false;
            if (scenario === "initial-reject")
              throw Error("Explicit failed bridge fixture");
            if (scenario === "initial-known")
              return {
                ok: false,
                error: {
                  code: "ONBOARDING_UNAVAILABLE",
                  message:
                    "Setup progress could not be opened. Your existing browser data is unchanged.",
                },
              };
            if (scenario === "late-status") {
              const initialState = state();
              return new Promise((resolve) => {
                window.releaseInitial = () => resolve(initialState);
              });
            }
          }
          if (request.type === "preferences")
            return {
              ok: false,
              error: {
                code: "UNAVAILABLE",
                message:
                  "This preference could not be saved. Retry or continue browsing.",
              },
            };
          if (request.type === "imports.discover") {
            if (scenario === "discovery")
              throw Error("Explicit failed discovery fixture");
            return { ...state(), sources: [source], batches: [] };
          }
          if (request.type === "imports.preview")
            return {
              ...state(),
              preview: {
                source,
                bookmarks: 3,
                history: null,
                extensions: [],
                warnings: [],
              },
            };
          if (request.type === "imports.run")
            return {
              ok: false,
              error: {
                code: "UNAVAILABLE",
                message:
                  "Source history is locked. Close the source browser and retry.",
              },
            };
          if (request.type === "imports.html")
            return { ...state(), cancelled: true, batches: [] };
          if (request.type === "default.request") {
            asked = true;
            throw Error("Explicit failed OS bridge fixture");
          }
          if (request.type === "skip") {
            if (scenario === "skip-failure")
              return {
                ok: false,
                error: {
                  code: "UNAVAILABLE",
                  message: "Completion could not be saved.",
                },
              };
            progress.complete = true;
            progress.skipped = true;
          }
          return state();
        },
      };
    },
    { scenario },
  );
  await page.goto(base);
  return page;
}
try {
  const welcome = (page) => page.getByRole("heading", { name: "The web, in clear light.", exact: true });
  const done = (page) => page.getByRole("heading", { name: "Local browsing remains available", exact: true });
  const skip = (page) => page.getByRole("button", { name: "Skip setup", exact: true });
  for (const scenario of ["handoff-preference", "handoff-discovery"]) {
    const page = await scene(scenario);
    if (scenario === "handoff-preference")
      await page.getByRole("switch", { name: /Block ads and trackers/ }).click();
    await page.waitForFunction(() => typeof window.releasePrevious === "function");
    await page.evaluate(() => window.switchSetupQaProfile());
    await welcome(page).waitFor();
    assert.equal(await skip(page).isEnabled(), true, scenario + ": the new profile must not inherit a previous request's busy state");
    await page.evaluate(() => window.releasePrevious());
    await page.waitForTimeout(80);
    assert.equal(await welcome(page).count(), 1, scenario + ": a stale completion must not overwrite or dismiss the new profile");
    assert.equal(await page.getByRole("alert").count(), 0);
    checks.push(scenario + ": profile handoff releases busy controls and ignores old response/dismissal");
    await page.close();
  }
  {
    // Skipping never waits on the native write: setup closes at once even while that write is still pending.
    const page = await scene("handoff-skip");
    await skip(page).click();
    await done(page).waitFor();
    await page.waitForFunction(() => typeof window.releasePrevious === "function");
    await page.evaluate(() => window.releasePrevious());
    await page.waitForTimeout(80);
    assert.equal(await done(page).count(), 1);
    checks.push("handoff-skip: skipping closes setup at once; the pending completion write cannot reopen it");
    await page.close();
  }
  for (const scenario of ["initial-reject", "initial-known"]) {
    const page = await scene(scenario);
    await page.getByRole("alert").waitFor();
    await page.getByRole("button", { name: "Start browsing", exact: true }).click();
    await done(page).waitFor();
    checks.push(scenario + ": failed setup status gives an actionable browsing escape without corrupt-data reset");
    await page.close();
  }
  {
    // The privacy master switch is the one choice setup writes through the setup service.
    const page = await scene("preference");
    const blocking = page.getByRole("switch", { name: /Block ads and trackers/ });
    await blocking.click();
    await page.getByRole("alert").filter({ hasText: "could not be saved" }).waitFor();
    await page.waitForFunction(() => document.querySelector(".fr-toggle")?.checked === true);
    assert.equal(await blocking.isChecked(), true);
    assert.equal(await page.getByRole("button", { name: "Continue", exact: true }).isEnabled(), true);
    checks.push("failed preference write restores the actual prior choice and leaves continuation enabled");
    await page.close();
  }
  {
    const page = await scene("discovery");
    await page.getByText("Other browsers couldn’t be read", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Try again", exact: true }).isEnabled(), true);
    assert.equal(await page.getByText("Looking for other browsers…").count(), 0);
    await page.getByRole("button", { name: "use a bookmarks file", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "No file chosen. Nothing was imported." }).waitFor();
    assert.equal(await page.getByText(/^Imported /).count(), 0);
    checks.push("failed discovery stops its busy state and offers a retry; native-file cancellation shows no false import success");
    await page.close();
  }
  {
    const page = await scene("import");
    await page.locator(".fr-pick", { hasText: "Fixture browser · Personal" }).click();
    const importButton = page.getByRole("button", { name: "Import", exact: true });
    await importButton.click();
    await page.getByRole("alert").filter({ hasText: "Source history is locked" }).waitFor();
    await page.waitForFunction(() => !document.querySelector("[data-onboarding-import]")?.disabled);
    assert.equal(await importButton.isEnabled(), true);
    assert.equal(await page.getByText(/^Imported /).count(), 0);
    assert.equal(await page.getByRole("heading", { name: "Bring your work with you.", exact: true }).count(), 1);
    checks.push("failed native-import result leaves the source selection retryable without inventing an import batch");
    await page.close();
  }
  {
    const page = await scene("default");
    await page.getByRole("button", { name: "Set as default", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByText(/Windows Settings|Acira is your default browser/).count(), 0);
    checks.push("failed OS request is never called opened or confirmed");
    await page.close();
  }
  {
    const page = await scene("skip-failure");
    await welcome(page).waitFor();
    await skip(page).click();
    await done(page).waitFor();
    checks.push("failed completion storage never traps the user in setup; this is browsing escape, not a saved-completion claim");
    await page.close();
  }
  {
    // Setup that never finishes opening can still be skipped (the button, and Escape).
    const page = await scene("late-status");
    await skip(page).click();
    await done(page).waitFor();
    await page.evaluate(() => window.releaseInitial());
    await page.waitForTimeout(80);
    assert.equal(await done(page).count(), 1);
    assert.equal(await page.locator(".fr-stage").count(), 0);
    const escape = await scene("late-status");
    await escape.waitForTimeout(200);
    await escape.keyboard.press("Escape");
    await done(escape).waitFor();
    await escape.close();
    checks.push("setup that is still opening can be skipped (button or Escape); a late initial response cannot remount it");
    await page.close();
  }
  assert.deepEqual(errors, []);
  const result = {
    checks,
    errors,
    native: false,
    bridge: "Explicit UI-only rejection/deferred fixtures",
    browser: "headless Edge",
    rendererSha256: createHash("sha256")
      .update(
        bundle.outputFiles.find((file) => file.path.endsWith(".js")).contents,
      )
      .digest("hex"),
    cssSha256: createHash("sha256")
      .update(
        bundle.outputFiles.find((file) => file.path.endsWith(".css")).contents,
      )
      .digest("hex"),
  };
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({ checks, artifacts: out, native: false }, null, 2),
  );
} catch (error) {
  await fs.writeFile(
    path.join(out, "partial.json"),
    JSON.stringify({ checks, errors, failure: error.message }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
