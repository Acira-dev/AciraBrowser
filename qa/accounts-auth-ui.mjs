import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const root = process.cwd(),
  component = path.resolve(
    process.env.ACIRA_AUTH_UI_CANDIDATE || "src/features/WebsiteAuthDialog.tsx",
  );
const fixture = await fs.readFile("qa/accounts-http-auth-ui.mjs", "utf8");
const fixtureSha256 = createHash("sha256").update(fixture).digest("hex");
const relativeComponent = path
  .relative(root, component)
  .replaceAll(path.sep, "/");
assert.ok(!relativeComponent.startsWith(".."));
let generated = fixture.replace(
  '"./src/features/WebsiteAuthDialog"',
  JSON.stringify("./" + relativeComponent),
);
assert.notEqual(generated, fixture);
const extra = `
  await dialog.waitFor({state:"detached"});
  await page.evaluate(()=>window.showAuth("origin-before-proxy"));await username.waitFor();
  await username.fill("origin-only-user");await password.fill("origin-only-secret");
  await page.evaluate(()=>window.showAuth("proxy-visible",{kind:"proxy",origin:"http://127.0.0.1:49124",destinationOrigin:"https://destination.fixture",realm:"Explicit proxy realm",insecure:true}));
  await page.getByRole("heading",{name:"Sign in to this proxy",exact:true}).waitFor();
  await page.getByText("Proxy sign-in",{exact:true}).waitFor();
  await page.getByText("http://127.0.0.1:49124",{exact:true}).waitFor();
  await page.getByText("https://destination.fixture",{exact:true}).waitFor();
  await page.getByText("This proxy connection uses unencrypted HTTP.",{exact:true}).waitFor();
  assert.equal(await username.inputValue(),"");assert.equal(await password.inputValue(),"");
  assert.equal(await page.getByText("This site uses an unencrypted HTTP connection.",{exact:true}).count(),0);
  await page.screenshot({path:path.join(out,"proxy-dark-narrow.png")});
  await page.getByRole("button",{name:"Cancel",exact:true}).click();await dialog.waitFor({state:"detached"});
  checks.push("proxy challenge explicitly separates proxy endpoint/destination, identifies HTTP proxy transport and never reuses origin fields");
`;
const marker = "  assert.deepEqual(errors, []);";
assert.equal(generated.split(marker).length, 2);
generated = generated.replace(marker, extra + marker);
const out = path.join(root, "qa/artifacts/accounts-auth-ui-" + Date.now());
await fs.mkdir(out, { recursive: true });
const script = path.join(out, "ui.mjs");
await fs.writeFile(script, generated);
await fs.writeFile(
  path.join(out, "provenance.json"),
  JSON.stringify(
    {
      component,
      componentSha256: createHash("sha256")
        .update(await fs.readFile(component))
        .digest("hex"),
      cssSha256: createHash("sha256")
        .update(
          await fs.readFile(
            path.join(path.dirname(component), "website-auth.css"),
          ),
        )
        .digest("hex"),
      fixtureSha256,
      sourceFilesModified: false,
    },
    null,
    2,
  ),
);
console.log("Source proxy UI provenance: " + out);
await import(pathToFileURL(script).href);
