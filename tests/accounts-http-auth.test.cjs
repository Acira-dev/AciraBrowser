"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createWebsiteAuth } = require("../desktop/website-auth.cjs");
function fixture(options = {}) {
  const app = new EventEmitter(),
    owners = new Map(),
    notices = [];
  const broker = createWebsiteAuth({
    app,
    resolveOwner: (wc) => owners.get(wc),
    publish: (id, state) => notices.push({ id, state }),
    ...options,
  });
  const make = (id = "a", privateMode = false) => {
    const wc = new EventEmitter();
    wc.id = id;
    wc.dead = false;
    wc.isDestroyed = () => wc.dead;
    wc.session = {
      cleared: 0,
      async clearAuthCache() {
        this.cleared++;
      },
    };
    owners.set(wc, {
      id,
      profileId: "profile-" + id,
      tabId: "tab-" + id,
      privateMode,
      session: wc.session,
      active: true,
    });
    return wc;
  };
  const login = (wc, info = {}, details = {}) => {
    const calls = [],
      event = {
        prevented: false,
        preventDefault() {
          this.prevented = true;
        },
      };
    app.emit(
      "login",
      event,
      wc,
      {
        url: "http://example.test:8080/protected?not-exported=token",
        firstAuthAttempt: true,
        ...details,
      },
      {
        isProxy: false,
        scheme: "basic",
        host: "example.test",
        port: 8080,
        realm: "Fixture",
        ...info,
      },
      (...args) => calls.push(args),
    );
    return {
      calls,
      event,
      request: wc && broker.snapshot(owners.get(wc)?.id).requests.at(-1),
    };
  };
  return { app, owners, notices, broker, make, login };
}
test("real callback input is at most once and snapshots expose no credentials or URL query", (t) => {
  const f = fixture();
  t.after(() => f.broker.dispose());
  const wc = f.make(),
    result = f.login(wc);
  assert.equal(result.event.prevented, true);
  const response = {
    id: result.request.id,
    action: "submit",
    username: "fixture-user",
    password: "fixture-secret",
  };
  assert.deepEqual(f.broker.respond("a", response), { ok: true });
  assert.deepEqual(result.calls, [["fixture-user", "fixture-secret"]]);
  assert.equal(f.broker.respond("a", response).code, "STALE_REQUEST");
  assert.equal(result.calls.length, 1);
  assert.doesNotMatch(
    JSON.stringify(f.notices),
    /fixture-secret|fixture-user|not-exported|token/,
  );
  assert.equal(wc.listenerCount("destroyed"), 0);
});
test("cancel consumes exactly once and other controller cannot answer", (t) => {
  const f = fixture();
  t.after(() => f.broker.dispose());
  const r = f.login(f.make());
  assert.equal(
    f.broker.respond("other", { id: r.request.id, action: "cancel" }).ok,
    false,
  );
  assert.equal(r.calls.length, 0);
  assert.equal(
    f.broker.respond("a", { id: r.request.id, action: "cancel" }).ok,
    true,
  );
  assert.deepEqual(r.calls, [[]]);
});
test("origin and proxy authentication never share callback handling", (t) => {
  const f = fixture();
  t.after(() => f.broker.dispose());
  const r = f.login(null, { isProxy: true });
  assert.equal(r.event.prevented, false);
  assert.equal(r.calls.length, 0);
  const other = f.login(f.make(), { isProxy: true });
  assert.equal(other.event.prevented, false);
  assert.equal(f.broker.snapshot("a").requests.length, 0);
});
test("unknown ownership, host/port mismatch and unsupported schemes cancel without prompting", (t) => {
  const f = fixture();
  t.after(() => f.broker.dispose());
  for (const info of [
    { host: "other.test" },
    { port: 443 },
    { scheme: "digest" },
  ]) {
    const r = f.login(f.make(), info);
    assert.deepEqual(r.calls, [[]]);
    assert.equal(r.request, undefined);
  }
  const r = f.login(null);
  assert.deepEqual(r.calls, [[]]);
});
test("simultaneous ordinary and private challenges remain independent", async (t) => {
  const f = fixture();
  t.after(() => f.broker.dispose());
  const a = f.make(),
    b = f.make("b", true),
    ar = f.login(a),
    br = f.login(b);
  assert.notEqual(ar.request.id, br.request.id);
  assert.equal(f.broker.snapshot("a").requests[0].privateMode, false);
  assert.equal(f.broker.snapshot("b").requests[0].privateMode, true);
  await f.broker.cancelOwner("b");
  assert.deepEqual(br.calls, [[]]);
  assert.equal(ar.calls.length, 0);
  assert.equal(b.session.cleared, 1);
  assert.equal(a.session.cleared, 0);
});
test("full navigation, destruction and renderer loss cancel outstanding callbacks", (t) => {
  const f = fixture();
  t.after(() => f.broker.dispose());
  for (const event of [
    "did-start-navigation",
    "destroyed",
    "render-process-gone",
  ]) {
    const wc = f.make(event),
      r = f.login(wc);
    wc.emit(event, { isSameDocument: false });
    assert.deepEqual(r.calls, [[]]);
    assert.equal(f.broker.snapshot(event).requests.length, 0);
  }
});
test("same-document navigation keeps the exact pending challenge", (t) => {
  const f = fixture();
  t.after(() => f.broker.dispose());
  const wc = f.make(),
    r = f.login(wc);
  wc.emit("did-start-navigation", { isSameDocument: true });
  assert.equal(r.calls.length, 0);
});
test("profile/tab/session/active ownership drift rejects credentials and cancels", (t) => {
  const f = fixture();
  t.after(() => f.broker.dispose());
  for (const patch of [
    { profileId: "changed" },
    { tabId: "changed" },
    { session: {} },
    { active: false },
  ]) {
    const wc = f.make(),
      r = f.login(wc);
    Object.assign(f.owners.get(wc), patch);
    assert.equal(
      f.broker.respond("a", {
        id: r.request.id,
        action: "submit",
        username: "user",
        password: "secret",
      }).code,
      "STALE_REQUEST",
    );
    assert.deepEqual(r.calls, [[]]);
  }
});
test("explicit state reconcile cancels a newly inactive tab", (t) => {
  const f = fixture();
  t.after(() => f.broker.dispose());
  const wc = f.make(),
    r = f.login(wc);
  f.owners.get(wc).active = false;
  f.broker.reconcile();
  assert.deepEqual(r.calls, [[]]);
});
test("invalid secret input and extra fields never reach native callback", (t) => {
  const f = fixture();
  t.after(() => f.broker.dispose());
  const r = f.login(f.make());
  for (const input of [
    { username: "u:other", password: "p" },
    { username: "u", password: "p\n" },
    { username: "u", password: "p", remember: true },
    { username: "u", password: "x".repeat(4097) },
  ])
    assert.equal(
      f.broker.respond("a", { id: r.request.id, action: "submit", ...input })
        .code,
      "INVALID_REQUEST",
    );
  assert.equal(r.calls.length, 0);
});
test("wrong-credential retry is a new explicit request without auto-submission", (t) => {
  const f = fixture();
  t.after(() => f.broker.dispose());
  const wc = f.make(),
    first = f.login(wc);
  f.broker.respond("a", {
    id: first.request.id,
    action: "submit",
    username: "wrong",
    password: "wrong",
  });
  const retry = f.login(wc, {}, { firstAuthAttempt: false });
  assert.equal(retry.request.retry, true);
  assert.notEqual(retry.request.id, first.request.id);
  assert.equal(retry.calls.length, 0);
});
test("pending requests time out without credentials", async (t) => {
  const f = fixture({ timeoutMs: 15 });
  t.after(() => f.broker.dispose());
  const r = f.login(f.make());
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(r.calls, [[]]);
});
test("private closure clears native HTTP-auth cache after successful submission", async (t) => {
  const f = fixture();
  t.after(() => f.broker.dispose());
  const wc = f.make("private", true),
    r = f.login(wc);
  f.broker.respond("private", {
    id: r.request.id,
    action: "submit",
    username: "u",
    password: "p",
  });
  assert.equal(await f.broker.cancelOwner("private"), true);
  assert.equal(wc.session.cleared, 1);
});
test("bounded queues cancel excess prompts without accumulating native listeners", (t) => {
  const f = fixture();
  t.after(() => f.broker.dispose());
  const wc = f.make();
  for (let i = 0; i < 4; i++) f.login(wc);
  const excess = f.login(wc);
  assert.deepEqual(excess.calls, [[]]);
  assert.equal(f.broker.snapshot("a").requests.length, 4);
  assert.equal(wc.listenerCount("destroyed"), 1);
});
test("quit disposes listeners and resolves pending callbacks once", () => {
  const f = fixture(),
    r = f.login(f.make());
  f.app.emit("quit");
  f.broker.dispose();
  assert.deepEqual(r.calls, [[]]);
  assert.equal(f.app.listenerCount("login"), 0);
});
