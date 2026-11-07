import test from 'node:test';
import assert from 'node:assert/strict';
import { platformCatalogText } from '../src/i18n/platform';
import { format } from '../src/i18n/format';
test('Mac secured labels name its actual verifier without rewriting user workspace names or Windows copy', () => {
  const original = '{name} opens with Windows Hello when Windows unlocks.';
  assert.equal(platformCatalogText('workspaces.securedOn',original,'win32'),original);
  assert.equal(format('en',platformCatalogText('workspaces.securedOn',original,'darwin'),{name:'Windows Research'}),'Windows Research opens with macOS when macOS unlocks.');
  assert.equal(platformCatalogText('history.title','Windows','darwin'),'Windows');
});

test('a Mac says macOS where Settings names the system, and only there',()=>{
  assert.equal(platformCatalogText('language.system','Same as Windows','darwin'),'Same as macOS');
  assert.equal(platformCatalogText('language.system','Same as Windows','win32'),'Same as Windows');
  assert.equal(platformCatalogText('browsersettings.animationSystemOff','None while Windows asks to reduce motion.','darwin'),'None while macOS asks to reduce motion.');
  assert.equal(platformCatalogText('privacy.passkeysDetail','Let sites ask Windows for a passkey.','darwin'),'Let sites ask macOS for a passkey.');
  assert.equal(platformCatalogText('rewind.viewWindows','Windows','darwin'),'Windows','Windows the list of browser windows stays');
});

test('a Mac is "this Mac", not "this PC"', () => {
  assert.equal(platformCatalogText('ext.noFiles','It cannot open files on this PC.','darwin'),'It cannot open files on this Mac.');
  assert.equal(platformCatalogText('setup.import.found','Found on this PC','win32'),'Found on this PC');
});

test('keys written in a sentence read as Mac keys on a Mac', () => {
  const mac = (text: string) => platformCatalogText('sidebar.x', text, 'darwin');
  assert.equal(mac('Ctrl+S toggles the sidebar'), '⌘S toggles the sidebar');
  assert.equal(mac('Show or hide the sidebar. Ctrl+Shift+E (and Ctrl+S with vertical tabs) toggles it.'), 'Show or hide the sidebar. ⇧⌘E (and ⌘S with vertical tabs) toggles it.');
  assert.equal(mac('open a Tor window (Alt+Shift+N)'), 'open a Tor window (⌥⇧N)');
  assert.equal(mac('All open tabs (Alt+T)'), 'All open tabs (⌥T)');
  assert.equal(mac('Ctrl+Tab switches to'), 'Ctrl+Tab switches to', 'Control+Tab is the same key on a Mac');
  assert.equal(mac('one workspace per Space (Alt+1–8)'), 'one workspace per Space (Alt+1–8)');
  assert.equal(mac('Ctrl+Alt with a character is AltGr'), 'Ctrl+Option with a character is AltGr', 'the Option key by its Mac name; AltGr is a word, not the key');
  assert.equal(platformCatalogText('sidebar.x', 'Ctrl+S toggles the sidebar', 'win32'), 'Ctrl+S toggles the sidebar');
  // German and French name the keys as their keyboards do; on a Mac they are the same keys.
  assert.equal(mac('Strg+S schaltet die Seitenleiste um'), '⌘S schaltet die Seitenleiste um');
  assert.equal(mac('Die Schaltfläche und Strg+Umschalt+E blenden sie ein. Alt+Umschalt+N, Strg+Tab'), 'Die Schaltfläche und ⇧⌘E blenden sie ein. ⌥⇧N, Strg+Tab');
  assert.equal(mac('Le bouton et Ctrl+Maj+E l’affichent'), 'Le bouton et ⇧⌘E l’affichent');
  assert.equal(mac('Vorheriger Treffer (Umschalt+Enter)'), 'Vorheriger Treffer (Umschalt+Enter)');
  assert.equal(platformCatalogText('sidebar.x', 'Strg+Umschalt+E', 'win32'), 'Strg+Umschalt+E');
});

test('the Proton VPN app and the Tor clock hint name the Mac, not Windows', () => {
  assert.equal(platformCatalogText('vpn.control.protonApp', 'Connect and check status in the Proton VPN app on Windows.', 'darwin'), 'Connect and check status in the Proton VPN app on macOS.');
  assert.equal(platformCatalogText('tor.clock.detail', 'Turn on “Set time automatically” in Windows Settings, then try again.', 'darwin'), 'Turn on “Set time automatically” in System Settings, then try again.');
  assert.equal(platformCatalogText('tor.clock.detail', 'in Windows Settings', 'win32'), 'in Windows Settings');
});

test('the shortcut editor note does not mention a Windows key on a Mac', () => {
  const note = 'Copy, paste, select all, undo, Esc and keys with the Windows key stay with the system. Letters need {keys} so typing keeps working.';
  assert.equal(platformCatalogText('shortcuts.systemKeysNote', note, 'darwin'), 'Copy, paste, select all, undo and Esc stay with the system. Letters need {keys} so typing keeps working.');
  assert.equal(platformCatalogText('shortcuts.systemKeysNote', note, 'win32'), note);
});


test('the language menu follows the system it runs on: "Same as macOS" on a Mac, "Same as Windows" elsewhere', () => {
  assert.equal(platformCatalogText('language.system', 'Same as Windows', 'darwin'), 'Same as macOS');
  assert.equal(platformCatalogText('language.system', 'Wie Windows', 'darwin'), 'Wie macOS');
  assert.equal(platformCatalogText('language.system', 'Same as Windows', 'win32'), 'Same as Windows');
});

test('setup\'s import step and password hand-off say Mac and Trash on a Mac', () => {
  assert.equal(platformCatalogText('setup.import.found', 'Found on this PC', 'darwin'), 'Found on this Mac');
  assert.equal(platformCatalogText('setup.import.found', 'Auf diesem PC gefunden', 'darwin'), 'Auf diesem Mac gefunden');
  assert.equal(platformCatalogText('handoff.trash', 'Move file to Recycle Bin', 'darwin'), 'Move file to Trash');
  assert.equal(platformCatalogText('handoff.trashed', 'The file is in the Recycle Bin. Empty the Recycle Bin to remove it for good.', 'darwin'), 'The file is in the Trash. Empty the Trash to remove it for good.');
  assert.equal(platformCatalogText('setup.import.found', 'Found on this PC', 'win32'), 'Found on this PC');
  assert.equal(platformCatalogText('history.title', 'PC', 'darwin'), 'PC');
});

test('every catalog says macOS, System Settings and no Windows key on a Mac, and keeps its placeholders', async () => {
  const fs = await import('node:fs'), path = await import('node:path');
  const ids = ['language.system', 'browsersettings.animationSystemOff', 'privacy.passkeysDetail', 'vpn.control.protonApp', 'tor.clock.detail', 'tor.err.clock.detail', 'shortcuts.systemKeysNote'];
  for (const code of ['en', 'ar', 'de', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt-BR', 'ru', 'tr', 'zh-CN']) {
    const catalog = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src', 'i18n', `${code}.json`), 'utf8')) as Record<string, string>;
    for (const id of ids) {
      const original = catalog[id], mac = platformCatalogText(id, original, 'darwin');
      assert.ok(original?.includes('Windows'), `${code} ${id} had Windows to swap`);
      assert.ok(!mac.includes('Windows'), `${code} ${id}: ${mac}`);
      assert.equal(platformCatalogText(id, original, 'win32'), original);
      if (original.includes('{keys}')) assert.ok(mac.includes('{keys}'), `${code} ${id} keeps {keys}`);
    }
  }
});

test('the Arc Spaces line names the Mac workspace key (Control+1–8), not Alt+1–8, in every catalog', async () => {
  const fs = await import('node:fs'), path = await import('node:path');
  for (const code of ['en', 'ar', 'de', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt-BR', 'ru', 'tr', 'zh-CN']) {
    const original = (JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src', 'i18n', `${code}.json`), 'utf8')) as Record<string, string>)['import.desc.spaces'];
    assert.ok(original.includes('Alt+1–8'), `${code} writes the Windows key`);
    const mac = platformCatalogText('import.desc.spaces', original, 'darwin');
    assert.ok(mac.includes('⌃1–8') && !mac.includes('Alt'), `${code}: ${mac}`);
    assert.equal(platformCatalogText('import.desc.spaces', original, 'win32'), original);
  }
});
