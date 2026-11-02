import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { pageCoversTip, parseTip } from '../src/components/transient/tooltipParse';

// R4-20 (founder): the Focus button's tip drew its description INSIDE the key cap ("Ctrl+Shift+F\nBring back the full toolbar.")
// and wrapped the title. The key cap holds only keys; the description is its own line.
test('a title, its keys and a description split into three parts', () => {
  assert.deepEqual(parseTip('Turn Focus off · Ctrl+Shift+F\nBring back the full toolbar.'), { text: 'Turn Focus off', key: 'Ctrl+Shift+F', description: 'Bring back the full toolbar.' });
});

test('the key cap never contains description text, in any language the descriptions are translated into', () => {
  const root = new URL('../src/i18n/', import.meta.url);
  const catalogs = fs.readdirSync(root).filter((name) => /^[a-z]{2}(?:-[A-Za-z]+)?\.json$/.test(name));
  assert.ok(catalogs.length >= 13, 'all catalogs are checked');
  for (const name of catalogs) {
    const messages = JSON.parse(fs.readFileSync(new URL(name, root), 'utf8')) as Record<string, string>;
    for (const id of ['shortcuthints.focusEnter', 'shortcuthints.focusExit', 'shortcuthints.rewind']) {
      const description = messages[id];
      if (!description) continue;
      for (const keys of ['Ctrl+Shift+F', 'Ctrl+Shift+H', 'Alt+T', 'Esc', 'F11', '⌘⇧F']) {
        const tip = parseTip(`Some name · ${keys}\n${description}`);
        assert.equal(tip.key, keys, `${name} ${id}`);
        assert.equal(tip.description, description.trim(), `${name} ${id}`);
        assert.doesNotMatch(tip.key ?? '', /\n/);
        assert.ok(!(tip.key ?? '').includes(description.trim().slice(0, 8)), `${name} ${id}: description leaked into the key cap`);
      }
    }
  }
});

test('plain labels, labels with keys and labels that merely contain a dot stay as they were', () => {
  assert.deepEqual(parseTip('Back'), { text: 'Back' });
  assert.deepEqual(parseTip('Back · Alt+←'), { text: 'Back', key: 'Alt+←' });
  assert.deepEqual(parseTip('New tab · Ctrl+T'), { text: 'New tab', key: 'Ctrl+T' });
  assert.deepEqual(parseTip('Reload · F5'), { text: 'Reload', key: 'F5' });
  assert.deepEqual(parseTip('Stop loading · Esc'), { text: 'Stop loading', key: 'Esc' });
  // A tab titled with a group name that starts like a key word is not a key cap.
  assert.deepEqual(parseTip('Inbox · Home'), { text: 'Inbox · Home' });
  assert.deepEqual(parseTip('Docs · Altitude notes'), { text: 'Docs · Altitude notes' });
});

test('a description alone (no keys) and Windows line breaks both work', () => {
  assert.deepEqual(parseTip('Rewind\r\nUndo closed tabs.'), { text: 'Rewind', description: 'Undo closed tabs.' });
  assert.deepEqual(parseTip('Title\n\n  First line  \nSecond line'), { text: 'Title', description: 'First line Second line' });
});

test('TooltipHost draws a description as its own line, never inside the kbd', () => {
  const source = fs.readFileSync(new URL('../src/components/transient/Tooltip.tsx', import.meta.url), 'utf8');
  assert.match(source, /parseTip\(raw\)/);
  assert.match(source, /className="t-tip-desc">\{tip\.description\}</);
  assert.match(source, /<kbd>\{tip\.key\}<\/kbd>/);
  assert.doesNotMatch(source, /<kbd>\{tip\.description/);
  const css = fs.readFileSync(new URL('../src/styles/transient.css', import.meta.url), 'utf8');
  assert.match(css, /\.t-tip\[data-desc\]/);
  assert.match(css, /\.t-tip \.t-tip-desc/);
});

// R4-10 (founder): the (i) icons in setup stopped answering. The cause: the VPN "Get it" opens a web tab behind setup, the
// tooltip layer then believed a website's native view covered every spot, and refused every tip. Setup is never covered.
test('an active web tab never makes setup refuse its tips', () => {
  assert.equal(pageCoversTip(true, false), true, 'over the browser a page view still covers the tip');
  assert.equal(pageCoversTip(true, true), false, 'in setup the page views are hidden');
  assert.equal(pageCoversTip(false, false), false);
  const source = fs.readFileSync(new URL('../src/components/transient/Tooltip.tsx', import.meta.url), 'utf8');
  assert.match(source, /pageCoversTip\(block\.current, !!el\.closest\('\.setup-dialog'\)\)/);
  assert.match(source, /!current\.isConnected\) hide\(\)/, 'a tip whose trigger was unmounted is forgotten');
});
