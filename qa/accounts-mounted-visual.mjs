import { _electron } from "playwright";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { poll } from "./native-helpers.mjs";

const root = process.cwd(),
  run = Date.now(),
  data = path.join(root, ".qa-profiles/accounts-mounted-" + run),
  out = path.join(root, "qa/artifacts/accounts-mounted-" + run);
await fs.mkdir(data, { recursive: true });
await fs.mkdir(out, { recursive: true });
const model = await build({
  stdin: {
    contents:
      "export{appearancePalettes}from'./src/runtime/appearancePalettes';export{contrast}from'./src/ui/colorMath';",
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
});
const module = { exports: {} };
new Function("module", "exports", model.outputFiles[0].text)(
  module,
  module.exports,
);
const { appearancePalettes, contrast } = module.exports;
const hex = (css) => {
  const match = css.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/);
  assert.ok(match, "computed RGB color: " + css);
  return (
    "#" +
    match
      .slice(1, 4)
      .map((value) => Number(value).toString(16).padStart(2, "0"))
      .join("")
  );
};
const checks = [],
  failures = [];
let app;
try {
  app = await _electron.launch({
    executablePath:
      process.env.ACIRA_TEST_EXECUTABLE ||
      path.join(root, "node_modules/electron/dist/electron.exe"),
    args: [path.join(root, "desktop/main.cjs")],
    env: {
      ...process.env,
      ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data,
      ACIRA_BROWSER_TEST_HIDDEN: "1",
      ACIRA_MATERIAL: "none",
    },
    timeout: 30000,
  });
  const page = await poll(
    async () => {
      for (const page of app.context().pages())
        try {
          if (await page.evaluate(() => !!window.acira?.setup)) return page;
        } catch {}
    },
    Boolean,
    "mounted local setup",
    15000,
  );
  await page
    .getByRole("heading", { name: "The web, in clear light.", exact: true })
    .waitFor();
  await app.evaluate(({ BaseWindow }) => {
    for (const window of BaseWindow.getAllWindows())
      window.setBounds({ ...window.getBounds(), width: 900, height: 680 });
  });
  for (const palette of appearancePalettes)
    for (const dark of [false, true]) {
      try {
        await page.evaluate(
          (patch) => window.acira.dispatch({ type: "settings.update", patch }),
          {
            colorPreset: palette.name,
            browserTint: palette.tint,
            accentColor: palette.accent,
            appearance: dark ? "dark" : "light",
            glassOpacity: 100,
            reducedTransparency: true,
            reducedMotion: true,
          },
        );
        await page.waitForTimeout(90);
        const actual = await page
          .locator(".acira-onboarding")
          .evaluate((element) => {
            const app = element.closest(".app"),
              card = element.querySelector(".onboarding-card");
            const images = [
              ...element.querySelectorAll(".onboarding-brand img"),
            ].filter(
              (image) =>
                image.getClientRects().length &&
                getComputedStyle(image).display !== "none",
            );
            return {
              surfaceTone: app.dataset.theme,
              visibleImages: images.map((image) => ({
                src: image.getAttribute("src"),
                complete: image.complete,
                width: image.naturalWidth,
                renderedWidth: image.getBoundingClientRect().width,
              })),
              color: getComputedStyle(element).color,
              background: getComputedStyle(card).backgroundColor,
              overflow: element.scrollWidth > element.clientWidth + 1,
              width: element.getBoundingClientRect().width,
            };
          });
        assert.equal(actual.visibleImages.length, 1);
        assert.ok(["light", "dark"].includes(actual.surfaceTone));
        const image = actual.visibleImages[0];
        assert.equal(image.complete, true);
        assert.ok(image.width > 0);
        assert.ok(image.renderedWidth >= 100 && image.renderedWidth <= 180);
        assert.equal(
          image.src.endsWith("acira-logo-light.svg"),
          actual.surfaceTone === "dark",
          "wordmark follows actual surface, not selected appearance",
        );
        const ratio = contrast(hex(actual.color), hex(actual.background));
        assert.ok(ratio >= 4.5, "local setup body contrast " + ratio);
        assert.equal(actual.overflow, false);
        checks.push({
          palette: palette.name,
          appearance: dark ? "dark" : "light",
          ...actual,
          contrast: ratio,
        });
      } catch (error) {
        failures.push({
          palette: palette.name,
          appearance: dark ? "dark" : "light",
          error: error.message,
        });
      }
    }
  assert.equal(
    await app.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows().every((window) => !window.isVisible()),
    ),
    true,
  );
  const assets = {};
  for (const name of [
    "acira-logo.svg",
    "acira-logo-light.svg",
    "acira-symbol.svg",
  ])
    assets[name] = createHash("sha256")
      .update(await fs.readFile(path.join(root, "public", name)))
      .digest("hex");
  await fs.writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        kind: "actual mounted theme/brand/contrast/geometry checks; opaque mode, no material screenshot claim",
        checks,
        failures,
        assets,
        nativeRendererIdentity: createHash("sha256")
          .update(await fs.readFile(path.join(root, "desktop/main.cjs")))
          .update(await fs.readFile(path.join(root, "dist/index.html")))
          .digest("hex"),
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      { passed: checks.length, failures, artifacts: out },
      null,
      2,
    ),
  );
  assert.deepEqual(failures, []);
} finally {
  await app?.close().catch(() => {});
}
