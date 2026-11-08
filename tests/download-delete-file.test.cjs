'use strict';
// "Delete file" on a finished download (13.2, asked for on Discord): the engine moves the one file to the Trash (the Recycle Bin on Windows)
// with Electron's shell.trashItem, never erases it for good, and only asks about erasing where the system has no Trash (some Linux set-ups).
// main.cjs then takes the row off the list as Remove does and raises the toast. Synthetic files in a temp folder only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
delete process.env.ACIRA_BROWSER_TEST_DATA; delete process.env.ACIRA_BROWSER_TEST_DOWNLOAD_DIR;
const {createDownloads} = require('../desktop/browser-services/download-engine.cjs');
const {createDownloadPreferences} = require('../desktop/download-preferences.cjs');

function rig({platform = 'darwin', trash, answer = 1} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-dl-delete-')), folder = path.join(dir, 'Downloads'), bin = path.join(dir, 'Trash');
  fs.mkdirSync(folder, {recursive: true}); fs.mkdirSync(bin, {recursive: true});
  const trashed = [], boxes = [];
  // The fake Trash moves the file into a folder of its own, as the real one does, and records exactly what it was asked to take.
  const take = trash || (async file => fs.renameSync(file, path.join(bin, path.basename(file))));
  const shell = {showItemInFolder() {}, openPath: async () => '', trashItem: async file => { trashed.push(file); return take(file); }};
  const preferences = createDownloadPreferences({file: path.join(dir, 'prefs.json'), defaultFolder: folder});
  const service = createDownloads({getOwner: () => null, askSite() {}, preferences, platform,
    dialog: {showSaveDialog: async () => ({canceled: true}), showMessageBox: async (_window, options) => { boxes.push(options); return {response: answer}; }},
    app: {getPath: () => folder, getFileIcon: async () => ({isEmpty: () => false})}, shell, journalPath: path.join(dir, 'recovery.json')});
  const make = (name, extra = {}) => { const file = path.join(folder, name); fs.writeFileSync(file, 'synthetic'); return {id: 'dl-' + name, browserProfileId: 'A', name, path: file, status: 'Ready', ...extra}; };
  return {dir, folder, bin, trashed, boxes, shell, service, make, cleanup: () => fs.rmSync(dir, {recursive: true, force: true})};
}
const command = (r, record, extra = []) => r.service.command(record.id, 'delete', 'A', [record, ...extra], {owner: {window: {}}});

test('Delete file: the finished file is handed to the Trash by its exact path, and nothing else is touched', async () => {
  const r = rig();
  try {
    const target = r.make('setup.exe'), bystander = r.make('keep.png');
    const result = await command(r, target, [bystander]);
    assert.deepEqual(result, {deleted: true, trashed: true, name: 'setup.exe'});
    assert.deepEqual(r.trashed, [target.path], 'trashItem was called once, with the record\'s own path');
    assert.equal(fs.existsSync(target.path), false, 'the file left the download folder');
    assert.ok(fs.existsSync(path.join(r.bin, 'setup.exe')), 'it is in the Trash, where a wrong click can be undone');
    assert.ok(fs.existsSync(bystander.path), 'another download\'s file stays');
    assert.equal(r.boxes.length, 0, 'no question where the Trash works');
  } finally { r.cleanup(); }
});

test('Delete file: only a finished download whose file is still there, and only in its own profile', async () => {
  const r = rig();
  try {
    for (const status of ['Downloading', 'Paused', 'Interrupted', 'Failed', 'Cancelled']) {
      const record = r.make('partial-' + status + '.bin', {status});
      await assert.rejects(command(r, record), {message: 'The downloaded file is unavailable.'}, status);
      assert.ok(fs.existsSync(record.path), status + ': the file stays');
    }
    const gone = r.make('gone.bin'); fs.rmSync(gone.path);
    await assert.rejects(command(r, gone), {message: 'The downloaded file is unavailable.'}, 'a file that is already gone');
    const folderRecord = {id: 'dl-dir', browserProfileId: 'A', name: 'folder', path: r.folder, status: 'Ready'};
    await assert.rejects(command(r, folderRecord), {message: 'The downloaded file is unavailable.'}, 'a folder is never moved');
    const noPath = {id: 'dl-none', browserProfileId: 'A', name: 'x', path: '', status: 'Ready'};
    await assert.rejects(command(r, noPath), {message: 'The downloaded file is unavailable.'}, 'a row with no path');
    const other = r.make('theirs.bin', {browserProfileId: 'B'});
    await assert.rejects(command(r, other), {message: 'Download is outside this profile.'}, 'another profile\'s row');
    assert.ok(fs.existsSync(other.path));
    assert.deepEqual(r.trashed, [], 'the Trash was never asked');
  } finally { r.cleanup(); }
});

test('Delete file: a failure is a plain error that names the file, and the file stays (macOS and Windows never erase it for good)', async () => {
  for (const platform of ['darwin', 'win32']) {
    const r = rig({platform, trash: async () => { const error = new Error('The process cannot access the file'); error.code = 'EBUSY'; throw error; }});
    try {
      const record = r.make('in use.docx');
      await assert.rejects(command(r, record), {message: 'in use.docx couldn’t be deleted. It may be open in another program.'}, platform);
      assert.ok(fs.existsSync(record.path), platform + ': the file stays');
      assert.equal(r.boxes.length, 0, platform + ': no offer to erase it for good');
    } finally { r.cleanup(); }
  }
});

test('Delete file: a long name is cut in the middle in the message and the result, as the download toasts do', async () => {
  const name = 'a'.repeat(40) + '-and-a-very-long-ending-of-the-name.pdf';
  const r = rig({platform: 'win32', trash: async () => { throw new Error('busy'); }});
  try {
    const record = r.make(name);
    await assert.rejects(command(r, record), error => { assert.ok(error.message.includes('…') && !error.message.includes(name)); return true; });
  } finally { r.cleanup(); }
  const ok = rig();
  try { const result = await command(ok, ok.make(name)); assert.ok(result.name.includes('…') && result.name.length < name.length); } finally { ok.cleanup(); }
});

test('Delete file on Linux with no Trash: it asks first, Cancel keeps the file, and only an answer of "Delete permanently" erases it', async () => {
  const noTrash = async () => { throw new Error('Failed to move item to trash'); };
  const asked = rig({platform: 'linux', trash: noTrash, answer: 0});
  try {
    const record = asked.make('photo.jpg');
    assert.deepEqual(await command(asked, record), {cancelled: true});
    assert.ok(fs.existsSync(record.path), 'Cancel keeps the file');
    assert.equal(asked.boxes.length, 1);
    const box = asked.boxes[0];
    assert.equal(box.type, 'warning');
    assert.equal(box.title, 'Delete file');
    assert.equal(box.message, 'photo.jpg can’t be moved to the Trash.');
    assert.equal(box.detail, 'Delete it permanently instead? This can’t be undone.');
    assert.deepEqual(box.buttons, ['Cancel', 'Delete permanently']);
    assert.equal(box.defaultId, 0, 'the safe button is the default');
    assert.equal(box.cancelId, 0);
  } finally { asked.cleanup(); }
  const sure = rig({platform: 'linux', trash: noTrash, answer: 1});
  try {
    const record = sure.make('photo.jpg');
    assert.deepEqual(await command(sure, record), {deleted: true, trashed: false, name: 'photo.jpg'});
    assert.equal(fs.existsSync(record.path), false, 'erased after the person said so');
  } finally { sure.cleanup(); }
  const stuck = rig({platform: 'linux', trash: noTrash, answer: 1});
  try {
    const record = stuck.make('locked.jpg'), real = fs.promises.unlink;
    fs.promises.unlink = async () => { throw new Error('EPERM'); };
    try { await assert.rejects(command(stuck, record), {message: 'locked.jpg couldn’t be deleted. It may be open in another program.'}); } finally { fs.promises.unlink = real; }
    assert.ok(fs.existsSync(record.path));
  } finally { stuck.cleanup(); }
});

test('Delete file: a Trash that took the file but reported a failure counts as done (the file is gone either way)', async () => {
  const r = rig({trash: async file => { fs.rmSync(file); throw new Error('reported late'); }});
  try {
    const record = r.make('late.bin');
    assert.deepEqual(await command(r, record), {deleted: true, trashed: true, name: 'late.bin'});
    assert.equal(r.boxes.length, 0);
  } finally { r.cleanup(); }
});

test('Delete file: main.cjs takes the row off the list as Remove does and says where the file went', () => {
  const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
  const control = main.slice(main.indexOf("case 'downloads.command':"), main.indexOf("case 'imports.html':"));
  assert.match(control, /'drag','delete'\]\.includes\(request\.command\)/);
  assert.match(control, /if\(request\.command==='delete'&&outcome\?\.deleted\)\{dispatch\(\{type:'downloads\.remove',id:request\.id\}\);dispatch\(\{type:'toast',text:tm\(outcome\.trashed\?'dl\.trashed':'dl\.deleted',\{name:outcome\.name\}\),tone:'info'\}\);\}/);
  assert.ok(control.indexOf('await downloads.command') < control.indexOf("downloads.remove"), 'the row goes only after the file did');
});

test('Delete file: the extension API keeps its own chrome.downloads.removeFile (not the Trash), and nothing else calls shell.trashItem for downloads', () => {
  const host = fs.readFileSync(path.join(__dirname, '../desktop/browser-services/ext-api/downloads/app-host.cjs'), 'utf8');
  assert.match(host, /await fs\.promises\.unlink\(record\.path\)/);
  const engine = fs.readFileSync(path.join(__dirname, '../desktop/browser-services/download-engine.cjs'), 'utf8');
  assert.equal(engine.split('shell.trashItem(').length - 1, 1, 'one call, with record.path');
  assert.match(engine, /shell\.trashItem\(file\)/);
  assert.match(engine, /const file=record\.path,/);
});

test('Delete file: every language has the eight messages, translated, with the same {name}', () => {
  const keys = ['dl.delete', 'dl.deleteAria', 'dl.trashed', 'dl.deleted', 'dl.deleteFailed', 'dl.noTrashMessage', 'dl.noTrashDetail', 'dl.deleteForever'];
  const read = code => JSON.parse(fs.readFileSync(path.join(__dirname, '../src/i18n/' + code + '.json'), 'utf8'));
  const en = read('en'), codes = ['ar', 'de', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pt-BR', 'ru', 'tr', 'zh-CN'];
  const names = text => (text.match(/\{name\}/g) || []).length;
  for (const code of codes) {
    const messages = read(code);
    for (const key of keys) {
      assert.ok(messages[key], code + ': ' + key);
      assert.notEqual(messages[key], en[key], code + ': ' + key + ' is translated');
      assert.equal(names(messages[key]), names(en[key]), code + ': ' + key + ' keeps {name}');
    }
  }
});

test('Delete file: the toast says Trash on a Mac, Recycle Bin on Windows, in the words of each language (through the built main-process catalog)', () => {
  const bundle = require('../desktop/i18n.cjs'), original = Object.getOwnPropertyDescriptor(process, 'platform');
  const say = (platform, locale) => { Object.defineProperty(process, 'platform', {value: platform}); try { bundle.setMainLocale(locale, 'en'); return bundle.tm('dl.trashed', {name: 'a.zip'}).replace(/[\u2066-\u2069]/g, ''); /* Arabic wraps the name in bidi isolates */ } finally { Object.defineProperty(process, 'platform', original); } };
  try {
    assert.equal(say('win32', 'en'), 'a.zip moved to Recycle Bin');
    assert.equal(say('darwin', 'en'), 'a.zip moved to Trash');
    assert.equal(say('linux', 'en'), 'a.zip moved to Trash');
    const table = {
      de: ['a.zip in den Papierkorb verschoben', 'a.zip in den Papierkorb verschoben'],
      es: ['a.zip movido a la Papelera de reciclaje', 'a.zip movido a la Papelera'],
      fr: ['a.zip mis à la Corbeille', 'a.zip mis à la Corbeille'],
      it: ['a.zip spostato nel Cestino', 'a.zip spostato nel Cestino'],
      ja: ['a.zip をごみ箱に移動しました', 'a.zip をゴミ箱に移動しました'],
      ko: ['a.zip을(를) 휴지통으로 이동했습니다', 'a.zip을(를) 휴지통으로 이동했습니다'],
      'pt-BR': ['a.zip movido para a Lixeira', 'a.zip movido para a Lixeira'],
      ru: ['a.zip перемещён в Корзину', 'a.zip перемещён в Корзину'],
      tr: ['a.zip Geri Dönüşüm Kutusu’na taşındı', 'a.zip Çöp Sepeti’ne taşındı'],
      'zh-CN': ['a.zip 已移到回收站', 'a.zip 已移到废纸篓'],
      hi: ['a.zip रीसायकल बिन में भेजा गया', 'a.zip ट्रैश में भेजा गया'],
      ar: ['نُقل a.zip إلى سلة المحذوفات', 'نُقل a.zip إلى سلة المهملات'],
    };
    for (const [locale, [windows, mac]] of Object.entries(table)) {
      assert.equal(say('win32', locale), windows, locale + ' on Windows');
      assert.equal(say('darwin', locale), mac, locale + ' on a Mac');
    }
    assert.equal(say('linux', 'es'), 'a.zip movido a la Papelera de reciclaje', 'Linux keeps the catalog\'s word outside English');
  } finally { bundle.setMainLocale('en', 'en'); }
});
