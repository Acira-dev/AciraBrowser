import {captureFixtureDatabase} from './release-fixture-database.mjs';
import {execFileSync} from 'node:child_process';
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

// Reuse the frozen owner's actual product journey. Only launch and file paths
// change; native close, workers, storage and request implementations do not.
const args = process.argv
  .slice(2)
  .filter((value) => !["--prepare-only", "--last-window"].includes(value));
const lastWindow = process.argv.includes("--last-window");
const root = process.cwd(),
  candidateRoot = path.resolve(args[0] || ""),
  packageReport = args[1],
  stamp = Date.now();
assert.ok(
  candidateRoot.startsWith(root + path.sep),
  "Candidate must be inside this workspace",
);
const identity = JSON.parse(
  await fs.readFile(
    path.join(
      candidateRoot,
      packageReport ? "ACIRA-PROVENANCE.json" : "build-identity.json",
    ),
    "utf8",
  ),
);
assert.equal(identity.committedSource, true);
const fixtureFile=lastWindow?'qa/private-last-window-quit.mjs':'qa/private-close-lifecycle.mjs';
const fixture=execFileSync('git',['show',identity.commit+':'+fixtureFile],{encoding:'utf8'});
const fixtureSha256 = createHash("sha256").update(fixture).digest("hex");
assert.equal(
  fixtureSha256,
  lastWindow
    ? "7d54b982e1a7d856f267d0cc567eca86b88b6a92295ee02baa9237674f75b36d"
    : "d5daf49fb948c4df2c07aa2210c205e534a983b5131a4607a1d36be971af2603",
  "Owner fixture changed; review and recapture before adapting",
);

const productRoot = packageReport
  ? path.join(candidateRoot, "resources/app")
  : candidateRoot;
const selectedIdentity = {
  commit: identity.commit,
  sourceDigest: identity.sourceDigest,
  packageReport: packageReport || null,
  journey: lastWindow
    ? "last-private-window-and-global-quit"
    : "private-close-cancellation-and-isolation",
  fixtureSha256,
};
async function verifyPayload() {
  if (packageReport) {
    const { qualifyPackage } = await import(
      "./accounts-qualified-packages.mjs"
    );
    const selected = await qualifyPackage({ root, reportName: packageReport });
    assert.equal(path.dirname(selected.executable), candidateRoot);
    assert.equal(selected.sourceDigest, identity.sourceDigest);
    return;
  }
  for (const entry of identity.artifacts) {
    const file = path.resolve(candidateRoot, entry.file);
    assert.ok(file.startsWith(candidateRoot + path.sep));
    assert.equal(
      createHash("sha256")
        .update(await fs.readFile(file))
        .digest("hex"),
      entry.sha256,
      "Immutable artifact changed: " + entry.file,
    );
  }
}
const fixtureDatabase=await captureFixtureDatabase(identity);
let generated = fixture;
for (const helper of ["prepared-native", "native-helpers"])
  generated = generated.replaceAll(
    "'./" + helper + ".mjs'",
    JSON.stringify(pathToFileURL(path.resolve("qa", helper + ".mjs")).href),
  );
generated = generated.replace(
  "import {launchPreparedNative} from " +
    JSON.stringify(pathToFileURL(path.resolve("qa/prepared-native.mjs")).href) +
    ";",
  "",
);
const prefix = `
async function showReleaseWindows(app){await app.evaluate(({BaseWindow})=>{process.env.ACIRA_BROWSER_TEST_HIDDEN='0';for(const w of BaseWindow.getAllWindows()){w.setBounds({x:-2800,y:80,width:1400,height:900});w.setFocusable(false);w.setIgnoreMouseEvents(true);w.showInactive();}});}
async function keepEditingRelease(app){const card=await poll(async()=>{for(const page of app.context().pages())if(page.url().includes('site-prompt.html'))try{if(await page.locator('#card').isVisible()&&await page.getByRole('button',{name:'Keep editing',exact:true}).isVisible())return page;}catch{}},Boolean,'Actual unsaved-work close card');assert.match(await card.locator('#sites').innerText(),/127\\.0\\.0\\.1/);await card.getByRole('button',{name:'Keep editing',exact:true}).click();await poll(()=>card.locator('#card').isVisible(),visible=>!visible,'Keep editing dismisses close card');await app.evaluate(()=>{process.env.ACIRA_BROWSER_TEST_HIDDEN='1';});}
import {_electron} from 'playwright';
import {initializeReleaseProfile} from ${JSON.stringify(pathToFileURL(path.resolve("qa/release-initialize-profile.mjs")).href)};
import {qualifiedElectron} from ${JSON.stringify(pathToFileURL(path.resolve("qa/release-runtime.mjs")).href)};
import {qualifyPackage,launchQualifiedPackage} from ${JSON.stringify(pathToFileURL(path.resolve("qa/accounts-qualified-packages.mjs")).href)};
const productRoot=${JSON.stringify(productRoot)},selectedIdentity=${JSON.stringify(selectedIdentity)};
async function launchReleasePrivate(options){
 const env={...options.env,NODE_PATH:''};delete env.ELECTRON_RUN_AS_NODE;delete env.ACIRA_DEV;
 ${
   packageReport
     ? `
 const candidate=await qualifyPackage({root:${JSON.stringify(root)},reportName:${JSON.stringify(packageReport)}});
 assert.equal(candidate.sourceDigest,selectedIdentity.sourceDigest);assert.equal(path.dirname(candidate.executable),${JSON.stringify(candidateRoot)});
 report.releaseQualification.packageManifestSha256=candidate.packageManifestSha256;
 report.profileInitialization=await initializeReleaseProfile({candidate:productRoot,data:env.ACIRA_BROWSER_TEST_DATA,executablePath:candidate.executable,packaged:true});
 (report.profileInitializations??=[]).push(report.profileInitialization);
 const running=await launchQualifiedPackage({root:${JSON.stringify(root)},candidate,options:{...options,args:[],env},launch:options=>_electron.launch(options)});
 try{const actual=await running.evaluate(({app})=>({packaged:app.isPackaged,executable:process.execPath,appPath:app.getAppPath()}));
 assert.equal(actual.packaged,true);assert.equal(path.resolve(actual.executable),path.resolve(candidate.executable));assert.equal(path.resolve(actual.appPath),path.resolve(productRoot));
 (report.actualPackages??=[]).push(actual);return running;}catch(error){await running.close();throw error;}
 `
     : `
 const runtime=await qualifiedElectron();
 report.profileInitialization=await initializeReleaseProfile({candidate:productRoot,data:env.ACIRA_BROWSER_TEST_DATA,executablePath:runtime.executablePath});
 (report.profileInitializations??=[]).push(report.profileInitialization);
 return _electron.launch({...options,args:[path.join(productRoot,'desktop/main.cjs')],executablePath:runtime.executablePath,env});
 `
 }
}
`;
generated = prefix + generated;
generated = generated.replaceAll(
  "require('../desktop/database.cjs')",
  "require("+JSON.stringify(fixtureDatabase.file)+")",
);
generated = generated.replaceAll(
  "require('../desktop/runtime.cjs')",
  "require(path.join(productRoot,'desktop/runtime.cjs'))",
);
generated = generated.replaceAll(
  "private-close-" + "'",
  "release-private-close-" + "'",
);
generated = generated.replaceAll(
  "private-last-quit-" + "'",
  "release-private-last-quit-" + "'",
);
generated = generated.replace(
  "const files=[",
  "report.releaseQualification=selectedIdentity;const files=[",
);
generated = generated.replaceAll(
  "fs.readFile(file)",
  "fs.readFile(path.join(productRoot,file))",
);
if (lastWindow) {
  const exitRecord = "report.cases.push({mode,pid,elapsed:";
  assert.ok(generated.includes(exitRecord), "Frozen exit observation changed");
  generated = generated.replace(
    exitRecord,
    "assert.equal(child.exitCode,0,'Actual browser must exit normally');assert.equal(child.signalCode,null,'No native signal may terminate the browser');report.cases.push({mode,pid,exitCode:child.exitCode,signalCode:child.signalCode,elapsed:",
  );
}
const fileStart=generated.indexOf('const files=['),fileEnd=generated.indexOf(';for(const file of files)',fileStart);
assert.ok(fileStart>=0&&fileEnd>fileStart,'Frozen product fingerprint boundary');
const productFiles=[];
async function collect(directory){for(const item of await fs.readdir(path.join(productRoot,directory),{withFileTypes:true})){const file=path.join(directory,item.name);if(item.isDirectory())await collect(file);else if(/\.(?:cjs|js|css|html)$/.test(file))productFiles.push(file);}}
await collect('desktop');await collect('dist');
generated=generated.slice(0,fileStart)+'const files='+JSON.stringify(productFiles)+generated.slice(fileEnd);
if(!lastWindow){
  const oldStay="await poll(()=>app.evaluate(()=>globalThis.__privateCloseQuestions),count=>count===1,'Actual main beforeunload question');";
  assert.ok(generated.includes(oldStay),'Frozen main-page cancellation control');
  generated=generated.replace(oldStay,"await keepEditingRelease(app);assert.equal(await app.evaluate(()=>globalThis.__privateCloseQuestions),0,'Themed cancellation precedes legacy dialog');");
  const firstClose="await webA.getByRole('button',{name:'Protect draft'}).click();";
  assert.ok(generated.includes(firstClose));
  generated=generated.replace(firstClose,'await showReleaseWindows(app);'+firstClose);
  generated=generated.replace("count=>count===2,'Actual popup beforeunload question'","count=>count===1,'Actual popup beforeunload question'");
}
const launch =
  "app=await launchPreparedNative({args:[path.resolve('desktop/main.cjs')],env:";
assert.ok(generated.includes(launch), "Frozen fixture launch shape changed");
generated = generated.replace(launch, "app=await launchReleasePrivate({env:");
assert.doesNotMatch(generated, /launchPreparedNative|require\('\.\.\/desktop/);
const out = path.resolve(
  "qa/artifacts/release-private-close-adapter-" +
    (lastWindow ? "last-" : "") +
    stamp,
);
await fs.mkdir(out, { recursive: true });
const script = path.join(out, "native.mjs");
await fs.writeFile(script, generated);
await fs.writeFile(
  path.join(out, "provenance.json"),
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      ...selectedIdentity,
      productRoot,
      generatedSha256: createHash("sha256").update(generated).digest("hex"),
      adaptations: [
        "Use exact committed candidate or fully qualified standalone",
        "Fingerprint the candidate native sources before and after",
        "Retain original main/popup Stay, accepted close, live second-private worker and ordinary preservation controls",
      ],
    },
    null,
    2,
  ) + "\n",
);
if (process.argv.includes("--prepare-only"))
  console.log(
    JSON.stringify({ status: "PREPARED_ONLY", nativeLaunches: 0, script }),
  );
else {
  await verifyPayload();
  try {
    await import(pathToFileURL(script).href);
  } finally {
    await verifyPayload();
  }
}
