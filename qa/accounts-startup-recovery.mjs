import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
const require = createRequire(import.meta.url),
  { createStartupGate } = require("../desktop/startup-gate.cjs"),
  {
    createExternalLinkIntake,
  } = require("../desktop/accounts/external-links.cjs"),
  out = path.resolve("qa/artifacts/accounts-startup-recovery-" + Date.now());
fs.mkdirSync(out, { recursive: true });
const selected = [
    "desktop/startup-gate.cjs",
    "desktop/accounts/external-links.cjs",
  ],
  hashes = () =>
    Object.fromEntries(
      selected.map((file) => [
        file,
        createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
      ]),
    ),
  before = hashes();
const codec = {
  encryptString: (value) =>
    Buffer.from("fake:" + Buffer.from(value).toString("base64")),
  decryptString: (bytes) => {
    if (!bytes.toString().startsWith("fake:"))
      throw Error("Invalid fixture codec");
    return Buffer.from(bytes.toString().slice(5), "base64").toString();
  },
};
const old = "https://older.invalid/fixture?opaque=kept#retained",
  newer = "https://newer.invalid/fixture?opaque=kept#retained",
  checks = [];
function fixture(
  name,
  {
    directory = path.join(out, name),
    urls = [],
    ready = false,
    fileSystem = fs,
  } = {},
) {
  fs.mkdirSync(directory, { recursive: true });
  const app = new EventEmitter();
  app.getPath = () => directory;
  const argv = ["electron", "main.cjs", ...urls],
    errors = [],
    links = createExternalLinkIntake({
      app,
      argv,
      onError: (message) => errors.push(message),
    }),
    gate = createStartupGate({
      app,
      argv,
      links,
      safeStorage: codec,
      fileSystem,
      bootstrapFactory: () => ({
        prepare: () => (ready ? { ready: true } : { relaunchRequired: true }),
        restart() {},
      }),
    });
  return {
    directory,
    file: path.join(directory, "startup-links.bin"),
    app,
    links,
    gate,
    errors,
  };
}
async function saved(name, urls = [old]) {
  const first = fixture(name);
  for (const url of urls) first.app.emit("second-instance", {}, [url]);
  assert.equal((await first.gate.prepare()).restarting, true);
  first.links.dispose();
  return first;
}
async function delivered(fixture) {
  const urls = [];
  await fixture.links.bind((url) => urls.push(url));
  fixture.links.dispose();
  return urls;
}
const report = {
  native: false,
  cipher: "Explicit fake codec; real source control flow only",
  checks,
};
try {
  {
    const first = await saved("order", [old, old]),
      bytes = fs.readFileSync(first.file),
      next = fixture("order-next", {
        directory: first.directory,
        ready: true,
        urls: [newer],
      });
    const results = await Promise.all([
      next.gate.prepare(),
      next.gate.prepare(),
      next.gate.prepare(),
    ]);
    assert.ok(results.every((result) => result.ready));
    assert.equal(next.links.pending, 3);
    fs.writeFileSync(first.file, bytes); // Reappearing same native transfer identity in the same gate.
    assert.equal((await next.gate.prepare()).discardedStartupLinks, true);
    assert.equal(next.links.pending, 3);
    assert.deepEqual(await delivered(next), [old, old, newer]);
    checks.push(
      "Concurrent prepare and same-transfer reappearance import once; older duplicate events precede new cold input in exact order",
    );
  }
  {
    const first = await saved("unlink", [old, old]);
    let failOnce = true;
    const next = fixture("unlink-next", {
      directory: first.directory,
      ready: true,
      urls: [newer],
      fileSystem: {
        ...fs,
        unlinkSync(file) {
          if (file === first.file && failOnce) {
            failOnce = false;
            throw Error("fixture unlink failure");
          }
          return fs.unlinkSync(file);
        },
      },
    });
    assert.equal((await next.gate.prepare()).ready, false);
    assert.equal(next.links.pending, 1);
    assert.equal(fs.existsSync(first.file), true);
    assert.equal((await next.gate.prepare()).ready, true);
    assert.equal(fs.existsSync(first.file), false);
    assert.deepEqual(await delivered(next), [old, old, newer]);
    checks.push(
      "One consume unlink failure preserves the entire file and cold queue; corrected retry delivers each event once",
    );
  }
  {
    const urls = Array.from(
        { length: 64 },
        (_, index) => "https://older.invalid/" + index,
      ),
      first = await saved("capacity", urls),
      next = fixture("capacity-next", {
        directory: first.directory,
        ready: true,
        urls: [newer],
      });
    assert.equal((await next.gate.prepare()).ready, false);
    assert.equal(next.links.pending, 1);
    assert.equal(fs.existsSync(first.file), true);
    next.links.dispose();
    const retry = fixture("capacity-retry", {
      directory: first.directory,
      ready: true,
    });
    assert.equal((await retry.gate.prepare()).ready, true);
    assert.deepEqual(await delivered(retry), urls);
    checks.push(
      "Full64batch plus new cold event rejects without partial mutation; a subsequent no-extra-link recovery restores the complete original batch",
    );
  }
  for (const [label, age] of [
    ["expired", -24 * 60 * 60 * 1000],
    ["future", 60 * 1000],
  ]) {
    const first = await saved(label),
      record = JSON.parse(codec.decryptString(fs.readFileSync(first.file)));
    record.createdAt = Date.now() + age;
    record.expiresAt = record.createdAt + 15 * 60 * 1000;
    fs.writeFileSync(first.file, codec.encryptString(JSON.stringify(record)));
    const next = fixture(label + "-next", {
        directory: first.directory,
        ready: true,
        urls: [newer],
      }),
      result = await next.gate.prepare();
    assert.equal(result.ready, true);
    assert.equal(result.discardedStartupLinks, true);
    assert.equal(fs.existsSync(first.file), false);
    assert.deepEqual(await delivered(next), [newer]);
  }
  checks.push(
    "Schema-valid authenticated-format expired and excessive-future timestamps discard only the stale transfer before any delivery, preserving current cold input",
  );
  {
    const first = await saved("invalid-metadata"),
      record = JSON.parse(codec.decryptString(fs.readFileSync(first.file)));
    record.expiresAt += 1;
    fs.writeFileSync(first.file, codec.encryptString(JSON.stringify(record)));
    const next = fixture("invalid-next", {
      directory: first.directory,
      ready: true,
    });
    const result = await next.gate.prepare();
    assert.equal(result.ready, false);
    assert.equal(next.links.pending, 0);
    assert.equal(fs.existsSync(first.file), true);
    assert.doesNotMatch(result.error, /older|opaque|kept/);
    next.links.dispose();
    checks.push(
      "Invalid protected metadata fails closed without queued delivery, file removal or URL/query error disclosure",
    );
  }
  assert.deepEqual(hashes(), before);
  report.sources = before;
  report.sourcesStable = true;
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.failure = error.stack || error.message;
  process.exitCode = 1;
}
fs.writeFileSync(
  path.join(out, "result.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    { status: report.status, checks, failure: report.failure, out },
    null,
    2,
  ),
);
