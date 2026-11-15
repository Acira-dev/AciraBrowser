import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { profileFiltersBlocked } from '../src/features/profileFilters';

// 13.10: every private window logged a main-process error as it opened, and again at each Acira menu:
//   Error occurred in handler for 'acira:service': Error: Open a regular profile to change profile filters
// The overlay's warm-up (App.tsx OverlayWarmup) renders the real Acira menu once, off screen, and so does every menu open: its AI-free row asked
// `filters.profile-status`, which main refuses in a private or Tor window. The interface now does not ask there; the log is left as it was.
const read = (file: string) => fs.readFileSync(file, 'utf8');
const profiles = [{ id: 'p', private: false }, { id: 'x', private: true }, { id: 't', private: true, tor: true }] as never;

test('the rule: a private or Tor window cannot read the profile\'s filters (main\'s own rule, the window\'s), a Tor tab in an ordinary window can', () => {
  assert.equal(profileFiltersBlocked({ browserProfiles: profiles, activeBrowserProfileId: 'p' }), false, 'an ordinary window asks as before');
  assert.equal(profileFiltersBlocked({ browserProfiles: profiles, activeBrowserProfileId: 'x' }), true, 'a private window');
  assert.equal(profileFiltersBlocked({ browserProfiles: profiles, activeBrowserProfileId: 't' }), true, 'a Tor window');
  assert.equal(profileFiltersBlocked({ browserProfiles: profiles, activeBrowserProfileId: 'missing' }), true, 'no profile: main refuses too');
  assert.equal(profileFiltersBlocked(null), false, 'no snapshot at all: nothing is known, the old behaviour');
});

test('the Acira menu: the AI-free row asks only when the window may, and App tells the menu from the live state (the warm-up\'s menu too)', () => {
  const menu = read('src/components/BrowserMenu.tsx'), app = read('src/App.tsx');
  assert.match(menu, /function AiFreeRow\(\{ask=true\}/);
  assert.match(menu, /useEffect\(\(\)=>\{if\(!ask\)return;let alive=true;const read=\(\)=>runtime\.service\(\{type:'filters\.profile-status'\}\)/, 'no request when it may not ask');
  assert.match(menu, /\},\[ask\]\);\n {2}\/\/ Flips at once/, 'the effect follows ask');
  assert.match(menu, /aiFree:<AiFreeRow ask=\{!p\.profileFiltersBlocked\}\/>/);
  assert.match(app, /torActive: isTorWindow\(state\), \/\*[^*]*\*\/profileFiltersBlocked: profileFiltersBlocked\(state\),/, 'menuParts says it from the state the popup draws');
  assert.match(app, /<Popup active=\{false\} kind="menu" contextId="" state=\{state\}/, 'the warm-up draws its menu through the same Popup');
});

test('the AI-free toolbar button and Settings\' filter controls do not ask in a private or Tor window either', () => {
  const button = read('src/components/AiFreeButton.tsx'), app = read('src/App.tsx'), filters = read('src/features/ContentFilters.tsx');
  assert.match(button, /export function AiFreeButton\(\{controlTitle,ask=true\}/);
  assert.match(button, /useEffect\(\(\)=>\{if\(!ask\)return;let alive=true;/);
  assert.match(button, /\},\[ask\]\);/);
  assert.match(app, /<AiFreeButton key=\{id\} controlTitle=\{controlTitle\} ask=\{!profileFiltersBlocked\(state\)\}\/>/);
  assert.match(filters, /if\(scope==='profile'&&profileFiltersBlocked\(state\)\)\{setError\(t\('cf\.unavailable'\)\);return;\}if\(scope==='profile'\|\|target\)void runtime\.service\(/);
});
