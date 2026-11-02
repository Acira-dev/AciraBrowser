import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
const require = createRequire(import.meta.url);
const { createStartupGate } = require("../desktop/startup-gate.cjs");
const {
  createExternalLinkIntake,
} = require("../desktop/accounts/external-links.cjs");
const root = process.cwd(),
  run = Date.now(),
  out = path.join(root, "qa/artifacts/accounts-startup-intake-review-" + run);
fs.mkdirSync(out, { recursive: true });
const files = [
  "desktop/startup-gate.cjs",
  "desktop/accounts/external-links.cjs",
];
const hashes = () =>
  Object.fromEntries(
    files.map((file) => [
      file,
      createHash("sha256")
        .update(fs.readFileSync(path.join(root, file)))
        .digest("hex"),
    ]),
  );
const before = hashes();
const cipher = {
  encryptString: (value) =>
    Buffer.from("fixture:" + Buffer.from(value).toString("base64")),
  decryptString: (bytes) => {
    if (!bytes.toString().startsWith("fixture:")) throw Error();
    return Buffer.from(bytes.toString().slice(8), "base64").toString();
  },
};
function fixture(
  name,
  {
    directory = path.join(out, name),
    ready = false,
    argv = ["electron", "main.cjs"],
    fileSystem = fs,
  } = {},
) {
  fs.mkdirSync(directory, { recursive: true });
  const app = new EventEmitter(),
    errors = [],
    restarts = [];
  app.getPath = () => directory;
  const links = createExternalLinkIntake({
    app,
    argv,
    onError: (message) => errors.push(message),
  });
  const gate = createStartupGate({
    app,
    safeStorage: cipher,
    links,
    argv,
    fileSystem,
    bootstrapFactory: ({ argv }) => ({
      prepare: () =>
        ready ? { ready: true } : { ready: false, relaunchRequired: true },
      restart: () => restarts.push(argv),
    }),
  });
  return { directory, app, links, gate, errors, restarts };
}
const old = "https://older.invalid/old?opaque=fixture#kept",
  newer = "https://newer.invalid/new?opaque=fixture#kept";
const findings = [],
  observations = [];
{
  const first = fixture("order", { argv: ["electron", "main.cjs", old] });
  await first.gate.prepare();
  const second = fixture("order-child", {
    directory: first.directory,
    ready: true,
    argv: ["electron", "main.cjs", newer],
  });
  const result = await second.gate.prepare(),
    opened = [];
  await second.links.bind((url) => opened.push(url));
  const labels = opened.map((url) =>
    url === old ? "older-handoff" : url === newer ? "new-cold" : "other",
  );
  observations.push({
    case: "recover-prior-handoff-with-new-cold-link",
    ready: result.ready,
    labels,
  });
  if (labels.join() !== "older-handoff,new-cold")
    findings.push({
      code: "OLDER_HANDOFF_AFTER_NEW_COLD",
      expected: ["older-handoff", "new-cold"],
      actual: labels,
      boundary:
        "Recovery of an unconsumed valid handoff plus new process cold argv; not a claim about Windows event timing",
    });
  first.links.dispose();
  second.links.dispose();
}
{
  const first = fixture("stale", { argv: ["electron", "main.cjs", old] });
  await first.gate.prepare();
  const file = path.join(first.directory, "startup-links.bin"),
    payload = JSON.parse(cipher.decryptString(fs.readFileSync(file)));
  payload.createdAt = Date.now() - 24 * 60 * 60 * 1000;
  payload.expiresAt = Date.now() - 23 * 60 * 60 * 1000;
  fs.writeFileSync(file, cipher.encryptString(JSON.stringify(payload)));
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  fs.utimesSync(file, yesterday, yesterday);
  const second = fixture("stale-child", {
    directory: first.directory,
    ready: true,
  });
  const result = await second.gate.prepare();
  observations.push({
    case: "stale-24-hour-transfer",
    ready: result.ready,
    queued: second.links.pending,
  });
  if (result.ready && second.links.pending)
    findings.push({
      code: "STALE_TRANSFER_ACCEPTED",
      ageHours: 24,
      expected: "reject stale transfer before delivery",
      actualQueued: second.links.pending,
    });
  first.links.dispose();
  second.links.dispose();
}
{
  const first = fixture("delete-retry", {
    argv: ["electron", "main.cjs", old],
  });
  await first.gate.prepare();
  const file = path.join(first.directory, "startup-links.bin");
  let failOnce = true;
  const second = fixture("delete-retry-child", {
    directory: first.directory,
    ready: true,
    fileSystem: {
      ...fs,
      unlinkSync(target) {
        if (target === file && failOnce) {
          failOnce = false;
          throw Object.assign(Error("fixture unlink failure"), {
            code: "EPERM",
          });
        }
        return fs.unlinkSync(target);
      },
    },
  });
  const attempt = await second.gate.prepare(),
    retry = await second.gate.prepare(),
    opened = [];
  await second.links.bind((url) => opened.push(url));
  observations.push({
    case: "consumed-file-unlink-fails-once",
    attemptReady: attempt.ready,
    retryReady: retry.ready,
    deliveredCount: opened.length,
  });
  if (opened.length !== 1)
    findings.push({
      code: "UNLINK_RETRY_DUPLICATES_TRANSFER",
      expectedDeliveries: 1,
      actualDeliveries: opened.length,
    });
  first.links.dispose();
  second.links.dispose();
}
{
  const urls = Array.from(
    { length: 64 },
    (_, index) => "https://older.invalid/" + index,
  );
  const first = fixture("capacity", {
    argv: ["electron", "main.cjs", ...urls],
  });
  await first.gate.prepare();
  const second = fixture("capacity-child", {
    directory: first.directory,
    ready: true,
    argv: ["electron", "main.cjs", newer],
  });
  const beforeCount = second.links.pending,
    result = await second.gate.prepare();
  observations.push({
    case: "full-transfer-plus-one-new-link",
    ready: result.ready,
    beforeCount,
    afterCount: second.links.pending,
  });
  if (!result.ready && second.links.pending !== beforeCount)
    findings.push({
      code: "REJECTED_TRANSFER_PARTIALLY_QUEUED",
      expectedPendingAfterFailure: beforeCount,
      actualPending: second.links.pending,
    });
  first.links.dispose();
  second.links.dispose();
}
const after = hashes();
if (JSON.stringify(after) !== JSON.stringify(before))
  throw Error("Source changed during review; discard these observations");
const result = {
  status: findings.length ? "FINDINGS" : "NO_FINDINGS_IN_THESE_CASES",
  findings,
  observations,
  selectedSources: before,
  selectedSourcesStable: true,
  native: false,
  cipher: "Explicit fake codec; only queue/file control flow reviewed",
  scope:
    "No parallel handoff implementation; existing frontend gate plus its single intake (including native atomic restore). Actual product/native bootstrap acceptance remains separate. No URL/query values logged.",
};
fs.writeFileSync(
  path.join(out, "result.json"),
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify(
    {
      status: result.status,
      findings: findings.map((item) => item.code),
      native: false,
      artifacts: out,
    },
    null,
    2,
  ),
);
