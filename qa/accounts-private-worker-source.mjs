import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

// Same failing real-product worker journey, adapted only to source launch and
// native/renderer fingerprints so owners can verify a fix before repackaging.
const root = process.cwd(),
  stamp = Date.now(),
  sourceRoot = path.resolve(process.env.ACIRA_PRIVATE_WORKER_SOURCE || root),
  out = path.resolve("qa/artifacts/accounts-private-worker-source-" + stamp),
  data = path.resolve(".qa-profiles/accounts-private-worker-source-" + stamp),
  fixture = await fs.readFile("qa/accounts-private-worker.mjs", "utf8");
assert.ok(
  sourceRoot.toLowerCase() === root.toLowerCase() ||
    sourceRoot.toLowerCase().startsWith(root.toLowerCase() + path.sep),
  "Source target must stay in the owned workspace",
);
await fs.mkdir(out, { recursive: true });
let generated = fixture;
for (const helper of [
  "native-helpers",
  "release-local-setup",
  "release-initialize-profile",
  "accounts-qualified-packages",
])
  generated = generated.replaceAll(
    JSON.stringify("./" + helper + ".mjs"),
    JSON.stringify(pathToFileURL(path.resolve("qa", helper + ".mjs")).href),
  );
const prefixStart = generated.indexOf("const root = process.cwd(),"),
  prefixEnd = generated.indexOf("let app,");
assert.ok(prefixStart >= 0 && prefixEnd > prefixStart);
const prefix = `
import {createHash} from 'node:crypto';
import {launchPreparedNative} from ${JSON.stringify(pathToFileURL(path.resolve("qa/prepared-native.mjs")).href)};
import {qualifiedElectron} from ${JSON.stringify(pathToFileURL(path.resolve("qa/release-runtime.mjs")).href)};
const root=${JSON.stringify(root)},stamp=${stamp},sourceRoot=${JSON.stringify(sourceRoot)},data=${JSON.stringify(data)},out=${JSON.stringify(out)};
await fs.mkdir(data,{recursive:true});
const sourceFiles=[];
async function collect(directory){for(const item of await fs.readdir(path.join(sourceRoot,directory),{withFileTypes:true})){assert.equal(item.isSymbolicLink(),false);const file=path.join(directory,item.name);if(item.isDirectory())await collect(file);else if(file.endsWith('.cjs'))sourceFiles.push(file);}}
await collect('desktop');assert.ok(sourceFiles.length<256);
sourceFiles.push('dist/index.html');const html=await fs.readFile(path.join(sourceRoot,'dist/index.html'),'utf8');for(const asset of new Set(html.match(/assets\\/[A-Za-z0-9._-]+\\.(?:js|css)/g)||[]))sourceFiles.push('dist/'+asset);
async function sourceHashes(){return Object.fromEntries(await Promise.all(sourceFiles.sort().map(async file=>{const bytes=await fs.readFile(path.join(sourceRoot,file));assert.ok(bytes.length<32*1024*1024);return[file,createHash('sha256').update(bytes).digest('hex')];})));}
const beforeSources=await sourceHashes(),runtime=await qualifiedElectron(),candidate={sourceDigest:'native-source-graph:'+createHash('sha256').update(JSON.stringify(beforeSources)).digest('hex')};
`;
generated =
  generated.slice(0, prefixStart) + prefix + generated.slice(prefixEnd);
const launchStart = generated.indexOf(
    "  report.initialization = await launchQualifiedPackage({",
  ),
  launchEnd = generated.indexOf("  const ordinaryUI =", launchStart);
assert.ok(launchStart >= 0 && launchEnd > launchStart);
generated =
  generated.slice(0, launchStart) +
  `
  report.sourceMode=true;report.sourceRoot=sourceRoot;report.selectedSources=beforeSources;report.initialization={initializedNativeKeyPrecondition:true,freshCredentialCrash:false};
  app=await launchPreparedNative({executablePath:runtime.executablePath,args:[path.join(sourceRoot,'desktop/main.cjs')],env:{...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:data,ACIRA_BROWSER_TEST_HIDDEN:'1',LOCALAPPDATA:path.join(data,'empty-import-sources')}});
` +
  generated.slice(launchEnd);
const checkStart = generated.indexOf("  const current = await qualifyPackage("),
  checkEnd = generated.indexOf('  report.status = "PASS";', checkStart);
assert.ok(checkStart >= 0 && checkEnd > checkStart);
generated = generated.slice(0, checkStart) + generated.slice(checkEnd);
assert.equal(generated.split("} finally {").length, 2);
generated = generated.replace(
  "} finally {",
  `} finally {
  try{assert.deepEqual(await sourceHashes(),beforeSources);report.selectedSourcesStable=true;}catch(error){report.status='SOURCE_CHANGED';report.coherenceError=error.message;process.exitCode=1;}
`,
);
generated = generated.replace(
  "Actual qualified portable private-window close",
  "Actual source product private-window close",
);
assert.doesNotMatch(generated, /await launchQualifiedPackage\(/);
assert.doesNotMatch(generated, /await qualifyPackage\(/);
const script = path.join(out, "native.mjs");
await fs.writeFile(script, generated);
await fs.writeFile(
  path.join(out, "provenance.json"),
  JSON.stringify(
    {
      fixtureSha256: createHash("sha256").update(fixture).digest("hex"),
      generatedSha256: createHash("sha256").update(generated).digest("hex"),
      sourceRoot,
      adaptations: [
        "Use the existing initialized-key native source launcher only",
        "Fingerprint all native CJS and actual renderer assets before and after even failing runs",
        "Keep original unretained-worker/close/held-response/ordinary-profile controls unchanged",
      ],
    },
    null,
    2,
  ),
);
if (process.argv.includes("--prepare-only")) {
  console.log(
    JSON.stringify({ status: "PREPARED_ONLY", nativeLaunches: 0, script, out }),
  );
  process.exit(0);
}
await import(pathToFileURL(script).href);
