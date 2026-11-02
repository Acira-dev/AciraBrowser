import { chromium } from "playwright";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const root = process.cwd(),
  out = path.join(root, "qa/artifacts/accounts-http-auth-ui-" + Date.now());
await fs.mkdir(out, { recursive: true });
const bundle = await build({
  stdin: {
    contents:
      'import {createRoot} from "react-dom/client";import {WebsiteAuthDialog} from "./src/features/WebsiteAuthDialog";createRoot(document.getElementById("root")).render(<WebsiteAuthDialog client={window.httpAuthQa}/>);',
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  format: "iife",
  jsx: "automatic",
  outfile: "ui.js",
  write: false,
  define: { "process.env.NODE_ENV": '"test"' },
});
const assets = new Map(
  bundle.outputFiles.map((file) => [
    "/" + path.basename(file.path),
    file.contents,
  ]),
);
const html =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"><style>body{margin:0;font:14px system-ui;--text:#30272b;--muted:#62565c;--surface:#faf7f5;--field-bg:#eee8eb;--border:#bbafb5;--accent:#682c46;--on-accent:#fff}body.dark{--text:#f5edf1;--muted:#d0bec9;--surface:#30252d;--field-bg:#493642;--border:#82707c;--accent:#d7adc5;--on-accent:#231b21}</style><button id="address">Browser address fixture</button><div id="root"></div><script src="/ui.js"></script>';
const server = http.createServer((request, response) => {
  if (request.url === "/") {
    response.setHeader("Content-Type", "text/html");
    return response.end(html);
  }
  const asset = assets.get(request.url);
  if (!asset) return response.writeHead(404).end();
  response.setHeader(
    "Content-Type",
    request.url.endsWith("css") ? "text/css" : "text/javascript",
  );
  response.end(asset);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ channel: "msedge", headless: true }),
  checks = [],
  errors = [];
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on("pageerror", (error) => errors.push(error.message));
await page.addInitScript(() => {
  let state = { revision: 0, requests: [] };
  const listeners = new Set();
  const publish = (requests) => {
    state = { revision: state.revision + 1, requests };
    for (const listener of listeners) listener(structuredClone(state));
  };
  window.httpAuthResponses = [];
  window.bubbledEscapes = 0;
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") window.bubbledEscapes++;
  });
  window.httpAuthQa = {
    snapshot: () =>
      new Promise((resolve) => {
        const initial = structuredClone(state);
        window.releaseInitial = () => resolve(initial);
      }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    respond: async (response) => {
      window.httpAuthResponses.push(response);
      if (window.rejectNext) {
        window.rejectNext = false;
        throw Error("Explicit transport rejection fixture");
      }
      if (window.deferNext) {
        window.deferNext = false;
        await new Promise((resolve) => {
          window.releaseResponse = resolve;
        });
      }
      publish(state.requests.filter((request) => request.id !== response.id));
      return { ok: true };
    },
  };
  window.showAuth = (id, extra = {}) =>
    publish([
      {
        id,
        origin: "http://127.0.0.1:49123",
        host: "127.0.0.1",
        port: 49123,
        realm: '<img src=x onerror="window.realmExecuted=true"> local fixture',
        scheme: "basic",
        profileId: "local-a",
        tabId: "tab-a",
        privateMode: false,
        insecure: true,
        retry: false,
        createdAt: 1,
        ...extra,
      },
    ]);
  window.showQueue = () =>
    publish(
      ["queued-a", "queued-b"].map((id) => ({
        id,
        origin: "https://example.test",
        host: "example.test",
        port: 443,
        realm: "Local queue fixture",
        scheme: "basic",
        profileId: "local-a",
        tabId: "tab-a",
        privateMode: false,
        insecure: false,
        retry: false,
        createdAt: 1,
      })),
    );
});
try {
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.waitForFunction(() => typeof window.releaseInitial === "function");
  await page.locator("#address").focus();
  await page.evaluate(() => window.showAuth("first"));
  const dialog = page.getByRole("dialog"),
    username = page.getByLabel("Username", { exact: true }),
    password = page.getByLabel("Password", { exact: true });
  await username.waitFor();
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("autocomplete") === "off",
  );
  assert.equal(
    await username.evaluate((element) => element === document.activeElement),
    true,
  );
  assert.equal(await dialog.locator("img").count(), 0);
  assert.equal(await page.evaluate(() => !!window.realmExecuted), false);
  await page.getByText("http://127.0.0.1:49123", { exact: true }).waitFor();
  await page
    .getByText("This site uses an unencrypted HTTP connection.", {
      exact: true,
    })
    .waitFor();
  await page.evaluate(() => window.releaseInitial());
  await page.waitForTimeout(40);
  assert.equal(await dialog.count(), 1);
  await page.screenshot({ path: path.join(out, "light.png") });
  checks.push(
    "explicit challenge origin, HTTP disclosure and text-only hostile realm render; a delayed initial snapshot cannot erase the newer prompt",
  );
  await username.focus();
  await page.keyboard.press("Shift+Tab");
  assert.equal(
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .evaluate((element) => element === document.activeElement),
    true,
  );
  await page.keyboard.press("Tab");
  assert.equal(
    await username.evaluate((element) => element === document.activeElement),
    true,
  );
  checks.push(
    "initial focus and both directions of the keyboard focus loop stay in the trusted dialog",
  );
  await username.fill("fixture-user");
  await password.fill("only-ui-fixture-secret");
  await page.evaluate(() => {
    window.deferNext = true;
  });
  await password.press("Enter");
  await page.waitForFunction(() => window.httpAuthResponses.length === 1);
  assert.equal(await username.inputValue(), "");
  assert.equal(await password.inputValue(), "");
  assert.equal(
    await page.evaluate(() => {
      const response = window.httpAuthResponses[0];
      return (
        response.action === "submit" &&
        response.username === "fixture-user" &&
        response.password === "only-ui-fixture-secret"
      );
    }),
    true,
  );
  await page.evaluate(() => window.releaseResponse());
  await dialog.waitFor({ state: "detached" });
  checks.push(
    "Enter sends only the explicit request's fixture credentials once and clears both fields while the reply is pending",
  );
  await page.evaluate(() =>
    window.showAuth("retry", { retry: true, privateMode: true }),
  );
  await username.waitFor();
  assert.equal(await username.inputValue(), "");
  assert.equal(await password.inputValue(), "");
  await page.getByRole("alert").filter({ hasText: "did not accept" }).waitFor();
  await page
    .getByText("Website sign-in · Private window", { exact: true })
    .waitFor();
  await username.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(
    await page
      .locator("#address")
      .evaluate((element) => element === document.activeElement),
    true,
  );
  assert.equal(await page.evaluate(() => window.bubbledEscapes), 0);
  checks.push(
    "retry/private identity is explicit, secrets are not reused, Escape cancels without bubbling and restores prior browser focus",
  );
  await page.evaluate(() => window.showQueue());
  await username.waitFor();
  await username.fill("do-not-copy");
  await password.fill("do-not-copy");
  await page
    .getByText("1 other sign-in request waiting.", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.waitForFunction(() =>
    window.httpAuthResponses.some((response) => response.id === "queued-a"),
  );
  await page.waitForTimeout(30);
  assert.equal(await username.inputValue(), "");
  assert.equal(await password.inputValue(), "");
  checks.push(
    "queued native request changes replace the form and never copy prior username/password",
  );
  await username.fill("fixture-user");
  await password.fill("fake");
  await page.evaluate(() => {
    window.rejectNext = true;
  });
  await password.press("Enter");
  await page
    .getByRole("alert")
    .filter({ hasText: "could not be sent" })
    .waitFor();
  assert.equal(await password.inputValue(), "");
  assert.equal(
    await page.getByRole("button", { name: "Cancel", exact: true }).isEnabled(),
    true,
  );
  checks.push(
    "rejected transport gives an actionable error with empty password and usable Cancel",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await page.setViewportSize({ width: 360, height: 740 });
  await page.evaluate(() => {
    document.body.className = "dark";
    window.showAuth("narrow", {
      realm: "Long local fixture realm ".repeat(10),
    });
  });
  await username.waitFor();
  const bounds = await dialog.boundingBox();
  assert.ok(
    bounds.x >= 0 &&
      bounds.x + bounds.width <= 360 &&
      bounds.y >= 0 &&
      bounds.y + bounds.height <= 740,
  );
  assert.equal(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
    true,
  );
  await page.screenshot({ path: path.join(out, "dark-narrow.png") });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  checks.push(
    "light and dark narrow UI have bounded dialog geometry, scrolling and no horizontal clipping",
  );
  assert.deepEqual(errors, []);
  const result = {
    checks,
    errors,
    native: false,
    scope:
      "Actual React dialog with explicit headless client fixtures; native callback tested separately, main IPC/layout integration pending",
    rendererSha256: createHash("sha256")
      .update(
        bundle.outputFiles.find((file) => file.path.endsWith(".js")).contents,
      )
      .digest("hex"),
  };
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ checks, artifacts: out }, null, 2));
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
