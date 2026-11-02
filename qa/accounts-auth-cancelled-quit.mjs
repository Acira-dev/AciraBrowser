import { _electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { poll } from "./native-helpers.mjs";

const root = process.cwd(),
  run = Date.now(),
  out = path.join(root, "qa/artifacts/accounts-auth-cancelled-quit-" + run);
const data = path.join(
    root,
    ".qa-profiles/accounts-auth-cancelled-quit-" + run,
  ),
  password = "only-cancelled-quit-fixture-" + run;
await fs.mkdir(out, { recursive: true });
let app,
  requests = 0;
const server = http.createServer((request, response) => {
  requests++;
  if (
    request.headers.authorization !==
    "Basic " + Buffer.from("fixture-user:" + password).toString("base64")
  ) {
    response.writeHead(401, {
      "WWW-Authenticate": 'Basic realm="Cancelled quit fixture"',
      "Cache-Control": "no-store",
    });
    return response.end("<title>Authentication required</title>");
  }
  response.end("<title>Authorized after cancelled Quit</title>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port + "/protected",
  entry = path.join(out, "host.cjs");
await fs.writeFile(
  entry,
  `const {app,BrowserWindow}=require('electron');const {createWebsiteAuth}=require(${JSON.stringify(path.join(root, "desktop/website-auth.cjs"))});app.setPath('userData',process.env.ACIRA_AUTH_QUIT_DATA);app.whenReady().then(()=>{const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}}),wc=window.webContents;const broker=createWebsiteAuth({app,resolveOwner:contents=>contents===wc&&!wc.isDestroyed()?{id:'fixture',profileId:'local',tabId:'tab',privateMode:false,active:true,session:wc.session}:null});global.authQuitFixture={window,wc,broker};});app.on('window-all-closed',()=>app.quit());`,
);
const brokerHash = createHash("sha256")
  .update(await fs.readFile("desktop/website-auth.cjs"))
  .digest("hex");
const checks = [];
try {
  app = await _electron.launch({
    executablePath:
      process.env.ACIRA_TEST_EXECUTABLE ||
      path.join(root, "node_modules/electron/dist/electron.exe"),
    args: [entry],
    env: { ...process.env, ACIRA_AUTH_QUIT_DATA: data },
  });
  await poll(
    () => app.evaluate(() => !!global.authQuitFixture),
    Boolean,
    "cancelled Quit auth fixture",
  );
  const before = await app.evaluate(({ app }) => ({
    electron: process.versions.electron,
    listeners: app.listenerCount("login"),
  }));
  assert.equal(before.electron, "44.9.3");
  assert.equal(before.listeners, 1);
  const cancelled = await app.evaluate(({ app }) => {
    app.once("before-quit", (event) => event.preventDefault());
    app.quit();
    return {
      alive: !global.authQuitFixture.window.isDestroyed(),
      listeners: app.listenerCount("login"),
    };
  });
  await fs.writeFile(
    path.join(out, "observation.json"),
    JSON.stringify({ before, cancelled, brokerHash, native: true }, null, 2),
  );
  assert.equal(cancelled.alive, true);
  assert.equal(
    cancelled.listeners,
    1,
    "Cancelled Quit must not dispose the live authentication dispatcher",
  );
  checks.push(
    "a real prevented before-quit keeps the hidden window and exactly one auth dispatcher alive",
  );
  await app.evaluate((_e, url) => {
    void global.authQuitFixture.wc.loadURL(url).catch(() => {});
  }, url);
  const state = await poll(
    () => app.evaluate(() => global.authQuitFixture.broker.snapshot("fixture")),
    (state) => state.requests.length === 1,
    "real HTTP challenge after cancelled Quit",
  );
  await app.evaluate(
    (_e, response) =>
      global.authQuitFixture.broker.respond("fixture", response),
    {
      id: state.requests[0].id,
      action: "submit",
      username: "fixture-user",
      password,
    },
  );
  await poll(
    () => app.evaluate(() => global.authQuitFixture.wc.getTitle()),
    (title) => title === "Authorized after cancelled Quit",
    "authentication remains functional after cancelled Quit",
  );
  checks.push(
    "a subsequent actual Basic challenge still accepts an explicit response after the cancelled Quit",
  );
  assert.equal(
    createHash("sha256")
      .update(await fs.readFile("desktop/website-auth.cjs"))
      .digest("hex"),
    brokerHash,
  );
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((window) => window.isVisible()),
    ),
    false,
  );
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        checks,
        before,
        cancelled,
        brokerHash,
        requests,
        visibleWindows: false,
        credentialsLogged: false,
        scope:
          "Actual native cancelled Quit/HTTP callback in isolated source-broker fixture; product main integration remains separate",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, artifacts: out }, null, 2));
} catch (error) {
  await fs.writeFile(
    path.join(out, "partial.json"),
    JSON.stringify(
      { checks, brokerHash, requests, failure: error.message },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await app?.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
