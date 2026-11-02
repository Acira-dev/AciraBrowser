// Founder rule (26 Oct): profile avatars never get a decorative outer ring, anywhere. Keyboard focus rings on the
// parent control are fine; a ring drawn around the avatar itself is not.
// The ONE exception (R3-02, founder 26 Oct, Round 3): the setup "Name this profile" step draws the chosen profile colour
// as a border hugging the avatar picture (no gap). It lives in exactly one rule, `.fr-profile .fr-profile-avatar` in
// src/features/onboarding/onboarding.css, and is driven by `--fr-profile-color` set on `.fr-profile` in steps.tsx.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const SETUP_CSS = path.join('src', 'features', 'onboarding', 'onboarding.css');
/** The single allowed place: the setup profile step's avatar. */
const allowed = (file, selector) => file === SETUP_CSS && /^\.fr-profile( span)?\.fr-profile-avatar$|^\.fr-profile \.fr-profile-avatar$/.test(selector.replace(/\s+/g, ' ').trim());

test('ProfileAvatar has no ring option', () => {
  const source = read('src/features/accounts/profileModel.tsx');
  assert.doesNotMatch(source, /\bring\s*[?:=]/, 'ProfileAvatar must not accept a ring prop');
  assert.doesNotMatch(source, /data-ring|--pa-ring/);
});

const stylesheets = () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (rel.endsWith('.css')) files.push(rel);
    }
  };
  walk('src');
  return files;
};

test('no stylesheet draws a ring around an avatar (except the one setup rule)', () => {
  for (const file of stylesheets()) {
    for (const rule of stripComments(read(file)).split('}')) {
      const [selector = '', body = ''] = rule.split('{');
      if (!/avatar|profile-photo/.test(selector) || /:focus/.test(selector)) continue;
      if (allowed(file, selector)) continue;
      assert.doesNotMatch(body, /outline\s*:\s*[^;]*solid|outline-offset\s*:\s*[1-9]/, `${file}: ${selector.trim()} draws an outer ring`);
      assert.doesNotMatch(body, /box-shadow\s*:[^;]*\b0 0 0 [1-9][^;]*,\s*0 0 0 /, `${file}: ${selector.trim()} draws a double ring`);
      assert.doesNotMatch(body, /(^|[;\s])border(-color)?\s*:\s*[^;]*(solid|var\(--)/, `${file}: ${selector.trim()} draws a border ring`);
    }
  }
});

test('the profile colour ring exists on the setup profile step avatar, and only there', () => {
  // It hugs the picture: a border on the avatar itself, inside its box, in the profile colour.
  const css = stripComments(read(SETUP_CSS));
  const bodies = css
    .split('}')
    .map((part) => part.split('{'))
    .filter(([selector, body]) => body !== undefined && selector.replace(/\s+/g, ' ').trim() === '.fr-profile .fr-profile-avatar')
    .map(([, body]) => body);
  // R4-03 (founder, 27 Oct): the first ring hugged the picture at 3px and was too faint. It is now a deliberate ring: an outline
  // 3px thick with a gap (outline-offset) of 3-6px between the picture and the ring.
  const body = bodies.find((text) => /outline\s*:/.test(text));
  assert.ok(body, 'setup css must draw the profile colour as a ring on .fr-profile .fr-profile-avatar');
  assert.match(body, /outline\s*:\s*[2-5]px solid var\(--fr-profile-color/);
  assert.match(body, /outline-offset\s*:\s*[3-6]px/, 'a small gap between the photo and the ring');
  assert.doesNotMatch(body, /border\s*:|margin|padding/, 'the ring is an outline: the picture keeps its 72px box');
  // Nothing else in the app reads the ring colour.
  const users = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'upstream') walk(rel); }
      else if (/\.(css|tsx?)$/.test(entry.name) && read(rel).includes('--fr-profile-color')) users.push(rel.split(path.sep).join('/'));
    }
  };
  walk('src');
  assert.deepStrictEqual(users.sort(), ['src/features/onboarding/onboarding.css', 'src/features/onboarding/steps.tsx']);
});
