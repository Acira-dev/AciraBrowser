"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { createProxyAuthGuard } = require("../desktop/accounts/proxy-auth.cjs");
function fixture() {
  const session = {},
    wc = {
      session,
      dead: false,
      isDestroyed() {
        return this.dead;
      },
    };
  const owner = {
    id: "window-a",
    profileId: "profile-a",
    tabId: "tab-a",
    session,
    active: true,
    privateMode: false,
  };
  const routing = {
    profileId: "profile-a",
    private: false,
    applied: true,
    busy: false,
    error: null,
    choice: {
      mode: "fixed_servers",
      server: { scheme: "http", host: "proxy.test", port: 8080 },
      bypassHosts: [],
    },
  };
  let route = "PROXY proxy.test:8080",
    gate;
  const guard = createProxyAuthGuard({
    status: () => routing,
    resolveOwner: () => owner,
    resolveRoute: async () => {
      if (gate) await gate;
      return route;
    },
  });
  const details = {
      url: "https://origin.test/private?not-displayed=token",
      firstAuthAttempt: true,
    },
    info = {
      isProxy: true,
      scheme: "basic",
      host: "proxy.test",
      port: 8080,
      realm: "Proxy fixture",
    };
  return {
    guard,
    wc,
    owner,
    routing,
    details,
    info,
    route: (value) => (route = value),
    gate: (value) => (gate = value),
  };
}
test("fixed HTTP proxy proof binds actual route and owner; display is separate from origin URL", async () => {
  const f = fixture(),
    proof = await f.guard.validate(f.wc, f.details, f.info);
  assert.ok(proof);
  assert.equal(proof.session, f.wc.session);
  assert.equal(proof.display.kind, "proxy");
  assert.equal(proof.display.origin, "http://proxy.test:8080");
  assert.equal(proof.display.destinationOrigin, "https://origin.test");
  assert.doesNotMatch(JSON.stringify(proof.display), /private|token/);
  assert.equal(await f.guard.revalidate(proof), true);
});
test("origin challenges never enter proxy validation", async () => {
  const f = fixture();
  assert.equal(
    await f.guard.validate(f.wc, f.details, { ...f.info, isProxy: false }),
    null,
  );
});

test("incomplete native profile/window/tab/private ownership is unsupported", async () => {
  for (const key of ["id", "profileId", "tabId", "privateMode"]) {
    const f = fixture();
    delete f.owner[key];
    assert.equal(await f.guard.validate(f.wc, f.details, f.info), null);
  }
});
test("unknown/main-process webContents and inactive owner are denied", async () => {
  const f = fixture();
  assert.equal(await f.guard.validate(null, f.details, f.info), null);
  f.owner.active = false;
  assert.equal(await f.guard.validate(f.wc, f.details, f.info), null);
});
test("proxy scheme/host/port mismatch and unsupported auth method are denied", async () => {
  for (const patch of [
    { host: "origin.test" },
    { port: 8081 },
    { scheme: "digest" },
  ]) {
    const f = fixture();
    assert.equal(
      await f.guard.validate(f.wc, f.details, { ...f.info, ...patch }),
      null,
    );
  }
});
test("only applied nonbusy error-free fixed HTTP routing is qualified", async () => {
  for (const patch of [
    { applied: false },
    { busy: true },
    { error: "unconfirmed" },
    { choice: { mode: "system" } },
    { choice: { mode: "direct" } },
    {
      choice: {
        mode: "fixed_servers",
        server: { scheme: "socks5", host: "proxy.test", port: 8080 },
      },
    },
  ]) {
    const f = fixture();
    Object.assign(f.routing, patch);
    assert.equal(await f.guard.validate(f.wc, f.details, f.info), null);
  }
});
test("actual resolved route cannot silently differ or fall back", async () => {
  for (const route of [
    "DIRECT",
    "PROXY other.test:8080",
    "PROXY proxy.test:8081",
    "PROXY proxy.test:8080; DIRECT",
    "SOCKS5 proxy.test:8080",
    "PROXY user:secret@proxy.test:8080",
  ]) {
    const f = fixture();
    f.route(route);
    assert.equal(await f.guard.validate(f.wc, f.details, f.info), null);
  }
});
test("route/profile/private/session/tab changes invalidate the pending proof", async () => {
  for (const mutate of [
    (f) => (f.owner.profileId = "other"),
    (f) => (f.owner.privateMode = true),
    (f) => (f.owner.session = {}),
    (f) => (f.owner.tabId = "other"),
    (f) => f.routing.choice.bypassHosts.push("origin.test"),
    (f) => (f.wc.dead = true),
  ]) {
    const f = fixture(),
      proof = await f.guard.validate(f.wc, f.details, f.info);
    mutate(f);
    assert.equal(f.guard.isCurrent(proof), false);
    assert.equal(await f.guard.revalidate(proof), false);
  }
});
test("explicit route epoch rejects change-away-and-back", async () => {
  const f = fixture(),
    proof = await f.guard.validate(f.wc, f.details, f.info);
  f.guard.invalidateSession(f.wc.session);
  assert.equal(f.guard.isCurrent(proof), false);
  assert.equal(await f.guard.revalidate(proof), false);
});
test("owner or route drift during asynchronous native resolve is rejected", async () => {
  const f = fixture();
  let release;
  f.gate(new Promise((resolve) => (release = resolve)));
  const result = f.guard.validate(f.wc, f.details, f.info);
  f.owner.tabId = "changed";
  release();
  assert.equal(await result, null);
});
test("private and ordinary native sessions cannot share a ticket", async () => {
  const f = fixture(),
    proof = await f.guard.validate(f.wc, f.details, f.info);
  f.wc.session = {};
  assert.equal(await f.guard.revalidate(proof), false);
});
test("IPv6 endpoint comparison removes brackets and lowercases only", async () => {
  const f = fixture();
  f.routing.choice.server.host = "[::1]";
  f.info.host = "::1";
  f.route("PROXY [::1]:8080");
  assert.equal(
    (await f.guard.validate(f.wc, f.details, f.info)).display.origin,
    "http://[::1]:8080",
  );
});
test("origin userinfo and non-HTTP destinations never become proxy credentials", async () => {
  const f = fixture();
  for (const url of [
    "https://u:p@origin.test/",
    "file:///local",
    "data:text/html,fixture",
  ])
    assert.equal(await f.guard.validate(f.wc, { url }, f.info), null);
});
