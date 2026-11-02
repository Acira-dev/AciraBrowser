import { _electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { X509Certificate, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { poll } from "./native-helpers.mjs";

// One QA native dispatcher; services own routing and the guard only proves it.
// No product listener/UI integration or provider proxy acceptance is claimed.
const root = process.cwd(),
  run = Date.now(),
  secret = "local-proxy-only-" + run;
const out = path.join(root, "qa/artifacts/accounts-proxy-auth-" + run),
  data = path.join(root, ".qa-profiles/accounts-proxy-auth-" + run);
await fs.mkdir(out, { recursive: true });
await fs.mkdir(data, { recursive: true });
await promisify(execFile)(
  process.env.OPENSSL_BIN || "C:/Program Files/Git/usr/bin/openssl.exe",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-keyout",
    path.join(data, "fixture.key"),
    "-out",
    path.join(data, "fixture.pem"),
    "-days",
    "1",
    "-nodes",
    "-subj",
    "/CN=proxy-secure.acira.test",
    "-addext",
    "subjectAltName=DNS:proxy-secure.acira.test",
  ],
);
const certificate = await fs.readFile(path.join(data, "fixture.pem")),
  fingerprint = new X509Certificate(certificate).fingerprint256;
const key = await fs.readFile(path.join(data, "fixture.key"));
const proxyTraffic = [],
  originTraffic = [],
  sockets = new Set(),
  checks = [];
const track = (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.on("error", () => {});
};
const origin = http.createServer((request, response) => {
  originTraffic.push({
    path: request.url,
    authorizationPresent: !!request.headers.authorization,
    proxyAuthorizationPresent: !!request.headers["proxy-authorization"],
    secure: false,
  });
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "text/html");
  if (request.url.startsWith("/origin-auth")) {
    response.writeHead(401, {
      "WWW-Authenticate": 'Basic realm="Origin only"',
    });
    return response.end("<title>Origin auth required</title>");
  }
  response.end(
    "<title>Proxy forward accepted</title><h1>Local forward fixture</h1>",
  );
});
const secure = https.createServer(
  { key, cert: certificate },
  (request, response) => {
    originTraffic.push({
      path: request.url,
      authorizationPresent: !!request.headers.authorization,
      proxyAuthorizationPresent: !!request.headers["proxy-authorization"],
      secure: true,
    });
    response.setHeader("Cache-Control", "no-store");
    response.end(
      "<title>Proxy tunnel accepted</title><h1>Local encrypted tunnel fixture</h1>",
    );
  },
);
await new Promise((resolve) => origin.listen(0, "127.0.0.1", resolve));
await new Promise((resolve) => secure.listen(0, "127.0.0.1", resolve));
const originPort = origin.address().port,
  securePort = secure.address().port;
const authorization =
  "Basic " + Buffer.from("proxy-user:" + secret).toString("base64");
const proxy = http.createServer((request, response) => {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return response.writeHead(400).end();
  }
  if (
    url.hostname !== "proxy-target.acira.test" ||
    Number(url.port) !== originPort
  )
    return response.writeHead(403).end();
  const accepted = request.headers["proxy-authorization"] === authorization;
  proxyTraffic.push({
    kind: "forward",
    path: url.pathname,
    accepted,
    proxyAuthorizationPresent: !!request.headers["proxy-authorization"],
  });
  if (!accepted) {
    response.writeHead(407, {
      "Proxy-Authenticate": 'Basic realm="Local proxy fixture"',
      "Content-Length": "0",
      Connection: "close",
    });
    return response.end();
  }
  const headers = { ...request.headers };
  delete headers["proxy-authorization"];
  delete headers["proxy-connection"];
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: originPort,
      path: url.pathname + url.search,
      method: request.method,
      headers,
    },
    (reply) => {
      response.writeHead(reply.statusCode, reply.headers);
      reply.pipe(response);
    },
  );
  upstream.on("error", () => response.destroy());
  request.pipe(upstream);
});
proxy.on("connect", (request, socket, head) => {
  let url;
  try {
    url = new URL("http://" + request.url);
  } catch {
    socket.destroy();
    return;
  }
  if (
    url.hostname !== "proxy-secure.acira.test" ||
    Number(url.port) !== securePort
  ) {
    socket.destroy();
    return;
  }
  const accepted = request.headers["proxy-authorization"] === authorization;
  proxyTraffic.push({
    kind: "connect",
    accepted,
    proxyAuthorizationPresent: !!request.headers["proxy-authorization"],
  });
  if (!accepted) {
    socket.end(
      'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Local proxy fixture"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
    );
    return;
  }
  const upstream = net.connect(securePort, "127.0.0.1", () => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  track(upstream);
  socket.on("error", () => upstream.destroy());
  upstream.on("error", () => socket.destroy());
});
for (const server of [origin, secure, proxy]) server.on("connection", track);
await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
const proxyPort = proxy.address().port;
const entry = path.join(out, "host.cjs");
await fs.writeFile(
  entry,
  `const {app,BrowserWindow}=require('electron');const {BrowserDatabase}=require(${JSON.stringify(path.join(root, "desktop/database.cjs"))});const {createProxySettings}=require(${JSON.stringify(path.join(root, "desktop/browser-services/proxy-settings.cjs"))});const {createProxyAuthGuard}=require(${JSON.stringify(path.join(root, "desktop/accounts/proxy-auth.cjs"))});const {X509Certificate}=require('node:crypto');const path=require('node:path');
app.setPath('userData',process.env.ACIRA_PROXY_AUTH_DATA);app.setName('Acira isolated proxy authentication');app.on('window-all-closed',()=>app.quit());
app.whenReady().then(async()=>{const database=new BrowserDatabase(path.join(app.getPath('userData'),'proxy.sqlite')),owners=new Map(),pending=new Map(),loads=new Map();let sequence=0,originChallenges=0;const service=createProxySettings({database,getContext:wc=>owners.get(wc.id),getWindow:ses=>[...owners.values()].find(o=>o.session===ses)?.window,dialog:{showMessageBox:async()=>({response:1})}});const guard=createProxyAuthGuard({status:ses=>service.status(ses),resolveOwner:wc=>owners.get(wc.id)});
function settle(item,credentials){if(!pending.delete(item.id))return false;try{credentials?item.callback(credentials.username,credentials.password):item.callback();}catch{}return true;}
function cancel(wc){for(const item of [...pending.values()])if(item.wc===wc)settle(item);}
async function make(id,privateMode=false){const window=new BrowserWindow({show:false,webPreferences:{partition:(privateMode?'':'persist:')+'proxy-auth-'+id,sandbox:true,contextIsolation:true,nodeIntegration:false}}),wc=window.webContents;owners.set(wc.id,{id,tabId:'tab-'+id,profileId:'profile-'+id,session:wc.session,privateMode,active:true,window});wc.session.setCertificateVerifyProc((details,callback)=>{let pinned=false;try{pinned=details.hostname==='proxy-secure.acira.test'&&new X509Certificate(details.certificate.data).fingerprint256===process.env.ACIRA_PROXY_FIXTURE_PIN;}catch{}callback(pinned?0:-3);});await service.attach(wc.session,'profile-'+id,privateMode);await wc.loadURL('about:blank');wc.on('destroyed',()=>cancel(wc));wc.on('did-start-navigation',event=>{if(!event.isSameDocument)cancel(wc);});return wc;}
app.on('login',(event,wc,details,authInfo,callback)=>{event.preventDefault();if(!authInfo.isProxy){originChallenges++;callback();return;}guard.validate(wc,details,authInfo).then(proof=>{if(!proof){callback();return;}const item={id:'proxy-'+(++sequence),wc,proof,callback,retry:details.firstAuthAttempt===false};pending.set(item.id,item);});});
const a=await make('a'),b=await make('b'),p=await make('private',true);global.proxyAuthFixture={database,service,guard,owners,a,b,p,loads,pending,originChallenges:()=>originChallenges,async set(key,choice){const wc=this[key];guard.invalidateSession(wc.session);for(const item of [...pending.values()])if(item.wc.session===wc.session)settle(item);return service.set(wc.session,choice);},start(key,url){const wc=this[key];loads.delete(key);void wc.loadURL(url).then(()=>loads.set(key,{loaded:true,title:wc.getTitle()}),()=>loads.set(key,{loaded:false}));},list(){return [...pending.values()].map(item=>({id:item.id,ownerId:item.proof.owner.id,privateMode:item.proof.owner.privateMode,retry:item.retry,display:item.proof.display}));},async answer(ownerId,id,credentials){const item=pending.get(id);if(!item||item.proof.owner.id!==ownerId)return false;if(!await guard.revalidate(item.proof)){settle(item);return false;}return settle(item,credentials);},async closePrivate(){const wc=this.p;guard.invalidateSession(wc.session);cancel(wc);await wc.session.clearAuthCache();service.release(wc.session);owners.delete(wc.id);this.oldPrivateSession=wc.session;this.ownersWindowClosed=true;BrowserWindow.fromWebContents(wc).destroy();}};
});`,
);
const selected = [
  "desktop/accounts/proxy-auth.cjs",
  "desktop/browser-services/proxy-settings.cjs",
];
const before = Object.fromEntries(
  await Promise.all(
    selected.map(async (file) => [
      file,
      createHash("sha256")
        .update(await fs.readFile(path.join(root, file)))
        .digest("hex"),
    ]),
  ),
);
let app;
const forward = (path) => "http://proxy-target.acira.test:" + originPort + path;
const tunnel = (path) => "https://proxy-secure.acira.test:" + securePort + path;
const start = (key, url) =>
  app.evaluate((_e, { key, url }) => global.proxyAuthFixture.start(key, url), {
    key,
    url,
  });
const challenge = (ownerId) =>
  poll(
    () => app.evaluate(() => global.proxyAuthFixture.list()),
    (list) => list.some((item) => item.ownerId === ownerId),
    "real local407 challenge",
  ).then((list) => list.find((item) => item.ownerId === ownerId));
const answer = (ownerId, request, credentials = null) =>
  app.evaluate(
    (_e, args) =>
      global.proxyAuthFixture.answer(args.ownerId, args.id, args.credentials),
    { ownerId, id: request.id, credentials },
  );
const load = (key) =>
  poll(
    () =>
      app.evaluate((_e, key) => global.proxyAuthFixture.loads.get(key), key),
    Boolean,
    "proxy fixture navigation settles",
  );
const reset = (key) =>
  app.evaluate(async (_e, key) => {
    const wc = global.proxyAuthFixture[key];
    await wc.session.clearAuthCache();
    await wc.session.closeAllConnections();
  }, key);
try {
  app = await _electron.launch({
    executablePath:
      process.env.ACIRA_TEST_EXECUTABLE ||
      path.join(root, "node_modules/electron/dist/electron.exe"),
    args: [entry],
    env: {
      ...process.env,
      ACIRA_PROXY_AUTH_DATA: data,
      ACIRA_PROXY_FIXTURE_PIN: fingerprint,
    },
  });
  await poll(
    () => app.evaluate(() => !!global.proxyAuthFixture),
    Boolean,
    "native proxy route fixture",
  );
  const actual = await app.evaluate(({ app }) => ({
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    loginListeners: app.listenerCount("login"),
  }));
  assert.equal(actual.electron, "44.9.3");
  assert.equal(actual.loginListeners, 1);
  const choice = {
    mode: "fixed_servers",
    server: { scheme: "http", host: "127.0.0.1", port: proxyPort },
    bypassHosts: [],
  };
  for (const key of ["a", "b", "p"])
    await app.evaluate(
      (_e, { key, choice }) => global.proxyAuthFixture.set(key, choice),
      { key, choice },
    );
  await start("a", forward("/first"));
  const first = await challenge("a");
  assert.equal(first.display.origin, "http://127.0.0.1:" + proxyPort);
  assert.equal(first.display.kind, "proxy");
  await answer("a", first, { username: "wrong", password: "wrong" });
  const retry = await challenge("a");
  assert.equal(retry.retry, true);
  await answer("a", retry, { username: "proxy-user", password: secret });
  assert.equal((await load("a")).title, "Proxy forward accepted");
  checks.push(
    "real applied HTTP forward proxy407 has explicit endpoint, wrong-password retry and correct native callback success",
  );
  await reset("a");
  await start("a", tunnel("/encrypted"));
  const connect = await challenge("a");
  await answer("a", connect, { username: "wrong", password: "wrong" });
  const connectRetry = await challenge("a");
  assert.equal(connectRetry.retry, true);
  await answer("a", connectRetry, { username: "proxy-user", password: secret });
  assert.equal((await load("a")).title, "Proxy tunnel accepted");
  checks.push(
    "real authenticated CONNECT tunnel carries HTTPS to an exactly pinned disposable TLS certificate without changing product or OS trust",
  );
  await reset("a");
  await start("a", forward("/cancel"));
  const cancel = await challenge("a");
  await answer("a", cancel);
  assert.notEqual((await load("a")).title, "Proxy forward accepted");
  assert.equal(
    originTraffic.some((item) => item.path === "/cancel"),
    false,
  );
  assert.equal(
    await answer("a", cancel, { username: "proxy-user", password: secret }),
    false,
  );
  await reset("a");
  const originsBeforeCancel = originTraffic.length;
  await start("a", tunnel("/cancel-connect"));
  const cancelConnect = await challenge("a");
  await answer("a", cancelConnect);
  await load("a");
  assert.equal(originTraffic.length, originsBeforeCancel);
  checks.push(
    "proxy Cancel consumes the real callback and stale credential submission is rejected",
  );
  await start("b", forward("/profile-b"));
  await start("p", forward("/private"));
  const br = await challenge("b"),
    pr = await challenge("private");
  assert.equal(pr.privateMode, true);
  assert.equal(br.privateMode, false);
  assert.equal(
    await answer("b", pr, { username: "proxy-user", password: secret }),
    false,
  );
  await answer("b", br, { username: "proxy-user", password: secret });
  assert.equal((await load("b")).loaded, true);
  assert.equal(
    (await app.evaluate(() => global.proxyAuthFixture.list())).some(
      (item) => item.ownerId === "private",
    ),
    true,
  );
  await answer("private", pr, { username: "proxy-user", password: secret });
  assert.equal((await load("p")).loaded, true);
  checks.push(
    "simultaneous ordinary/private proxy challenges have independent native sessions and owner-bound responses",
  );
  await start("b", forward("/origin-auth"));
  await load("b");
  assert.ok(
    (await app.evaluate(() => global.proxyAuthFixture.originChallenges())) > 0,
  );
  assert.equal(
    originTraffic.some(
      (item) => item.authorizationPresent || item.proxyAuthorizationPresent,
    ),
    false,
  );
  checks.push(
    "proxy credentials never become origin Authorization or enter the tunneled origin; real origin401 is cancelled separately",
  );
  await reset("b");
  await start("b", forward("/stale-route"));
  const stale = await challenge("b");
  await app.evaluate(() =>
    global.proxyAuthFixture.set("b", { mode: "direct" }),
  );
  assert.equal(
    await answer("b", stale, { username: "proxy-user", password: secret }),
    false,
  );
  checks.push(
    "a native applied-route change expires a pending proxy proof and callback before credentials can be sent",
  );
  await app.evaluate(() => global.proxyAuthFixture.closePrivate());
  const acceptedBefore = proxyTraffic.filter((item) => item.accepted).length;
  await app.evaluate(async ({ BrowserWindow }, url) => {
    const probe = new BrowserWindow({
      show: false,
      webPreferences: {
        session: global.proxyAuthFixture.oldPrivateSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    try {
      await probe.loadURL(url).catch(() => {});
    } finally {
      probe.destroy();
    }
  }, forward("/old-private"));
  assert.equal(
    proxyTraffic.filter((item) => item.accepted).length,
    acceptedBefore,
  );
  checks.push(
    "private owner cleanup clears native proxy auth cache; its old unowned session cannot reuse credentials",
  );
  assert.equal(
    JSON.stringify(
      await app.evaluate(() => global.proxyAuthFixture.list()),
    ).includes(secret),
    false,
  );
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((window) => window.isVisible()),
    ),
    false,
  );
  await app.close();
  app = null;
  let scannedFiles = 0;
  async function scan(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      assert.equal(entry.isSymbolicLink(), false);
      if (entry.isDirectory()) await scan(file);
      else {
        const bytes = await fs.readFile(file);
        scannedFiles++;
        assert.equal(bytes.includes(Buffer.from(secret)), false);
        assert.equal(bytes.includes(Buffer.from(secret, "utf16le")), false);
      }
    }
  }
  await scan(data);
  checks.push(
    "native metadata and post-shutdown fixture files contain no submitted proxy password",
  );
  const after = Object.fromEntries(
    await Promise.all(
      selected.map(async (file) => [
        file,
        createHash("sha256")
          .update(await fs.readFile(path.join(root, file)))
          .digest("hex"),
      ]),
    ),
  );
  assert.deepEqual(after, before);
  const result = {
    status: "PASS",
    checks,
    actual,
    proxyTraffic,
    originTraffic,
    scannedFiles,
    selectedSources: before,
    selectedSourcesStable: true,
    productIntegration: false,
    singleQaLoginDispatcher: true,
    credentialsLogged: false,
    visibleWindows: false,
    tlsFixture:
      "exact hostname+certificate SHA256 pin in only disposable sessions; no OS/product trust change",
    limitations: [
      "Standalone actual native routing-service/guard qualification; single product dispatcher, real trusted proxy dialog and package integration remain open",
      "Fixed HTTP Basic proxy only; system/PAC/SOCKS credentials, Digest and real provider proxy unqualified",
    ],
  };
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ checks, artifacts: out }, null, 2));
} catch (error) {
  await fs.writeFile(
    path.join(out, "partial.json"),
    JSON.stringify(
      { checks, proxyTraffic, originTraffic, failure: error.message },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await app?.close().catch(() => {});
  for (const socket of sockets) socket.destroy();
  for (const server of [proxy, origin, secure]) server.closeAllConnections();
  await Promise.all(
    [proxy, origin, secure].map(
      (server) => new Promise((resolve) => server.close(resolve)),
    ),
  );
}
