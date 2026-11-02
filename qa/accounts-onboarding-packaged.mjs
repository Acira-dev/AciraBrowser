import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { selectQualifiedPackages } from "./accounts-qualified-packages.mjs";

// Preserve the existing real ten-step setup journey; replace only standalone
// launch/provenance, product-owned SQLite seed imports and portable status copy.
const root = process.cwd(),
  stamp = Date.now(),
  out = path.resolve("qa/artifacts/accounts-onboarding-packaged-" + stamp),
  directory = path.resolve(
    ".qa-profiles/accounts-onboarding-packaged-" + stamp,
  ),
  upgraded = directory + "-existing",
  prepareOnly = process.argv.includes("--prepare-only"),
  { candidates, rejected } = await selectQualifiedPackages({ root, limit: 1 }),
  candidate = candidates[0];
await fs.mkdir(out, { recursive: true });
if (!candidate) {
  const result = {
    status: "NOT_RUN",
    nativeLaunches: 0,
    reason: "No fully qualified current-runtime portable",
    rejected,
  };
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ ...result, out }));
  process.exitCode = 2;
} else {
  const fixturePath = path.resolve("qa/accounts-integrated.mjs"),
    fixture = await fs.readFile(fixturePath, "utf8"),
    sha = (bytes) => createHash("sha256").update(bytes).digest("hex"),
    fixtureSha256 = sha(fixture),
    productRoot = path.join(
      path.dirname(candidate.executable),
      "resources/app",
    ),
    metadata = JSON.parse(
      await fs.readFile(path.join(productRoot, "package.json"), "utf8"),
    );
  assert.equal(
    fixtureSha256,
    "e2a7179171c3923dd6d149fe4488c36a47719a0daf27a2f7a5d88e328d3f17c5",
    "Review changed owner journey before adapting",
  );
  let generated = fixture;
  const replaceOnce = (before, after) => {
    assert.equal(
      generated.split(before).length,
      2,
      "Exact source anchor: " + before,
    );
    generated = generated.replace(before, after);
  };
  replaceOnce(
    'import { launchPreparedNative } from "./prepared-native.mjs";',
    "",
  );
  replaceOnce('import { qualifiedElectron } from "./release-runtime.mjs";', "");
  replaceOnce(
    '"./native-helpers.mjs"',
    JSON.stringify(pathToFileURL(path.resolve("qa/native-helpers.mjs")).href),
  );
  const start = generated.indexOf(
      "const require = createRequire(import.meta.url),",
    ),
    end = generated.indexOf("\nlet app;", start);
  assert.ok(start >= 0 && end > start);
  const prefix = `
import {_electron} from 'playwright';
import {qualifyPackage,launchQualifiedPackage} from ${JSON.stringify(pathToFileURL(path.resolve("qa/accounts-qualified-packages.mjs")).href)};
import {initializeReleaseProfile} from ${JSON.stringify(pathToFileURL(path.resolve("qa/release-initialize-profile.mjs")).href)};
const root=${JSON.stringify(root)},run=${stamp},directory=${JSON.stringify(directory)},upgraded=${JSON.stringify(upgraded)},out=${JSON.stringify(out)},packageCandidate=${JSON.stringify(candidate)},productVersion=${JSON.stringify(metadata.version)};
const require=createRequire(import.meta.url),{BrowserDatabase}=require(${JSON.stringify(path.join(productRoot, "desktop/database.cjs"))}),{createInitialState}=require(${JSON.stringify(path.join(productRoot, "desktop/runtime.cjs"))});
await fs.mkdir(directory,{recursive:true});await fs.mkdir(upgraded,{recursive:true});
const checks=[],defects=[],errors=[],profileInitializations=[],actualPackages=[];
async function setupSourceHashes(){const current=await qualifyPackage({root,reportName:packageCandidate.report});assert.equal(current.sourceDigest,packageCandidate.sourceDigest);assert.equal(current.reportSha256,packageCandidate.reportSha256);return{sourceDigest:current.sourceDigest,packageManifestSha256:current.packageManifestSha256,nativeReportSha256:current.reportSha256};}
const localSetupSources=await setupSourceHashes(),runtime={qualification:packageCandidate.runtimeQualification};
let app;
`;
  generated =
    generated.slice(0, start) +
    prefix +
    generated.slice(end + "\nlet app;".length);
  const launchStart = generated.indexOf("  app = await launchPreparedNative({"),
    launchEnd = generated.indexOf("  const page = await poll(", launchStart);
  assert.ok(launchStart >= 0 && launchEnd > launchStart);
  generated =
    generated.slice(0, launchStart) +
    `
  profileInitializations.push(await launchQualifiedPackage({root,candidate:packageCandidate,launch:options=>initializeReleaseProfile({candidate:path.join(path.dirname(options.executablePath),'resources/app'),data,executablePath:options.executablePath,packaged:true})}));
  app=await launchQualifiedPackage({root,candidate:packageCandidate,launch:options=>_electron.launch(options),options:{args:[],env:{...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:data,ACIRA_BROWSER_TEST_HIDDEN:'1',ACIRA_MATERIAL:'none',LOCALAPPDATA:path.join(data,'empty-import-sources')},timeout:30000}});
  const actualPackage=await app.evaluate(({app})=>({packaged:app.isPackaged,version:app.getVersion(),exe:app.getPath('exe'),appPath:app.getAppPath(),electron:process.versions.electron,chromium:process.versions.chrome}));
  assert.equal(actualPackage.packaged,true);assert.equal(actualPackage.version,productVersion);assert.equal(actualPackage.electron,packageCandidate.runtimeQualification.version);assert.equal(actualPackage.chromium,packageCandidate.runtimeQualification.qualification.chromium);assert.equal(path.resolve(actualPackage.exe).toLowerCase(),path.resolve(packageCandidate.executable).toLowerCase());assert.equal(path.resolve(actualPackage.appPath).toLowerCase(),path.join(path.dirname(packageCandidate.executable),'resources/app').toLowerCase());actualPackages.push(actualPackage);
` +
    generated.slice(launchEnd);
  replaceOnce(
    "assert.match(defaultStatus.defaults.note, /Install Acira/);",
    "assert.match(defaultStatus.defaults.note, /Windows registration for this copy is not confirmed/);",
  );
  replaceOnce(
    '"fresh installed-graph setup mounts and hides native website views"',
    '"fresh standalone local setup mounts and hides native website views"',
  );
  replaceOnce(
    '"actual native setup uses the registration-aware helper and honestly discloses development default-browser limits"',
    '"actual portable setup honestly discloses unconfirmed registration without requesting OS defaults"',
  );
  replaceOnce(
    "  assert.deepEqual(errors, []);",
    "  assert.deepEqual(errors, []);\n  assert.deepEqual(defects, [], 'No setup interaction defect may be promoted');\n  assert.equal(checks.length,10);\n  assert.equal(actualPackages.length,4);",
  );
  const identityStart = generated.indexOf(
      '  const identity = createHash("sha256")',
    ),
    identityEnd = generated.indexOf("  await fs.writeFile(", identityStart);
  assert.ok(identityStart >= 0 && identityEnd > identityStart);
  generated =
    generated.slice(0, identityStart) +
    "  const identity=packageCandidate.packageManifestSha256;\n" +
    generated.slice(identityEnd);
  replaceOnce(
    "        initializedNativeKeyPrecondition: true,",
    "        initializedNativeKeyPrecondition: true,\n        standalonePackage:true,profileInitializations,actualPackages,packageSource:packageCandidate.sourceDigest,packageManifestSha256:packageCandidate.packageManifestSha256,",
  );
  replaceOnce(
    '"Actual setup/profile UI with native key normally initialized before the functional fixture; bare fresh-key startup and credential crash are separate tests"',
    '"Actual fully qualified standalone setup/profile UI; complete launch gate before every initializer and functional launch, four actual own-exe/resources checks. Native-key initialization is explicit; fresh-credential crash, installed migration and real provider sign-in remain separate."',
  );
  assert.doesNotMatch(generated, /await launchPreparedNative\(/);
  assert.doesNotMatch(generated, /src\/features\/onboarding\/Onboarding\.tsx/);
  const script = path.join(out, "native.mjs");
  await fs.writeFile(script, generated);
  await promisify(execFile)(process.execPath, ["--check", script]);
  await fs.writeFile(
    path.join(out, "provenance.json"),
    JSON.stringify(
      {
        fixturePath,
        fixtureSha256,
        generatedSha256: sha(generated),
        candidate,
        adaptations: [
          "Four functional launches use actual qualified standalone and own resources/executable/version/runtime checks",
          "Full payload/policy gate independently before each initialization and functional launch, and after journey",
          "Existing-installation SQLite seed uses actual packaged database/runtime modules",
          "Portable unregistered status requires its actual native note; focus defects and exact ten groups are mandatory",
          "All original UI/profile/resume/Skip/existing-data interactions remain",
        ],
        prepareOnly,
      },
      null,
      2,
    ),
  );
  if (prepareOnly)
    console.log(
      JSON.stringify({
        status: "PREPARED_ONLY",
        nativeLaunches: 0,
        candidateSource: candidate.sourceDigest,
        out,
      }),
    );
  else await import(pathToFileURL(script).href);
}
