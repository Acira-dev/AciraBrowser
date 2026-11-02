import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Reuse the owner's real last-window/app.quit journey. Add actual native exit
// codes and full-source provenance; never replace cleanup or worker behavior.
const root = process.cwd(),
  stamp = Date.now(),
  sourceRoot = path.resolve(process.env.ACIRA_PRIVATE_QUIT_SOURCE || root),
  out = path.resolve("qa/artifacts/accounts-private-quit-source-" + stamp),
  fixturePath = path.resolve("qa/private-last-window-quit.mjs"),
  fixture = await fs.readFile(fixturePath, "utf8"),
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  fixtureSha256 = sha(fixture);
assert.ok(
  sourceRoot.toLowerCase() === root.toLowerCase() ||
    sourceRoot.toLowerCase().startsWith(root.toLowerCase() + path.sep),
  "Source target must stay within this workspace",
);
assert.equal(
  fixtureSha256,
  "7d54b982e1a7d856f267d0cc567eca86b88b6a92295ee02baa9237674f75b36d",
  "Owner fixture changed; review its exact journey before adapting",
);
await fs.mkdir(out, { recursive: true });
let generated = fixture;
function replaceOnce(before, after) {
  assert.equal(
    generated.split(before).length,
    2,
    "Exact fixture anchor: " + before,
  );
  generated = generated.replace(before, after);
}
for (const helper of ["prepared-native", "native-helpers"])
  replaceOnce(
    "'./" + helper + ".mjs'",
    JSON.stringify(pathToFileURL(path.resolve("qa", helper + ".mjs")).href),
  );
for (const file of ["database", "runtime"])
  replaceOnce(
    "'../desktop/" + file + ".cjs'",
    JSON.stringify(path.join(sourceRoot, "desktop", file + ".cjs")),
  );
replaceOnce(
  "stamp=Date.now(),out=path.resolve('qa/artifacts/private-last-quit-'+stamp)",
  "stamp=" + stamp + ",out=" + JSON.stringify(out),
);
replaceOnce(
  "path.resolve('desktop/main.cjs')",
  JSON.stringify(path.join(sourceRoot, "desktop/main.cjs")),
);
generated = generated.replaceAll(
  "'.qa-profiles/private-last-quit-'",
  "'.qa-profiles/accounts-private-quit-source-'",
);
assert.equal(generated.split("await fs.readFile(file)").length, 3);
generated = generated.replaceAll(
  "await fs.readFile(file)",
  "await fs.readFile(path.join(" + JSON.stringify(sourceRoot) + ",file))",
);
replaceOnce(
  "const metadata=JSON.parse",
  "assert.equal(child.exitCode,0,'Actual browser process must exit with code zero');assert.equal(child.signalCode,null,'Actual browser process must not be signal-terminated');const metadata=JSON.parse",
);
replaceOnce(
  "report.cases.push({mode,pid,elapsed:",
  "report.cases.push({mode,pid,exitCode:child.exitCode,signal:child.signalCode,elapsed:",
);
const script = path.join(out, "native.mjs");
await fs.writeFile(script, generated);
await promisify(execFile)(process.execPath, ["--check", script]);
const sourceFiles = [];
async function collect(directory) {
  for (const item of await fs.readdir(path.join(sourceRoot, directory), {
    withFileTypes: true,
  })) {
    assert.equal(item.isSymbolicLink(), false);
    const file = path.join(directory, item.name);
    if (item.isDirectory()) await collect(file);
    else if (file.endsWith(".cjs")) sourceFiles.push(file);
  }
}
await collect("desktop");
assert.ok(sourceFiles.length < 256);
sourceFiles.push("dist/index.html");
const html = await fs.readFile(
  path.join(sourceRoot, "dist/index.html"),
  "utf8",
);
for (const asset of new Set(
  html.match(/assets\/[A-Za-z0-9._-]+\.(?:js|css)/g) || [],
))
  sourceFiles.push("dist/" + asset);
async function hashes() {
  return Object.fromEntries(
    await Promise.all(
      sourceFiles.sort().map(async (file) => {
        const bytes = await fs.readFile(path.join(sourceRoot, file));
        assert.ok(bytes.length < 10 * 1024 * 1024);
        return [file, sha(bytes)];
      }),
    ),
  );
}
const selectedSources = await hashes();
await fs.writeFile(
  path.join(out, "provenance.json"),
  JSON.stringify(
    {
      fixturePath,
      fixtureSha256,
      generatedSha256: sha(generated),
      sourceRoot,
      selectedSources,
      adaptations: [
        "Keep original two actual native worker/last-window/app.quit journeys",
        "Use explicit source root and isolated artifact/profile paths only",
        "Require and record native exitCode zero/no signal in both cases",
        "Fingerprint all native CJS and actual renderer assets even on failure",
      ],
    },
    null,
    2,
  ),
);
if (process.argv.includes("--prepare-only")) {
  console.log(
    JSON.stringify({ status: "PREPARED_ONLY", nativeLaunches: 0, out }),
  );
} else {
  let failure;
  try {
    await import(pathToFileURL(script).href);
  } catch (error) {
    failure = error;
  }
  const result = JSON.parse(
    await fs.readFile(path.join(out, "result.json"), "utf8"),
  );
  try {
    assert.deepEqual(
      await hashes(),
      selectedSources,
      "Native source graph changed",
    );
    assert.equal(sha(await fs.readFile(fixturePath)), fixtureSha256);
    result.selectedSourcesStable = true;
  } catch (error) {
    failure ||= error;
    result.selectedSourcesStable = false;
  }
  result.selectedSources = selectedSources;
  result.sourceRoot = sourceRoot;
  result.fixtureSha256 = fixtureSha256;
  result.nativeExitCodesChecked =
    result.cases.length === 2 &&
    result.cases.every((item) => item.exitCode === 0 && item.signal === null);
  result.status =
    !failure && result.pass && result.nativeExitCodesChecked ? "PASS" : "FAIL";
  if (failure) result.adapterFailure = failure.stack || failure.message;
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      status: result.status,
      nativeExitCodesChecked: result.nativeExitCodesChecked,
      selectedSourcesStable: result.selectedSourcesStable,
      out,
    }),
  );
  if (result.status !== "PASS") process.exitCode = 1;
}
