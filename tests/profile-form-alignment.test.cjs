"use strict";
// Settings › Profiles, R5 founder note: "make the new profile thing more aligned". The new-profile form sits on the list's
// grid: its avatar in the rows' avatar column (same 32px), its name / colors / Create + Cancel on the rows' text column,
// its divider over the same span as the list's dividers. Also: the importer reports which sources are already imported,
// so "Bring in another account" never offers one twice.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
/** The declarations of the rule whose selector list is exactly `selector` (whitespace-insensitive). */
function rule(css, selector) {
  const want = selector.replace(/\s+/g, " ").trim();
  for (const match of strip(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].replace(/\s+/g, " ").trim() !== want) continue;
    const decls = {};
    for (const part of match[2].split(";")) {
      const at = part.indexOf(":");
      if (at > 0) decls[part.slice(0, at).trim()] = part.slice(at + 1).trim();
    }
    return decls;
  }
  assert.fail(`no rule for ${selector}`);
}
const px = (value) => Number(/^(-?\d+(?:\.\d+)?)px$/.exec(String(value).trim())?.[1]);

const css = read("src/features/accounts/profile-manager.css");
const settings = read("src/features/settings/settings.css");
const tsx = read("src/features/accounts/ProfileManager.tsx");
const suggestions = read("src/features/accounts/ProfileSuggestions.tsx");
const tokens = rule(css, ":is(.pm-row, .pm-create)");

test("rows and the form share one grid: a 32px avatar column and a 12px step to the text column", () => {
  assert.equal(tokens["--pm-avatar"], "32px");
  assert.equal(tokens["--pm-gap"], "12px");
  assert.equal(rule(css, ".pm-row").gap, "var(--pm-gap) !important");
  const add = rule(css, ".pm-add-icon");
  assert.equal(add.width, "var(--pm-avatar)");
  assert.equal(add.height, "var(--pm-avatar)");
  const form = rule(css, ".pm-create");
  assert.equal(form.display, "grid");
  assert.match(form["grid-template-columns"], /^var\(--pm-avatar\)\s+minmax\(0, 1fr\)$/);
  assert.equal(form["column-gap"], "var(--pm-gap)");
});

test("the form's columns start where the rows' do: same 12px bleed, same 12px inner edge", () => {
  const row = rule(settings, ".st-row");
  const form = rule(css, ".pm-create");
  assert.equal(row.margin, "0 -12px");
  assert.equal(form.margin, "0 -12px", "the form bleeds like a row, so its avatar column starts at the rows' avatar x");
  const [, rowX] = row.padding.split(/\s+/);
  const [, formX] = form.padding.split(/\s+/);
  assert.equal(px(formX), px(rowX), "the form's inner edge equals a row's");
});

test("the divider above the form spans the list's divider span, never the 12px hover bleed", () => {
  const line = rule(css, ".pm-create::before");
  assert.equal(line.left, "12px");
  assert.equal(line.right, "12px");
  assert.equal(line.height, "1px");
  assert.match(line.background, /var\(--divider/);
  const panels = read("src/styles/panels.css");
  assert.match(panels, /\.st-row \+ \.st-row[^{]*\)::before \{\s*left: 12px;\s*right: 12px;/, "the list's dividers are inset 12px too");
  assert.doesNotMatch(tsx, /className="pm-editor pm-create"/, "the form no longer borrows the editor's full-bleed rule");
});

test("the preview avatar is the rows' size and sits centred on the name field", () => {
  const create = tsx.slice(tsx.indexOf("function CreateProfile"));
  assert.match(create, /<ProfileAvatar name=\{name\} color=\{chosen\} size=\{32\} \/>/, "live initial and colour, 32px like the rows");
  assert.doesNotMatch(create, /size=\{56\}/);
  assert.match(tsx, /<ProfileAvatar\s+size=\{32\}/, "the rows are 32px");
  assert.match(suggestions, /<ProfileAvatar\s+size=\{32\}/, "suggestions are 32px");
  const input = rule(settings, ".st-input, .bs-row > input, input[type='text'], input:not([type]), input[type='url']");
  assert.equal(input.height, tokens["--pm-input"], "--pm-input is the Settings field height");
  assert.match(input.border, new RegExp(`^${tokens["--pm-input-edge"]} solid`), "--pm-input-edge is the field's border (content-box, so it adds to the height)");
  const face = rule(css, ".pm-create-face");
  assert.equal(face["margin-top"], "calc(var(--pm-label-line) + var(--pm-label-gap) + (var(--pm-input) + 2 * var(--pm-input-edge) - var(--pm-avatar)) / 2)");
  const offset = px(tokens["--pm-label-line"]) + px(tokens["--pm-label-gap"]) + (px(tokens["--pm-input"]) + 2 * px(tokens["--pm-input-edge"]) - px(tokens["--pm-avatar"])) / 2;
  assert.equal(offset, 21, "label 16 + gap 6 + (28 + 2 - 32) / 2: the avatar's centre on the field's centre (measured in qa/pm-suggestions-capture.mjs)");
});

test("name, colors and Create / Cancel all start on the text column, one rhythm apart", () => {
  const create = tsx.slice(tsx.indexOf("function CreateProfile"));
  const face = create.indexOf('className="pm-create-face"'), body = create.indexOf('className="pm-create-body"');
  assert.ok(face > 0 && body > face, "avatar column, then the body column");
  const inBody = create.slice(body);
  for (const piece of ['className="pm-field"', "<Swatches", 'className="pm-actions"', 'className="st-button primary"']) assert.ok(inBody.includes(piece), `${piece} is in the body column`);
  assert.ok(inBody.indexOf('className="st-button primary"') < inBody.indexOf('className="st-button pm-quiet"'), "Create (primary) comes before Cancel");
  const reset = rule(css, ".pm-create .pm-swatches,\n.pm-create .pm-actions");
  assert.equal(reset.margin, "0", "no leftover editor offset on the colors or the buttons");
  assert.equal(rule(css, ".pm-create-body").gap, "var(--pm-rhythm)");
  assert.equal(rule(css, ".pm-create").padding.split(/\s+/)[0], "var(--pm-rhythm)");
});

test("swatch focus uses the button focus colour from buttons.css; selection keeps the accent ring", () => {
  assert.match(read("src/styles/buttons.css"), /--btn-focus:/);
  const focus = rule(css, ".pm-swatch:has(input:focus-visible) > span[aria-hidden]");
  assert.match(focus["outline-color"], /^var\(--btn-focus/);
  assert.match(rule(css, ".pm-swatch:has(input:checked) > span[aria-hidden]")["outline-color"], /--st-accent/);
});

test("suggestion avatars wear their browser's icon on the avatar column", () => {
  const face = rule(css, ".pm-suggest-face");
  assert.equal(face.width, "var(--pm-avatar)");
  assert.equal(face.height, "var(--pm-avatar)");
  assert.match(suggestions, /className="st-row st-profile pm-row pm-suggest"/, "the same row grammar as the list");
  assert.match(suggestions, /browserIconFor\(found\.icons, source\.browser\)/, "R4-53's real browser icons");
});

test("the importer reports sources any local profile still holds an import from", () => {
  const { createImporter } = require("../desktop/imports.cjs");
  const batches = {
    me: [{ id: "1", sourceId: "chrome-work" }, { id: "2", sourceId: "edge-home", undoneAt: 5 }, { id: "3", browser: "HTML" }],
    other: [{ id: "4", sourceId: "firefox" }, { id: "5", sourceId: "chrome-work" }],
    secret: [{ id: "6", sourceId: "brave" }],
  };
  const state = { activeBrowserProfileId: "me", browserProfiles: [{ id: "me" }, { id: "other" }, { id: "secret", private: true }] };
  const importer = createImporter({ database: { imports: (id) => batches[id] || [] }, getState: () => state, commit() {}, roots: [], firefoxRoots: [] });
  assert.deepEqual(importer.importedSourceIds().sort(), ["chrome-work", "firefox"]);
  assert.match(read("desktop/main.cjs"), /case 'imports\.discover':[^\n]*imported:importer\.importedSourceIds\(\)/);
});
