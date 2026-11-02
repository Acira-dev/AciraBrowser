import {captureFixtureDatabase} from './release-fixture-database.mjs';
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Adapt a captured owner journey or its exact selected-product Git commit.
// Product cleanup, request, confirmation and recovery remain the actual build.
const args = process.argv
  .slice(2)
  .filter(
    (value) =>
      !["--prepare-only", "--worker", "--observe-feedback"].includes(value),
  );
const workerJourney = process.argv.includes("--worker");
const observeFeedback = process.argv.includes("--observe-feedback");
assert.ok(
  !workerJourney || !observeFeedback,
  "Feedback observation requires the integrated journey",
);
assert.ok(
  args[0] && args[1],
  "Usage: candidate-or-portable <captured-snapshot|--committed-fixture> [package-report] [--prepare-only]",
);
const committedFixture = args[1] === "--committed-fixture";
const workspace = process.cwd(),
  target = path.resolve(args[0]),
  snapshotPath = committedFixture ? null : path.resolve(args[1]),
  packageReport = args[2];
assert.ok(
  target.startsWith(workspace + path.sep),
  "Use an owned workspace candidate",
);
if (snapshotPath)
  assert.ok(
    snapshotPath.startsWith(path.resolve("docs/release/snapshots") + path.sep),
    "Use an exact captured owner snapshot",
  );
const identity = JSON.parse(
  await fs.readFile(
    path.join(
      target,
      packageReport ? "ACIRA-PROVENANCE.json" : "build-identity.json",
    ),
    "utf8",
  ),
);
assert.equal(identity.committedSource, true);
assert.match(identity.sourceDigest, /^[a-f0-9]{64}$/);
assert.match(identity.commit, /^[a-f0-9]{40}$/);
const snapshot = snapshotPath
  ? JSON.parse(await fs.readFile(snapshotPath, "utf8"))
  : { entries: [] };
const withdrawals = JSON.parse(
  await fs.readFile("docs/release/withdrawals.json", "utf8"),
);
assert.ok(
  !withdrawals.snapshots.some(
    (item) => path.resolve(item.path) === snapshotPath,
  ),
  "Selected owner snapshot was withdrawn",
);
assert.ok(
  !withdrawals.candidates.some(
    (item) => item.sourceDigest === identity.sourceDigest,
  ),
  "Selected product was withdrawn",
);
const fixtureFile = workerJourney
  ? "qa/profile-cleanup-worker.mjs"
  : "qa/profile-cleanup-integrated.mjs";
const fixtureBlob = execFileSync(
  "git",
  ["rev-parse", identity.commit + ":" + fixtureFile],
  { encoding: "utf8" },
).trim();
const entry = committedFixture
  ? {
      file: fixtureFile,
      blob: fixtureBlob,
      sha256: createHash("sha256")
        .update(execFileSync("git", ["cat-file", "blob", fixtureBlob]))
        .digest("hex"),
    }
  : snapshot.entries.find((value) => value.file === fixtureFile);
assert.ok(
  entry && !entry.deleted && /^[a-f0-9]{40}$/.test(entry.blob),
  "Snapshot must contain the approved native F12 fixture",
);
const bytes = execFileSync("git", ["cat-file", "blob", entry.blob]);
assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
const fixture = bytes.toString("utf8");
assert.equal(
  fixtureBlob,
  entry.blob,
  "Selected product commit must contain the exact captured fixture",
);
for (const source of snapshot.entries.filter(
  (item) => /^(desktop|src)\//.test(item.file) && !item.deleted,
)) {
  const committed = execFileSync("git", [
    "show",
    identity.commit + ":" + source.file,
  ]);
  assert.equal(
    createHash("sha256").update(committed).digest("hex"),
    source.sha256,
    "Selected product source differs from captured integration: " + source.file,
  );
  if (!packageReport)
    assert.equal(
      identity.source.find((item) => item.file === source.file)?.sha256,
      source.sha256,
      "Candidate build did not capture the selected integration source",
    );
}
const productRoot = packageReport ? path.join(target, "resources/app") : target;
const selection = {
  commit: identity.commit,
  sourceDigest: identity.sourceDigest,
  packageReport: packageReport || null,
  fixtureSnapshot: snapshotPath ? path.relative(workspace, snapshotPath) : null,
  fixtureCommit: identity.commit,
  fixtureSelection: committedFixture ? "committed-product" : "captured-owner",
  fixtureSha256: entry.sha256,
  fixtureBlob: entry.blob,
  journey: workerJourney
    ? "ordinary-active-worker-recovery"
    : "ordinary-settings-and-lifecycle",
};
async function verifyPayload() {
  if (packageReport) {
    const { qualifyPackage } = await import(
      "./accounts-qualified-packages.mjs"
    );
    const current = await qualifyPackage({
      root: workspace,
      reportName: packageReport,
    });
    assert.equal(path.dirname(current.executable), target);
    assert.equal(current.sourceDigest, identity.sourceDigest);
    return;
  }
  for (const item of identity.artifacts) {
    const file = path.resolve(productRoot, item.file);
    assert.ok(file.startsWith(productRoot + path.sep));
    assert.ok(
      (await fs.realpath(file)).startsWith(
        (await fs.realpath(productRoot)) + path.sep,
      ),
    );
    assert.equal(
      createHash("sha256")
        .update(await fs.readFile(file))
        .digest("hex"),
      item.sha256,
      "Immutable artifact changed " + item.file,
    );
  }
}
const fixtureDatabase=await captureFixtureDatabase(identity);
let generated = fixture;
const replaceRequired=(before,after)=>{assert.ok(generated.includes(before),'Owner fixture shape changed: '+before);generated=generated.replaceAll(before,after);};
for(const helper of ['prepared-native','native-helpers','palette-native-identity']){
 const before="'./"+helper+".mjs'";if(helper==='palette-native-identity'&&!generated.includes(before))continue;
 replaceRequired(before,JSON.stringify(pathToFileURL(path.resolve('qa',helper+'.mjs')).href));
}
replaceRequired('import {launchPreparedNative} from '+JSON.stringify(pathToFileURL(path.resolve('qa/prepared-native.mjs')).href)+';','');
const rootedFixture=generated.includes('codeRoot=artifact?.codeRoot||process.cwd()');
if(rootedFixture){
 replaceRequired('codeRoot=artifact?.codeRoot||process.cwd()','codeRoot=releaseProductRoot');
 replaceRequired("require(path.join(codeRoot,'desktop/database.cjs'))",'require(releaseDatabaseFixture)');
}else{
 replaceRequired("require('../desktop/database.cjs')",'require(releaseDatabaseFixture)');
 replaceRequired("require('../desktop/runtime.cjs')","require(path.join(releaseProductRoot,'desktop/runtime.cjs'))");
}
if(workerJourney){
 const first=generated.indexOf('const files=['),last=generated.indexOf('const hashes=',first);assert.ok(first>=0&&last>first,'Worker product fingerprint boundary');
 replaceRequired(generated.slice(first,last),'const files=await releaseProductFiles();');
}else if(!rootedFixture){
 replaceRequired('fs.readdir(directory,{withFileTypes:true})','fs.readdir(path.join(releaseProductRoot,directory),{withFileTypes:true})');
 replaceRequired("fs.readFile('dist/index.html','utf8')","fs.readFile(path.join(releaseProductRoot,'dist/index.html'),'utf8')");
}
if(!rootedFixture)replaceRequired('fs.readFile(file)','fs.readFile(path.join(releaseProductRoot,file))');
replaceRequired(workerJourney?"profile-cleanup-worker-'":"profile-cleanup-integrated-'",workerJourney?"release-profile-cleanup-worker-'":"release-profile-cleanup-'");
replaceRequired(rootedFixture?"launchPreparedNative({executablePath:artifact?.executable,args:[path.join(codeRoot,'desktop/main.cjs')],env:":"launchPreparedNative({args:[path.resolve('desktop/main.cjs')],env:",'launchReleaseCleanup({env:');
assert.doesNotMatch(generated,/launchPreparedNative|require\('\.\.\/desktop/);
if (observeFeedback)
  replaceRequired(
    "assert.equal(await feedback.evaluate(node=>{const bounds=node.getBoundingClientRect();return bounds.top>=0&&bounds.bottom<=innerHeight;}),true);",
    "const geometry=await feedback.evaluate(async node=>{const sample=()=>{const bounds=node.getBoundingClientRect();return {top:bounds.top,bottom:bounds.bottom,height:bounds.height,viewport:innerHeight,focused:document.activeElement===node,ancestors:Array.from((function*(current){while(current){yield current;current=current.parentElement;}})(node.parentElement)).filter(parent=>parent.scrollHeight>parent.clientHeight).map(parent=>({tag:parent.tagName,className:parent.className,scrollTop:parent.scrollTop,clientHeight:parent.clientHeight,scrollHeight:parent.scrollHeight}))};};const initial=sample(),frames=[];for(let frame=0;frame<12;frame++){await new Promise(requestAnimationFrame);frames.push(sample());}return {initial,frames};});(report.releaseFeedbackGeometry??=[]).push(geometry);assert.equal(geometry.initial.top>=0&&geometry.initial.bottom<=geometry.initial.viewport,true);",
  );
const prefix = `
import {_electron as releaseElectron} from 'playwright';
import {initializeReleaseProfile as releaseInitialize} from ${JSON.stringify(pathToFileURL(path.resolve("qa/release-initialize-profile.mjs")).href)};
import {qualifiedElectron as releaseRuntime} from ${JSON.stringify(pathToFileURL(path.resolve("qa/release-runtime.mjs")).href)};
import {qualifyPackage as releaseQualify,launchQualifiedPackage as releaseLaunchQualified} from ${JSON.stringify(pathToFileURL(path.resolve("qa/accounts-qualified-packages.mjs")).href)};
const releaseProductRoot=${JSON.stringify(productRoot)},releaseSelection=${JSON.stringify(selection)},releaseDatabaseFixture=${JSON.stringify(fixtureDatabase.file)};
async function releaseProductFiles(){const files=[];async function walk(directory){for(const item of await fs.readdir(path.join(releaseProductRoot,directory),{withFileTypes:true})){const file=path.join(directory,item.name);if(item.isDirectory())await walk(file);else if(file.endsWith('.cjs')||file.endsWith('.js')||file.endsWith('.css')||file==='dist/index.html')files.push(file);}}await walk('desktop');await walk('dist');return files;}
async function launchReleaseCleanup(options){
 const env={...options.env,NODE_PATH:''};delete env.ELECTRON_RUN_AS_NODE;delete env.ACIRA_DEV;
 report.releaseQualification=releaseSelection;
 ${
   packageReport
     ? `
 const selected=await releaseQualify({root:${JSON.stringify(workspace)},reportName:${JSON.stringify(packageReport)}});
 assert.equal(selected.sourceDigest,releaseSelection.sourceDigest);assert.equal(path.dirname(selected.executable),${JSON.stringify(target)});
 releaseSelection.packageManifestSha256=selected.packageManifestSha256;
 (report.releaseProfileInitializations??=[]).push(await releaseInitialize({candidate:releaseProductRoot,data:env.ACIRA_BROWSER_TEST_DATA,executablePath:selected.executable,packaged:true}));
 const running=await releaseLaunchQualified({root:${JSON.stringify(workspace)},candidate:selected,options:{...options,args:[],env},launch:options=>releaseElectron.launch(options)});
 try{const actual=await running.evaluate(({app})=>({packaged:app.isPackaged,executable:process.execPath,appPath:app.getAppPath()}));assert.equal(actual.packaged,true);assert.equal(path.resolve(actual.executable),path.resolve(selected.executable));assert.equal(path.resolve(actual.appPath),path.resolve(releaseProductRoot));(report.actualPackages??=[]).push(actual);return running;}catch(error){await running.close();throw error;}
 `
     : `
 const runtime=await releaseRuntime();assert.equal(runtime.qualification.version,${JSON.stringify(identity.electron)});
 (report.releaseProfileInitializations??=[]).push(await releaseInitialize({candidate:releaseProductRoot,data:env.ACIRA_BROWSER_TEST_DATA,executablePath:runtime.executablePath}));
 return releaseElectron.launch({...options,args:[path.join(releaseProductRoot,'desktop/main.cjs')],executablePath:runtime.executablePath,env});
 `
 }
}
`;
generated = prefix + generated;
const out = path.resolve(
  "qa/artifacts/release-profile-cleanup-adapter-" + Date.now(),
);
await fs.mkdir(out, { recursive: true });
const script = path.join(out, "native.mjs");
await fs.writeFile(script, generated);
execFileSync(process.execPath, ["--check", script]);
await fs.writeFile(
  path.join(out, "provenance.json"),
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      ...selection,
      productRoot,
      fixtureDatabase,
      generatedSha256: createHash("sha256").update(generated).digest("hex"),
      feedbackObservation: observeFeedback
        ? "Record initial geometry and 12 frames; original initial-viewport assertion remains authoritative"
        : null,
      adaptations: [
        "Use exact captured fixture bytes, not mutable working QA",
        "Use actual selected product startup initializer and explicit initialized-key precondition",
        "Bind all source reads to selected product; verify complete artifact/payload before and after",
        "Standalone launches verify actual executable and resources on every process",
        "No product cleanup/request/recovery/window implementation substituted",
      ],
    },
    null,
    2,
  ) + "\n",
);
if (process.argv.includes("--prepare-only"))
  console.log(
    JSON.stringify({ status: "PREPARED_ONLY", nativeLaunches: 0, script, out }),
  );
else {
  await verifyPayload();
  try {
    await import(pathToFileURL(script).href);
  } finally {
    await verifyPayload();
  }
}
