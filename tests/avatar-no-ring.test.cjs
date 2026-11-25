// Founder rule (26 Oct): profile avatars never get a decorative outer ring, anywhere. Keyboard focus rings on the
// parent control are fine; a ring drawn around the avatar itself is not.
// The SECOND exception (Beta 14, the team' own recognition brief: "Ring colour by rank around the profile picture, from Contributor up"): a contributor's picture wears
// its rank's ring. It is narrow on purpose: no `ring` prop or option anywhere (ProfileAvatar only passes the rank it is given by the contributor store, as `data-rank`), and
// the only stylesheet that may draw it is src/styles/rank-ring.css, on `.profile-avatar[data-rank]` (its four colours are variables the team set; Early Member has none).
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
const RANK_CSS = path.join('src', 'styles', 'rank-ring.css');
const allowed = (file, selector) => {
  const flat = selector.replace(/\s+/g, ' ').trim();
  if (file === SETUP_CSS) return /^\.fr-profile( span)?\.fr-profile-avatar$|^\.fr-profile \.fr-profile-avatar$/.test(flat);
  // The rank ring: only from data-rank (the rank the contributor store gave), only in its own stylesheet.
  if (file === RANK_CSS) return /^\.profile-avatar\[data-rank(?:='(?:contributor|trusted|insider|founding)')?\](?:\[data-aura-pending\])?$/.test(flat);
  return false;
};

test('ProfileAvatar has no ring option: it draws a rank only for the picture that asks (the new tab page\'s), never an option of its own', () => {
  const source = read('src/features/accounts/profileModel.tsx');
  assert.doesNotMatch(source, /\bring\s*[?:=]/, 'ProfileAvatar must not accept a ring prop');
  assert.doesNotMatch(source, /data-ring|--pa-ring/);
  // The one thing it may set is the rank it was handed by the contributor store (src/runtime/feedback.ts): `data-rank`, and only when `showRank` is passed.
  assert.match(source, /data-rank=\{contributorRank \|\| undefined\}/);
  assert.match(source, /useProfileRing\(showRank \? profileId : undefined\)\.rank/);
  // Beta 14 (14 Nov): the rank ring is on the new tab page's picture ONLY: no other component passes showRank.
  const callers = [];
  const walk = (dir) => { for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) { const rel = path.join(dir, entry.name); if (entry.isDirectory()) walk(rel); else if (/\.tsx$/.test(rel) && /\bshowRank\b/.test(read(rel))) callers.push(rel.split(path.sep).join('/')); } };
  walk('src');
  assert.deepEqual(callers.sort(), ['src/features/accounts/profileModel.tsx', 'src/features/newtab/NewTabIdentity.tsx']);
});

test('the rank ring lives in one stylesheet, which also holds its four decided colours; no other stylesheet draws or restyles it', () => {
  const css = stripComments(read('src/styles/rank-ring.css'));
  for (const rank of ['contributor', 'trusted', 'insider', 'founding']) assert.match(css, new RegExp(`--acira-rank-ring-${rank}\\s*:\\s*#[0-9a-f]{6}`), rank + ' has its decided colour here');
  for (const other of stylesheets()) if (other !== RANK_CSS) assert.doesNotMatch(stripComments(read(other)), /\.profile-avatar\[data-rank/, other + ' must not draw or restyle the rank ring');
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
