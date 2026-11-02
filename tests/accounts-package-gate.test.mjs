import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  qualifyPackage,
  selectQualifiedPackages,
  launchQualifiedPackage,
} from "../qa/accounts-qualified-packages.mjs";

// Inert fake bytes exercise the PRELAUNCH gate; no test launches an executable.
const repo = path.resolve(fileURLToPath(new URL("..", import.meta.url))),
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  qualifiedHash = "a".repeat(64),
  policy = {
    supportedMajor: 44,
    minimumVersion: "44.9.1",
    selectedRuntime: {
      qualified: true,
      version: "44.9.3",
      executableSha256: qualifiedHash,
    },
  };
async function fixture(t) {
  const parent = path.join(repo, "qa/artifacts"),
    root = await fs.mkdir(parent, { recursive: true }).then(() => fs.mkdtemp(path.join(parent, "accounts-package-gate-")));
  assert.equal(path.dirname(root), parent);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const name of ["release", "qa/artifacts", "packaging"])
    await fs.mkdir(path.join(root, name), { recursive: true });
  await fs.writeFile(
    path.join(root, "packaging/runtime-security.json"),
    JSON.stringify(policy),
  );
  return root;
}
async function candidate(
  root,
  id,
  {
    version = "44.9.3",
    upstream = qualifiedHash,
    marker,
    nativeVersion = version,
  } = {},
) {
  const folder = path.join(root, "release", "candidate-" + id),
    executable = path.join(folder, "AciraBrowser.exe");
  await fs.mkdir(folder);
  const bytes = Buffer.from("Inert fixture; never executed: " + id);
  await fs.writeFile(executable, bytes);
  const sourceDigest = sha(Buffer.from("source-" + id)),
    provenance = {
      sourceDigest,
      electron: version,
      runtimeQualification: {
        status: "PASS",
        version,
        upstreamExecutableSha256: upstream,
      },
    };
  const provenanceBytes = Buffer.from(JSON.stringify(provenance));
  await fs.writeFile(
    path.join(folder, "ACIRA-PROVENANCE.json"),
    provenanceBytes,
  );
  const manifestBytes = Buffer.from(
    JSON.stringify({
      files: [
        { file: "AciraBrowser.exe", sha256: sha(bytes) },
        { file: "ACIRA-PROVENANCE.json", sha256: sha(provenanceBytes) },
      ],
    }),
  );
  await fs.writeFile(path.join(folder, "FILES-SHA256.json"), manifestBytes);
  const report = "release-package-" + String(id).padStart(13, "0") + ".json";
  await fs.writeFile(
    path.join(root, "qa/artifacts", report),
    JSON.stringify({
      status: "PASS",
      sourceDigest,
      packageManifestSha256: sha(manifestBytes),
      actual: { exe: executable, runtime: { electron: nativeVersion } },
    }),
  );
  if (marker)
    await fs.writeFile(path.join(folder, marker), "Withdrawn inert fixture");
  return { folder, executable, report };
}

test("withdrawn runtime and ordinary withdrawal markers reject before the launch callback", async (t) => {
  const root = await fixture(t);
  let launches = 0;
  for (const [id, marker] of [
    [1, "WITHDRAWN-RUNTIME.json"],
    [2, "WITHDRAWN.json"],
  ]) {
    const item = await candidate(root, id, { version: "44.7.0", marker });
    await assert.rejects(
      launchQualifiedPackage({
        root,
        candidate: item,
        options: {},
        launch: () => launches++,
      }),
      /withdrawn/,
    );
  }
  assert.equal(launches, 0);
});
test("current release policy and native runtime identity reject unpatched, unqualified and mismatched packages", async (t) => {
  const root = await fixture(t);
  for (const [id, options, reason] of [
    [1, { version: "44.7.0" }, /security patch/],
    [2, { upstream: "b".repeat(64) }, /qualified frontend hash/],
    [3, { nativeVersion: "44.7.0" }, /Native package report runtime/],
    [4, { version: "44.9.2" }, /qualified patched runtime/],
  ]) {
    const item = await candidate(root, id, options);
    await assert.rejects(
      qualifyPackage({ root, reportName: item.report }),
      reason,
    );
  }
});
test("withdrawal, changed payload and changed policy are rechecked after discovery and before launch", async (t) => {
  const root = await fixture(t);
  let launches = 0;
  const withdrawn = await candidate(root, 1),
    selected = await qualifyPackage({ root, reportName: withdrawn.report });
  await fs.writeFile(
    path.join(withdrawn.folder, "WITHDRAWN-RUNTIME.json"),
    "Late withdrawal",
  );
  await assert.rejects(
    launchQualifiedPackage({
      root,
      candidate: selected,
      launch: () => launches++,
    }),
    /withdrawn/,
  );
  const changed = await candidate(root, 2),
    second = await qualifyPackage({ root, reportName: changed.report });
  await fs.appendFile(changed.executable, "changed bytes");
  await assert.rejects(
    launchQualifiedPackage({
      root,
      candidate: second,
      launch: () => launches++,
    }),
    /payload changed/,
  );
  const prior = await candidate(root, 3),
    third = await qualifyPackage({ root, reportName: prior.report });
  await fs.writeFile(
    path.join(root, "packaging/runtime-security.json"),
    JSON.stringify({
      ...policy,
      selectedRuntime: { ...policy.selectedRuntime, version: "44.9.4" },
    }),
  );
  await assert.rejects(
    launchQualifiedPackage({
      root,
      candidate: third,
      launch: () => launches++,
    }),
    /qualified patched runtime/,
  );
  assert.equal(launches, 0);
});
test("selection keeps only two distinct passing payloads and binds the verified executable at launch", async (t) => {
  const root = await fixture(t);
  await candidate(root, 3, {
    version: "44.7.0",
    marker: "WITHDRAWN-RUNTIME.json",
  });
  await candidate(root, 2);
  await candidate(root, 1);
  const result = await selectQualifiedPackages({ root });
  assert.equal(result.candidates.length, 2);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /withdrawn/);
  let called;
  await launchQualifiedPackage({
    root,
    candidate: result.candidates[0],
    options: { executablePath: "not-allowed", args: [] },
    launch: async (options) => {
      called = options;
    },
  });
  assert.equal(called.executablePath, result.candidates[0].executable);
});
test("actual upgrade CLI with one qualified and one withdrawn package exits NOT_RUN before _electron.launch", async (t) => {
  const root = await fixture(t);
  await candidate(root, 2);
  await candidate(root, 1, {
    version: "44.7.0",
    marker: "WITHDRAWN-RUNTIME.json",
  });
  const require = createRequire(import.meta.url),
    playwrightModule = pathToFileURL(
      path.join(path.dirname(require.resolve("playwright")), "index.mjs"),
    ).href,
    sentinel = path.join(root, "NATIVE_LAUNCH_ATTEMPTED"),
    preload = path.join(root, "deny-native.mjs");
  await fs.writeFile(
    preload,
    "import {_electron} from " +
      JSON.stringify(playwrightModule) +
      ';import fs from "node:fs";_electron.launch=async()=>{fs.writeFileSync(' +
      JSON.stringify(sentinel) +
      ',"Unexpected native launch");throw Error("Native launch must not happen");};',
  );
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(preload).href,
      path.join(repo, "qa/accounts-upgrade.mjs"),
    ],
    {
      cwd: root,
      env: process.env,
      windowsHide: true,
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stdout, /NOT_RUN/);
  assert.match(result.stdout, /WITHDRAWN-RUNTIME/);
  await assert.rejects(fs.access(sentinel), { code: "ENOENT" });
  await assert.rejects(fs.access(path.join(root, ".qa-profiles")), {
    code: "ENOENT",
  });
  const report = (await fs.readdir(path.join(root, "qa/artifacts"))).find(
      (name) => name.startsWith("accounts-upgrade-preflight-"),
    ),
    observed = JSON.parse(
      await fs.readFile(path.join(root, "qa/artifacts", report), "utf8"),
    );
  assert.equal(observed.nativeLaunches, 0);
  assert.equal(observed.eligible.length, 1);
});
