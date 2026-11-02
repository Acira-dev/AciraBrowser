import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { browserIconFor, browserLetter, safeBrowserIcon } from '../src/features/import-export/browserIcons';

const png = (tag: string) => 'data:image/png;base64,' + Buffer.from('png-' + tag).toString('base64');

test('a small PNG data URL is the icon; anything else is not', () => {
  assert.equal(safeBrowserIcon(png('edge')), png('edge'));
  for (const bad of [undefined, null, 7, {}, '', 'https://example.test/edge.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,a b', 'data:image/png;base64,' + 'A'.repeat(100 * 1024)]) {
    assert.equal(safeBrowserIcon(bad), undefined);
  }
});

test('a section header takes its browser\'s icon and falls back to the letter tile', () => {
  const icons = { Edge: png('edge'), Zen: 'javascript:alert(1)' };
  assert.equal(browserIconFor(icons, 'Edge'), png('edge'));
  assert.equal(browserIconFor(icons, 'Zen'), undefined, 'a malformed entry is ignored');
  assert.equal(browserIconFor(icons, 'Helium'), undefined, 'a browser with no icon');
  assert.equal(browserIconFor(undefined, 'Edge'), undefined, 'an answer with no icons field at all');
  assert.equal(browserIconFor('Edge', 'Edge'), undefined);
  assert.equal(browserIconFor({}, '__proto__'), undefined);
  assert.equal(browserLetter('helium'), 'H');
  assert.equal(browserLetter(''), '?');
});

test('Settings\' import list draws the icon in the browser header and keeps each profile\'s own avatar', () => {
  const panel = fs.readFileSync(path.resolve('src/features/import-export/ImportPanel.tsx'), 'utf8');
  assert.match(panel, /<BrowserTile browser=\{browser\} icon=\{browserIconFor\(result\.icons, browser\)\} \/>/);
  assert.match(panel, /<Avatar source=\{item\} \/>/);
  assert.doesNotMatch(panel, /browser\.slice\(0, 1\)\.toUpperCase\(\)/, 'the bare first letter is only the fallback now');
});
