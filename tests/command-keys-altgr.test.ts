import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { holdsCommandKey } from '../src/ui/commandKeys';

// AltGr (Brazilian ABNT2's "/", German "@") is reported as Ctrl and Alt together on Windows; the quick-search "/" of History, Bookmarks, Downloads and Settings ignored it.
const event = (mods: Partial<Record<'ctrlKey' | 'altKey' | 'metaKey', boolean>>, altGraph = false) => ({ ctrlKey: false, altKey: false, metaKey: false, ...mods, getModifierState: (name: string) => name === 'AltGraph' && altGraph });

test('a real Ctrl, Alt or Meta shortcut is a command; plain typing and AltGr typing are not', () => {
  assert.equal(holdsCommandKey(event({})), false);
  assert.equal(holdsCommandKey(event({ ctrlKey: true })), true);
  assert.equal(holdsCommandKey(event({ altKey: true })), true);
  assert.equal(holdsCommandKey(event({ metaKey: true })), true);
  assert.equal(holdsCommandKey(event({ ctrlKey: true, altKey: true }, true)), false, 'AltGr as Windows reports it: Ctrl + Alt + AltGraph');
  assert.equal(holdsCommandKey(event({ ctrlKey: true, altKey: true }, false)), true, 'Ctrl+Alt without AltGr is a shortcut');
  assert.equal(holdsCommandKey(event({ metaKey: true, ctrlKey: true, altKey: true }, true)), true, 'Meta always is');
  assert.equal(holdsCommandKey({ ctrlKey: true, altKey: false, metaKey: false }), true, 'an event without getModifierState');
});

test('the History/Library and Settings quick-search keys use it', () => {
  for (const file of ['src/features/Library.tsx', 'src/features/BrowserSettings.tsx']) {
    const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    assert.match(source, /holdsCommandKey\(event\)/, file);
    assert.match(source, /from '\.\.\/ui\/commandKeys'/, file);
  }
});
