"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { EventEmitter } = require("node:events");
const {
  parseExternalURLs,
  createExternalLinkIntake,
} = require("../desktop/accounts/external-links.cjs");
test("external argv accepts only bounded HTTP(S), preserves query/fragment and does not search flags or file paths", () => {
  assert.deepEqual(
    parseExternalURLs([
      "AciraBrowser.exe",
      "main.cjs",
      "--profile=other",
      "https://example.com/a?state=keep#section",
      "http://127.0.0.1:8080/a",
      "https://example.com/a?state=keep#section",
      "javascript:alert(1)",
      "file:///secret",
      "acira://settings",
      "--url=https://bad.test",
      "https://user:secret@bad.test",
      "https://bad.test/\nvalue",
      "https://bad.test/" + "x".repeat(8200),
    ]),
    ["https://example.com/a?state=keep#section", "http://127.0.0.1:8080/a"],
  );
  assert.deepEqual(parseExternalURLs(null), []);
});
test("cold argv and synchronous Mac open-url events wait for restored normal-profile readiness", async () => {
  const app = new EventEmitter(),
    opened = [];
  const intake = createExternalLinkIntake({
    app,
    argv: ["https://cold.test/path"],
  });
  let prevented = false;
  app.emit(
    "open-url",
    {
      preventDefault() {
        prevented = true;
      },
    },
    "https://mac.test/path",
  );
  assert.equal(prevented, true);
  assert.equal(intake.pending, 2);
  assert.deepEqual(opened, []);
  await intake.bind(async (url) => {
    opened.push(url);
  });
  assert.deepEqual(opened, ["https://cold.test/path", "https://mac.test/path"]);
  intake.dispose();
});
test("running-instance web links are delivered serially; plain activation stays separate", async () => {
  const app = new EventEmitter(),
    opened = [];
  let activated = 0,
    simultaneous = 0,
    maximum = 0;
  const intake = createExternalLinkIntake({
    app,
    argv: [],
    onActivate: () => activated++,
  });
  await intake.bind(async (url) => {
    simultaneous++;
    maximum = Math.max(maximum, simultaneous);
    await Promise.resolve();
    opened.push(url);
    simultaneous--;
  });
  app.emit("second-instance", {}, ["AciraBrowser.exe", "https://one.test"]);
  app.emit("second-instance", {}, ["AciraBrowser.exe", "https://two.test"]);
  app.emit("second-instance", {}, ["AciraBrowser.exe"]);
  await intake.flush();
  assert.deepEqual(opened, ["https://one.test/", "https://two.test/"]);
  assert.equal(maximum, 1);
  assert.equal(activated, 1);
  intake.dispose();
});
test("queue overflow and one failed delivery are bounded and never log sensitive URLs", async () => {
  const app = new EventEmitter(),
    errors = [],
    opened = [];
  const intake = createExternalLinkIntake({
    app,
    argv: [],
    maxQueued: 2,
    onError: (message) => errors.push(message),
  });
  intake.enqueue([
    "https://one.test/?secret=private",
    "https://two.test/",
    "https://overflow.test/",
  ]);
  assert.equal(intake.pending, 2);
  await intake.bind(async (url) => {
    if (url.includes("one.test")) throw Error(url);
    opened.push(url);
  });
  assert.deepEqual(opened, ["https://two.test/"]);
  assert.equal(errors.length, 2);
  assert.doesNotMatch(JSON.stringify(errors), /private|secret|one\.test/);
  intake.dispose();
});
test("unsupported open-url events and disposed queues cannot trigger browsing", async () => {
  const app = new EventEmitter(),
    opened = [];
  let prevented = false;
  const intake = createExternalLinkIntake({ app, argv: [] });
  await intake.bind((url) => opened.push(url));
  app.emit(
    "open-url",
    {
      preventDefault() {
        prevented = true;
      },
    },
    "data:text/html,unsafe",
  );
  assert.equal(prevented, false);
  intake.dispose();
  app.emit("second-instance", {}, ["https://late.test/"]);
  assert.equal(intake.enqueue(["https://late.test/"]), 0);
  await intake.flush();
  assert.deepEqual(opened, []);
});

test("canonical URL expansion still obeys the8192character queue bound", () => {
  const raw = "https://example.test/" + "é".repeat(2000);
  assert.ok(raw.length < 8192);
  assert.ok(new URL(raw).href.length > 8192);
  assert.equal(parseExternalURLs([raw]).length, 0);
});

test("native restore prepends older events before cold input and preserves duplicate events", async () => {
  const app = new EventEmitter(),
    opened = [];
  const intake = createExternalLinkIntake({
    app,
    argv: ["https://new.test/cold"],
  });
  const old = "https://old.test/handoff?opaque=fixture#kept";
  let consumed = 0;
  assert.equal(
    intake.restorePending([old, old], () => consumed++),
    2,
  );
  assert.equal(consumed, 1);
  assert.equal(intake.pending, 3);
  await intake.bind((url) => opened.push(url));
  assert.deepEqual(opened, [old, old, "https://new.test/cold"]);
  intake.dispose();
});

test("failed restore validates all inputs before consumption/mutation and corrected retry adds once", async () => {
  const app = new EventEmitter(),
    errors = [],
    opened = [];
  const intake = createExternalLinkIntake({
    app,
    argv: ["https://new.test/"],
    onError: (message) => errors.push(message),
  });
  let consumed = 0;
  assert.throws(
    () =>
      intake.restorePending(
        ["https://old.test/", "https://user:secret@bad.test/"],
        () => consumed++,
      ),
    /^Error: Startup links could not be restored into the pending queue\.$/,
  );
  assert.equal(consumed, 0);
  assert.equal(intake.pending, 1);
  assert.equal(
    intake.restorePending(["https://old.test/"], () => consumed++),
    1,
  );
  assert.equal(consumed, 1);
  await intake.bind((url) => opened.push(url));
  assert.deepEqual(opened, ["https://old.test/", "https://new.test/"]);
  assert.doesNotMatch(
    JSON.stringify(errors),
    /old\.test|new\.test|secret|bad\.test/,
  );
  intake.dispose();
});

test("over-capacity restore fails before consumption and accepts a bounded retry", async () => {
  const app = new EventEmitter(),
    opened = [];
  const intake = createExternalLinkIntake({
    app,
    argv: ["https://current.test/"],
    maxQueued: 2,
  });
  let consumed = 0;
  assert.throws(() =>
    intake.restorePending(
      ["https://old.test/one", "https://old.test/two"],
      () => consumed++,
    ),
  );
  assert.equal(consumed, 0);
  assert.equal(intake.pending, 1);
  assert.equal(
    intake.restorePending(["https://old.test/one"], () => consumed++),
    1,
  );
  assert.equal(consumed, 1);
  await intake.bind((url) => opened.push(url));
  assert.deepEqual(opened, ["https://old.test/one", "https://current.test/"]);
  intake.dispose();
});

test("restore is rejected after binding or disposal without changing ordinary delivery", async () => {
  const app = new EventEmitter(),
    opened = [];
  const intake = createExternalLinkIntake({ app, argv: [] });
  await intake.bind((url) => opened.push(url));
  let consumed = 0;
  assert.throws(() =>
    intake.restorePending(["https://stale.test/"], () => consumed++),
  );
  assert.equal(intake.enqueue(["https://normal.test/"]), 1);
  await intake.flush();
  assert.deepEqual(opened, ["https://normal.test/"]);
  intake.dispose();
  assert.throws(() =>
    intake.restorePending(["https://closed.test/"], () => consumed++),
  );
  assert.equal(consumed, 0);
});

test("native consume callback failure retains the complete pending queue and permits one corrected retry", async () => {
  const app = new EventEmitter(),
    opened = [];
  const intake = createExternalLinkIntake({ app, argv: ["https://new.test/"] });
  let attempts = 0;
  const beforeCommit = () => {
    if (++attempts === 1)
      throw Error("fixture unlink failed with private query");
  };
  assert.throws(
    () => intake.restorePending(["https://old.test/"], beforeCommit),
    /^Error: Startup links could not be restored into the pending queue\.$/,
  );
  assert.equal(intake.pending, 1);
  assert.equal(intake.restorePending(["https://old.test/"], beforeCommit), 1);
  await intake.bind((url) => opened.push(url));
  assert.deepEqual(opened, ["https://old.test/", "https://new.test/"]);
  assert.equal(attempts, 2);
  intake.dispose();
});

test("restore rejects noncanonical or missing consumption boundaries before mutation", () => {
  const app = new EventEmitter();
  const intake = createExternalLinkIntake({ app, argv: [] });
  let consumed = 0;
  assert.throws(() =>
    intake.restorePending(["https://EXAMPLE.test"], () => consumed++),
  );
  assert.throws(() => intake.restorePending(["https://example.test/"]));
  assert.equal(consumed, 0);
  assert.equal(intake.pending, 0);
  intake.dispose();
});

test("installed web app launches are left to the app window, cold and second instance", async () => {
  const app = new EventEmitter(),
    opened = [];
  let activated = 0;
  const appLaunch = ["Acira.exe", "--acira-app=0123456789abcdef0123", "https://app.test/start"];
  const intake = createExternalLinkIntake({
    app,
    argv: appLaunch,
    onActivate: () => activated++,
    ignore: (args) => args.some((arg) => String(arg).startsWith("--acira-app=")),
  });
  assert.equal(intake.pending, 0);
  app.emit("second-instance", {}, appLaunch);
  assert.equal(intake.pending, 0);
  assert.equal(activated, 0);
  app.emit("second-instance", {}, ["Acira.exe", "https://link.test/"]);
  await intake.bind((url) => opened.push(url));
  assert.deepEqual(opened, ["https://link.test/"]);
  intake.dispose();
});
