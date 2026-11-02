"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { EventEmitter } = require("node:events");
const { createWebsiteAuth } = require("../desktop/website-auth.cjs");
function fixture(options = {}) {
  const app = new EventEmitter(),
    owners = new Map(),
    published = [],
    calls = [];
  const guard = {
    validate: async () => ({
      display: {
        origin: "http://proxy.test:8080",
        destinationOrigin: "https://origin.test",
        host: "proxy.test",
        port: 8080,
      },
      privateData: "never-published",
    }),
    isCurrent: () => true,
    revalidate: async () => true,
    invalidateSession: () => calls.push("invalidated"),
  };
  Object.assign(guard, options.guard);
  const broker = createWebsiteAuth({
    app,
    resolveOwner: (wc) => owners.get(wc),
    publish: (id, state) => published.push({ id, state }),
    proxyGuard: guard,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  function make(id = "a", privateMode = false) {
    const wc = new EventEmitter();
    wc.dead = false;
    wc.isDestroyed = () => wc.dead;
    wc.session = {
      clears: 0,
      async clearAuthCache() {
        this.clears++;
      },
    };
    owners.set(wc, {
      id,
      profileId: "profile-" + id,
      tabId: "tab-" + id,
      session: wc.session,
      privateMode,
      active: true,
    });
    return wc;
  }
  function login(wc, proxy = true) {
    const answers = [],
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
        url: "https://origin.test/private?secret-query=1",
        firstAuthAttempt: true,
      },
      {
        isProxy: proxy,
        scheme: "basic",
        host: proxy ? "proxy.test" : "origin.test",
        port: proxy ? 8080 : 443,
        realm: "Native realm",
      },
      (...args) => answers.push(args),
    );
    return { answers, event };
  }
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return { app, owners, published, calls, guard, broker, make, login, flush };
}
test("one dispatcher prevents accidental duplicate registration and can be disposed", () => {
  const f = fixture();
  assert.equal(f.app.listenerCount("login"), 1);
  assert.throws(() =>
    createWebsiteAuth({ app: f.app, resolveOwner: () => null }),
  );
  f.broker.dispose();
  const next = createWebsiteAuth({ app: f.app, resolveOwner: () => null });
  next.dispose();
});

test("a cancelled before-quit leaves pending authentication and its listener usable", (t) => {
  const f = fixture();
  t.after(() => f.broker.dispose());
  const result = f.login(f.make(), false);
  const id = f.broker.snapshot("a").requests[0].id;
  f.app.emit("before-quit", { preventDefault() {} });
  assert.equal(f.app.listenerCount("login"), 1);
  assert.equal(
    f.broker.respond("a", {
      id,
      action: "submit",
      username: "user",
      password: "fixture-secret",
    }).ok,
    true,
  );
  assert.deepEqual(result.answers, [["user", "fixture-secret"]]);
});
test("async proxy validation owns lifetime before publishing safe proxy identity", async (t) => {
  let release;
  const f = fixture({
    guard: { validate: () => new Promise((resolve) => (release = resolve)) },
  });
  t.after(() => f.broker.dispose());
  const wc = f.make(),
    result = f.login(wc);
  assert.equal(result.event.prevented, true);
  assert.equal(f.broker.snapshot("a").requests.length, 0);
  await f.flush();
  release({
    display: {
      origin: "http://proxy.test:8080",
      destinationOrigin: "https://origin.test",
      host: "proxy.test",
      port: 8080,
    },
    privateData: "never-published",
  });
  await f.flush();
  const request = f.broker.snapshot("a").requests[0];
  assert.equal(request.kind, "proxy");
  assert.equal(request.destinationOrigin, "https://origin.test");
  assert.equal(result.answers.length, 0);
  assert.doesNotMatch(
    JSON.stringify(f.published),
    /never-published|secret-query/,
  );
});
test("proxy submit awaits fresh route proof and rejects a duplicate in flight", async (t) => {
  let release;
  const f = fixture({
    guard: { revalidate: () => new Promise((resolve) => (release = resolve)) },
  });
  t.after(() => f.broker.dispose());
  const result = f.login(f.make());
  await f.flush();
  const id = f.broker.snapshot("a").requests[0].id;
  const reply = f.broker.respond("a", {
    id,
    action: "submit",
    username: "proxy-user",
    password: "proxy-secret",
  });
  assert.equal(result.answers.length, 0);
  assert.equal(
    f.broker.respond("a", {
      id,
      action: "submit",
      username: "other",
      password: "other",
    }).code,
    "REQUEST_PENDING",
  );
  release(true);
  assert.equal((await reply).ok, true);
  assert.deepEqual(result.answers, [["proxy-user", "proxy-secret"]]);
});
test("Cancel during route revalidation settles once and discards late credentials", async (t) => {
  let release;
  const f = fixture({
    guard: { revalidate: () => new Promise((resolve) => (release = resolve)) },
  });
  t.after(() => f.broker.dispose());
  const result = f.login(f.make());
  await f.flush();
  const id = f.broker.snapshot("a").requests[0].id;
  const reply = f.broker.respond("a", {
    id,
    action: "submit",
    username: "u",
    password: "secret",
  });
  assert.equal(f.broker.respond("a", { id, action: "cancel" }).ok, true);
  release(true);
  assert.equal((await reply).ok, false);
  assert.deepEqual(result.answers, [[]]);
});
test("navigation during initial route lookup cancels before any late publication", async (t) => {
  let release;
  const f = fixture({
    guard: { validate: () => new Promise((resolve) => (release = resolve)) },
  });
  t.after(() => f.broker.dispose());
  const wc = f.make(),
    result = f.login(wc);
  await f.flush();
  wc.emit("did-start-navigation", { isSameDocument: false });
  release({ display: {} });
  await f.flush();
  assert.deepEqual(result.answers, [[]]);
  assert.equal(f.broker.snapshot("a").requests.length, 0);
});
test("rejected or unsupported proxy proof cancels without a prompt", async (t) => {
  for (const validate of [
    async () => null,
    async () => {
      throw Error();
    },
  ]) {
    const f = fixture({ guard: { validate } });
    t.after(() => f.broker.dispose());
    const result = f.login(f.make());
    await f.flush();
    assert.deepEqual(result.answers, [[]]);
    assert.equal(f.broker.snapshot("a").requests.length, 0);
  }
});
test("fresh route failure never reaches callback with credentials", async (t) => {
  const f = fixture({ guard: { revalidate: async () => false } });
  t.after(() => f.broker.dispose());
  const result = f.login(f.make());
  await f.flush();
  const id = f.broker.snapshot("a").requests[0].id;
  assert.equal(
    (
      await f.broker.respond("a", {
        id,
        action: "submit",
        username: "u",
        password: "secret",
      })
    ).ok,
    false,
  );
  assert.deepEqual(result.answers, [[]]);
});
test("session route cancellation expires origin and proxy while preserving another owner session", async (t) => {
  const f = fixture();
  t.after(() => f.broker.dispose());
  const wc = f.make(),
    other = f.make("b"),
    proxy = f.login(wc),
    origin = f.login(wc, false),
    separate = f.login(other);
  await f.flush();
  await f.broker.cancelSession(wc.session);
  assert.deepEqual(proxy.answers, [[]]);
  assert.deepEqual(origin.answers, [[]]);
  assert.equal(separate.answers.length, 0);
  assert.equal(wc.session.clears, 1);
  assert.ok(f.calls.includes("invalidated"));
});
test("private owner cleanup during route lookup clears cache and blocks late request", async (t) => {
  let release;
  const f = fixture({
    guard: { validate: () => new Promise((resolve) => (release = resolve)) },
  });
  t.after(() => f.broker.dispose());
  const wc = f.make("p", true),
    result = f.login(wc);
  await f.flush();
  await f.broker.cancelOwner("p");
  release({ display: {} });
  await f.flush();
  assert.deepEqual(result.answers, [[]]);
  assert.equal(wc.session.clears, 1);
  assert.equal(f.broker.snapshot("p").requests.length, 0);
});
test("timeout covers asynchronous route lookup itself", async (t) => {
  let release;
  const f = fixture({
    timeoutMs: 10,
    guard: { validate: () => new Promise((resolve) => (release = resolve)) },
  });
  t.after(() => f.broker.dispose());
  const result = f.login(f.make());
  await f.flush();
  await new Promise((resolve) => setTimeout(resolve, 20));
  release({ display: {} });
  await f.flush();
  assert.deepEqual(result.answers, [[]]);
});
test("origin and proxy metadata/response tokens remain independent in one dispatcher", async (t) => {
  const f = fixture();
  t.after(() => f.broker.dispose());
  const wc = f.make(),
    origin = f.login(wc, false),
    proxy = f.login(wc);
  await f.flush();
  const list = f.broker.snapshot("a").requests,
    a = list.find((item) => item.kind === "origin"),
    b = list.find((item) => item.kind === "proxy");
  assert.notEqual(a.id, b.id);
  assert.equal(
    f.broker.respond("a", {
      id: a.id,
      action: "submit",
      username: "origin-user",
      password: "origin-secret",
    }).ok,
    true,
  );
  assert.equal(
    (
      await f.broker.respond("a", {
        id: b.id,
        action: "submit",
        username: "proxy-user",
        password: "proxy-secret",
      })
    ).ok,
    true,
  );
  assert.deepEqual(origin.answers, [["origin-user", "origin-secret"]]);
  assert.deepEqual(proxy.answers, [["proxy-user", "proxy-secret"]]);
  assert.doesNotMatch(
    JSON.stringify(f.published),
    /origin-secret|proxy-secret/,
  );
});
test("owner changes during final proxy revalidation still reject callback input", async (t) => {
  let release;
  const f = fixture({
    guard: { revalidate: () => new Promise((resolve) => (release = resolve)) },
  });
  t.after(() => f.broker.dispose());
  const wc = f.make(),
    result = f.login(wc);
  await f.flush();
  const id = f.broker.snapshot("a").requests[0].id,
    reply = f.broker.respond("a", {
      id,
      action: "submit",
      username: "u",
      password: "secret",
    });
  f.owners.get(wc).tabId = "other";
  release(true);
  assert.equal((await reply).ok, false);
  assert.deepEqual(result.answers, [[]]);
});
