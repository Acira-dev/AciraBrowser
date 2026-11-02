import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// The find bar is a popup (kind 'find'). Closing it by any road (Esc, its ×, main taking it down on a blur, a resize or a click in the
// page) must clear the page's highlight: the effect that watches the popup kind leave 'find' sends stop-find for the tab it opened on.
const source = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('leaving the find popup sends stop-find for the tab the find was started on', () => {
  const start = source.indexOf("if (overlay === 'find') { findTab.current");
  assert.ok(start > 0, 'the find popup effect is there');
  const effect = source.slice(start, source.indexOf('}, [overlay]);', start));
  assert.match(effect, /tab\.contentKind === 'web' \? tab\.id : null/, 'only a website tab has a find to clear');
  assert.match(effect, /type: 'stop-find', tabId: id/, 'the tab the find was opened on, not the one active when it closes');
  assert.match(effect, /findTab\.current = null/, 'sent once per find');
});
