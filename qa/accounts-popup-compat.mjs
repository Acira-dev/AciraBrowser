import { _electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { poll } from "./native-helpers.mjs";

// Synthetic localhost provider only: exercises ordinary browser mechanics,
// never impersonates Google or uses external credentials/consent.
const root = process.cwd(),
  run = Date.now(),
  data = path.join(root, ".qa-profiles/accounts-popup-" + run),
  out = path.join(root, "qa/artifacts/accounts-popup-" + run);
const mainSource = await fs.readFile(
    path.join(root, "desktop/main.cjs"),
    "utf8",
  ),
  ordinaryPopupSource = mainSource
    .split("wc.setWindowOpenHandler(details=>")[1]
    ?.split("wc.on('did-create-window'")[0];
if (
  !ordinaryPopupSource ||
  !/show\s*:\s*process\.env\.ACIRA_BROWSER_TEST_HIDDEN\s*!==\s*['"]1['"]/.test(
    ordinaryPopupSource,
  )
)
  throw new Error(
    "NOT RUN: ordinary popup QA requires creation-time TEST_HIDDEN show:false in the ordinary webpage popup handler. An extension popup guard or an end-only hidden-window check is insufficient.",
  );
await fs.mkdir(data, { recursive: true });
await fs.mkdir(out, { recursive: true });
let base, provider, app;
const valid = new Set(),
  checks = [];
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://fixture");
  response.setHeader("Cache-Control", "no-store");
  const identity = /(?:^|;\s*)session=([^;]+)/.exec(
    request.headers.cookie || "",
  )?.[1];
  if (url.pathname === "/status") {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        signedIn: !!identity && valid.has(identity),
        cookie: request.headers.cookie || "",
      }),
    );
    return;
  }
  if (url.pathname === "/provider") {
    response.setHeader(
      "Set-Cookie",
      "provider=synthetic; HttpOnly; SameSite=Lax; Path=/",
    );
    response.writeHead(302, { Location: base + "/callback" });
    response.end();
    return;
  }
  if (url.pathname === "/callback") {
    valid.add("popup-local");
    response.setHeader("Set-Cookie", [
      "session=popup-local; HttpOnly; SameSite=Lax; Path=/",
      "persistent=popup-local; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400",
    ]);
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><title>Fixture callback</title><script>localStorage.setItem("popup-session","popup-local");opener.postMessage({type:"fixture-signed-in",bridgeAbsent:typeof window.acira==="undefined"},' +
        JSON.stringify(base) +
        ");window.close()</script>",
    );
    return;
  }
  if (url.pathname === "/expiry")
    response.setHeader(
      "Set-Cookie",
      "short=synthetic; HttpOnly; SameSite=Lax; Path=/; Max-Age=1",
    );
  response.setHeader("Content-Type", "text/html");
  response.end(
    '<!doctype html><title>Local provider compatibility</title><h1>Local provider fixture</h1><button id="login">Open provider sign-in fixture</button><p id="result">Not signed in</p><script>document.querySelector("button").onclick=()=>window.open(' +
      JSON.stringify(provider + "/provider") +
      ',"fixture-provider","width=480,height=520");window.addEventListener("message",event=>{if(event.origin===' +
      JSON.stringify(base) +
      '&&event.data.type==="fixture-signed-in"){window.fixtureResult=event.data;document.querySelector("#result").textContent="Fixture callback returned";}});window.statusFixture=async()=>({...(await(await fetch("/status")).json()),local:localStorage.getItem("popup-session")});</script>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
base = "http://127.0.0.1:" + server.address().port;
provider = "http://localhost:" + server.address().port;
async function launch() {
  app = await _electron.launch({
    executablePath:
      process.env.ACIRA_TEST_EXECUTABLE ||
      path.join(root, "node_modules/electron/dist/electron.exe"),
    args: [path.join(root, "desktop/main.cjs")],
    env: {
      ...process.env,
      ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data,
      ACIRA_BROWSER_TEST_HIDDEN: "1",
      ACIRA_MATERIAL: "none",
    },
    timeout: 30000,
  });
  const ui = await poll(
    async () => {
      for (const page of app.context().pages())
        try {
          if (await page.evaluate(() => !!window.acira?.setup)) return page;
        } catch {}
    },
    Boolean,
    "isolated browser chrome",
    15000,
  );
  const setup = await ui.evaluate(() => window.acira.setup({ type: "status" }));
  if (setup.progress?.complete === false)
    await ui.getByRole("button", { name: "Skip setup", exact: true }).click();
  return ui;
}
async function navigate(ui, suffix) {
  const state = await ui.evaluate(() => window.acira.getSnapshot());
  await ui.evaluate(
    ({ tabId, url }) =>
      window.acira.browserCommand({ type: "navigate", tabId, url }),
    { tabId: state.activeTabId, url: base + suffix },
  );
  return poll(
    async () => {
      for (const page of app.context().pages())
        try {
          if (
            page.url() === base + suffix &&
            (await page.evaluate(
              () => typeof window.statusFixture === "function",
            ))
          )
            return page;
        } catch {}
    },
    Boolean,
    "actual fixture website",
    15000,
  );
}
try {
  let ui = await launch(),
    website = await navigate(ui, "/entry");
  await website
    .getByRole("button", { name: "Open provider sign-in fixture", exact: true })
    .click();
  await website
    .getByText("Fixture callback returned", { exact: true })
    .waitFor();
  assert.equal(
    await website.evaluate(() => window.fixtureResult.bridgeAbsent),
    true,
  );
  let state = await website.evaluate(() => window.statusFixture());
  assert.equal(state.signedIn, true);
  assert.equal(state.local, "popup-local");
  assert.match(state.cookie, /session=popup-local/);
  assert.match(state.cookie, /persistent=popup-local/);
  checks.push(
    "cross-site localhost provider popup redirects to127.0.0.1callback with preserved opener/session and no privileged browser bridge",
  );
  const cookies = await app.evaluate(async ({ session }, base) => {
    const ui = session.defaultSession;
    return (await ui.cookies.get({ url: base })).length;
  }, base);
  assert.equal(cookies, 0);
  checks.push("website credentials stay outside trusted UI default session");
  await app.close();
  app = null;
  ui = await launch();
  website = await navigate(ui, "/entry");
  state = await website.evaluate(() => window.statusFixture());
  assert.equal(state.signedIn, true);
  assert.equal(state.local, "popup-local");
  checks.push(
    "popup-created website session and storage survive actual browser restart",
  );
  valid.delete("popup-local");
  state = await website.evaluate(() => window.statusFixture());
  assert.equal(state.signedIn, false);
  assert.match(state.cookie, /session=popup-local/);
  checks.push(
    "provider-side revocation is respected even while native cookie remains",
  );
  website = await navigate(ui, "/expiry");
  const first = await website.evaluate(() => window.statusFixture());
  assert.match(first.cookie, /short=synthetic/);
  await poll(
    () => website.evaluate(() => window.statusFixture()),
    (state) => !/short=/.test(state.cookie),
    "native cookie expiration",
    5000,
  );
  checks.push("ordinary expiring cookie expires without artificial extension");
  // Leave the endpoint that issues the test cookie before session restore. A
  // restored /expiry navigation would correctly receive a NEW server cookie.
  website = await navigate(ui, "/entry");
  await app.close();
  app = null;
  ui = await launch();
  website = await navigate(ui, "/entry");
  state = await website.evaluate(() => window.statusFixture());
  assert.equal(state.signedIn, false);
  assert.doesNotMatch(state.cookie, /short=/);
  checks.push(
    "restart does not revive expired cookie or provider-revoked login",
  );
  assert.equal(
    await app.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows().every((window) => !window.isVisible()),
    ),
    true,
  );
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        checks,
        providerIsSyntheticLocalFixture: true,
        liveGoogleAuthenticated: false,
        nativeRendererIdentity: createHash("sha256")
          .update(await fs.readFile(path.join(root, "desktop/main.cjs")))
          .update(await fs.readFile(path.join(root, "dist/index.html")))
          .digest("hex"),
        visibleWindows: false,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      { checks, artifacts: out, liveGoogleAuthenticated: false },
      null,
      2,
    ),
  );
} catch (error) {
  await fs.writeFile(
    path.join(out, "partial.json"),
    JSON.stringify({ checks, failure: error.message }, null, 2),
  );
  throw error;
} finally {
  await app?.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
