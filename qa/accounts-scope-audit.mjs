import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const native = await build({
  entryPoints: ["desktop/accounts/setup.cjs"],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  metafile: true,
});
const renderer = await build({
  entryPoints: ["qa/accounts-renderer.tsx"],
  bundle: true,
  format: "iife",
  jsx: "automatic",
  outfile: "ui.js",
  write: false,
  metafile: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
const nativeInputs = Object.keys(native.metafile.inputs).sort(),
  rendererInputs = Object.keys(renderer.metafile.inputs).sort();
assert.deepEqual(nativeInputs, [
  "desktop/accounts/default-browser.cjs",
  "desktop/accounts/errors.cjs",
  "desktop/accounts/onboarding.cjs",
  "desktop/accounts/setup.cjs",
]);
const forbidden = [
  "supabase",
  "signInWithOtp",
  "refresh_token",
  "browser_sync_records",
  "ACIRA_BROWSER_SUPABASE",
  "acira:accounts",
  "AccountPanel",
];
const emitted = [...native.outputFiles, ...renderer.outputFiles]
  .map((file) => file.text)
  .join("\n");
for (const marker of forbidden)
  assert.equal(
    emitted.includes(marker),
    false,
    "withdrawn product marker: " + marker,
  );
assert.equal(
  rendererInputs.some((file) =>
    /provider\.cjs|sync\.cjs|AccountPanel/.test(file),
  ),
  false,
);
const out = path.resolve("qa/artifacts/accounts-scope-" + Date.now());
await fs.mkdir(out, { recursive: true });
const result = {
  nativeInputs,
  rendererInputs,
  forbiddenCloudMarkersAbsent: true,
  unusedNativeVaultNotInSetupGraph: true,
  nativeSha256: createHash("sha256")
    .update(native.outputFiles[0].contents)
    .digest("hex"),
  rendererSha256: createHash("sha256")
    .update(
      renderer.outputFiles.find((file) => file.path.endsWith(".js")).contents,
    )
    .digest("hex"),
};
await fs.writeFile(
  path.join(out, "result.json"),
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify(
    { nativeInputs, forbiddenCloudMarkersAbsent: true, artifacts: out },
    null,
    2,
  ),
);
