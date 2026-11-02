import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { selectQualifiedPackages } from "./accounts-qualified-packages.mjs";

// Reuse the actual-product journey, replacing only launch/provenance boundaries.
// Package selection and both native launch phases retain the complete safety gate.
const prepareOnly = process.argv.includes("--prepare-only");
const root = process.cwd(),
  stamp = Date.now(),
  out = path.resolve("qa/artifacts/accounts-auth-packaged-" + stamp),
  data = path.resolve(".qa-profiles/accounts-auth-packaged-" + stamp),
  fixturePath = path.resolve("qa/accounts-http-auth-integrated.mjs");
await fs.mkdir(out, { recursive: true });
const { candidates, rejected } = await selectQualifiedPackages({
    root,
    limit: 1,
  }),
  candidate = candidates[0];
let authBuilt = false;
if (candidate) {
  const appRoot = path.join(
    path.dirname(candidate.executable),
    "resources/app",
  );
  try {
    const preload = await fs.readFile(
        path.join(appRoot, "desktop/ui-preload.cjs"),
        "utf8",
      ),
      html = await fs.readFile(path.join(appRoot, "dist/index.html"), "utf8"),
      scripts = [...new Set(html.match(/assets\/[A-Za-z0-9._-]+\.js/g) || [])],
      bodies = await Promise.all(
        scripts.map((file) =>
          fs.readFile(path.join(appRoot, "dist", file), "utf8"),
        ),
      );
    authBuilt =
      preload.includes("websiteAuth") &&
      bodies.some(
        (body) =>
          body.includes("Sign in to this site") && body.includes("websiteAuth"),
      );
  } catch {}
}
if (!candidate || (!authBuilt && !prepareOnly)) {
  const result = {
    status: "NOT_RUN",
    nativeLaunches: 0,
    reason:
      "Latest fully qualified portable does not contain coherent built product auth hooks",
    candidateSource: candidate?.sourceDigest,
    rejected,
  };
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ ...result, out }));
  process.exit(2);
}
const fixture = await fs.readFile(fixturePath, "utf8"),
  fixtureSha256 = createHash("sha256").update(fixture).digest("hex");
let generated = fixture;
for (const helper of [
  "prepared-native",
  "release-runtime",
  "release-local-setup",
  "native-helpers",
])
  generated = generated.replaceAll(
    JSON.stringify("./" + helper + ".mjs"),
    JSON.stringify(pathToFileURL(path.resolve("qa", helper + ".mjs")).href),
  );
generated = generated.replace(
  "import { launchPreparedNative }",
  "import { _electron }",
);
generated = generated.replace(
  JSON.stringify(pathToFileURL(path.resolve("qa/prepared-native.mjs")).href),
  '"playwright"',
);
const start = generated.indexOf("// Actual product main/IPC/UI only."),
  end = generated.indexOf("const password =");
assert.ok(start >= 0 && end > start, "Frozen source journey prefix must match");
const prefix = `
import {qualifyPackage,launchQualifiedPackage} from ${JSON.stringify(pathToFileURL(path.resolve("qa/accounts-qualified-packages.mjs")).href)};
import {initializeReleaseProfile} from ${JSON.stringify(pathToFileURL(path.resolve("qa/release-initialize-profile.mjs")).href)};
const root=${JSON.stringify(root)},run=${stamp},out=${JSON.stringify(out)},data=${JSON.stringify(data)},packageCandidate=${JSON.stringify(candidate)};
await fs.mkdir(data,{recursive:true});
const profileInitializations=[],actualPackages=[];
const hashes=async()=>{const current=await qualifyPackage({root,reportName:packageCandidate.report});assert.equal(current.sourceDigest,packageCandidate.sourceDigest);assert.equal(current.reportSha256,packageCandidate.reportSha256);return{sourceDigest:current.sourceDigest,packageManifestSha256:current.packageManifestSha256,nativeReportSha256:current.reportSha256};};
const before=await hashes(),checks=[],engines=[],traffic=[];
`;
generated = generated.slice(0, start) + prefix + generated.slice(end);
assert.equal(
  generated.split("const runtime = await qualifiedElectron();").length,
  2,
);
generated = generated.replace(
  "const runtime = await qualifiedElectron();",
  "const runtime={executablePath:packageCandidate.executable,qualification:packageCandidate.runtimeQualification};",
);
const launchStart = generated.indexOf("  app = await launchPreparedNative({"),
  launchEnd = generated.indexOf(
    "  const actual = await app.evaluate",
    launchStart,
  );
assert.ok(
  launchStart >= 0 && launchEnd > launchStart,
  "Frozen actual launch boundary must match",
);
generated =
  generated.slice(0, launchStart) +
  `
  profileInitializations.push(await launchQualifiedPackage({root,candidate:packageCandidate,launch:options=>initializeReleaseProfile({candidate:path.join(path.dirname(options.executablePath),'resources/app'),data,executablePath:options.executablePath,packaged:true})}));
  app=await launchQualifiedPackage({root,candidate:packageCandidate,launch:options=>_electron.launch(options),options:{args:[],env:{...process.env,ACIRA_QA_RUN:'1',ACIRA_BROWSER_TEST_DATA:data,ACIRA_BROWSER_TEST_HIDDEN:'1',ACIRA_MATERIAL:'none',LOCALAPPDATA:path.join(data,'empty-import-sources')}}});
  const actualPackage=await app.evaluate(({app})=>({packaged:app.isPackaged,exe:app.getPath('exe'),appPath:app.getAppPath()}));assert.equal(actualPackage.packaged,true);assert.equal(path.resolve(actualPackage.exe).toLowerCase(),path.resolve(packageCandidate.executable).toLowerCase());assert.equal(path.resolve(actualPackage.appPath).toLowerCase(),path.join(path.dirname(packageCandidate.executable),'resources/app').toLowerCase());actualPackages.push(actualPackage);
` +
  generated.slice(launchEnd);
generated = generated.replace(
  "    initializedNativeKeyPrecondition: true,",
  "    initializedNativeKeyPrecondition: true,\n    standalonePackage:true,profileInitializations,actualPackages,packageSource:packageCandidate.sourceDigest,packageManifestSha256:packageCandidate.packageManifestSha256,",
);
generated = generated.replace(
  "Actual working product main/IPC/form with explicitly initialized native key; no fresh-key/crash, real router/provider credential or immutable-package claim",
  "Actual fully qualified standalone executable and product auth dialog; complete payload/runtime/withdrawal gate before initializer and functional launch; no fresh-credential crash, router/provider or installed-path claim",
);
assert.doesNotMatch(generated, /launchPreparedNative\(/);
assert.doesNotMatch(generated, /src\/App\.tsx/);
assert.equal(generated.split("standalonePackage:true").length, 2);
assert.ok(generated.includes("Actual fully qualified standalone executable"));
const script = path.join(out, "native.mjs");
await fs.writeFile(script, generated);
await fs.writeFile(
  path.join(out, "provenance.json"),
  JSON.stringify(
    {
      fixturePath,
      fixtureSha256,
      generatedSha256: createHash("sha256").update(generated).digest("hex"),
      candidate,
      prepareOnly,
      authBuilt,
      adaptations: [
        "Use actual standalone initializer and app executable only, with complete gate independently before each phase",
        "Package artifact provenance/full payload hashes replace unavailable working-tree TSX sources",
        "Retain all eight real product auth journey groups and initialized-key scope",
      ],
    },
    null,
    2,
  ),
);
if (prepareOnly) {
  console.log(
    JSON.stringify({
      status: "PREPARED_ONLY",
      nativeLaunches: 0,
      authBuilt,
      script,
      out,
    }),
  );
  process.exit(0);
}
await import(pathToFileURL(script).href);
