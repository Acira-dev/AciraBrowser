import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const root = process.cwd(), broker = path.resolve(process.env.ACIRA_AUTH_DISPATCHER_CANDIDATE || "qa/artifacts/accounts-auth-dispatcher-candidate-20261024/website-auth-next.cjs");
const out = path.join(root, "qa/artifacts/accounts-auth-origin-candidate-" + Date.now());
await fs.mkdir(out, { recursive: true });
if ((await fs.readFile("desktop/main.cjs", "utf8")).includes("website-auth.cjs")) {
  await fs.writeFile(path.join(out, "result.json"), JSON.stringify({ status: "NOT_RUN", nativeLaunches: 0, reason: "Product auth now owns login; do not attach another QA dispatcher" }, null, 2));
  console.log("NOT_RUN: product auth owns login; use actual integrated QA");
  process.exit(2);
}
const manifest = JSON.parse(await fs.readFile("docs/workstreams/accounts-http-auth-ready.json", "utf8")), fixture = await fs.readFile("qa/accounts-http-auth.mjs", "utf8");
assert.equal(createHash("sha256").update(fixture).digest("hex"), manifest.hashes["qa/accounts-http-auth.mjs"]);
const relativeBroker = path.relative(root, broker).replaceAll(path.sep, "/");
assert.ok(!relativeBroker.startsWith(".."));
let generated = fixture.replaceAll('"desktop/website-auth.cjs"', JSON.stringify(relativeBroker));
generated = generated.replace('"./native-helpers.mjs"', JSON.stringify(pathToFileURL(path.join(root, "qa/native-helpers.mjs")).href));
const marker = "  await app.evaluate(({ app }) => {";
assert.equal(generated.split(marker).length, 2);
generated = generated.replace(marker, '  assert.equal(await app.evaluate(({app})=>app.listenerCount("login")),0,"Product auth must not acquire a second dispatcher");\n' + marker);
const script = path.join(out, "native.mjs");
await fs.writeFile(script, generated);
await fs.writeFile(path.join(out, "provenance.json"), JSON.stringify({ broker, brokerSha256: createHash("sha256").update(await fs.readFile(broker)).digest("hex"), frozenOriginFixtureSha256: manifest.hashes["qa/accounts-http-auth.mjs"], sourceFilesModified: false }, null, 2));
console.log("Staged origin regression provenance: " + out);
await import(pathToFileURL(script).href);
