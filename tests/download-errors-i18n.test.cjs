'use strict';
// Download error texts (browser-services/download-engine.cjs and main.cjs's download controls), shown in the Downloads page's error line or
// a toast, follow the interface language like the rest of the downloads copy. They were English in every language until beta.10.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), {EventEmitter} = require('node:events');
const i18n = require('../desktop/i18n.cjs'), tx = require('../desktop/browser-services/tx.cjs');
// The usual rig environment puts the engine in test mode (no Save dialog, a test download folder): these tests drive the real flow.
delete process.env.ACIRA_BROWSER_TEST_DATA; delete process.env.ACIRA_BROWSER_TEST_DOWNLOAD_DIR;
const {createDownloads} = require('../desktop/browser-services/download-engine.cjs');
const catalog = name => JSON.parse(fs.readFileSync(path.join(__dirname, '../src/i18n', name + '.json'), 'utf8'));
const CODES = ['en', 'es', 'fr', 'de', 'pt-BR', 'it', 'ja', 'zh-CN', 'ar', 'tr', 'ru', 'ko', 'hi'];
const IDS = ['dl.fileUnavailable', 'dl.chooseDestination', 'dl.cannotResume', 'dl.noPartial', 'dl.openSiteTab', 'dl.notSaved', 'dl.unknown', 'dl.otherProfile',
  'dl.alreadyActive', 'dl.cannotRetryAddress', 'dl.alreadyResuming', 'dl.noLongerActive', 'dl.recoveryNotSaved', 'dl.privateRetry', 'dl.openFailed', 'dl.saveFailed'];
const use = locale => tx.setTranslator({t: (id, params) => { i18n.setMainLocale(locale, 'en-US'); return i18n.tm(id, params); }, locale: () => i18n.setMainLocale(locale, 'en-US')});
test.after(() => { tx.setTranslator(null); i18n.setMainLocale('en', 'en-US'); });

class Item extends EventEmitter {
  constructor(name, {resumable = false} = {}) { super(); Object.assign(this, {name, saved: '', paused: false, resumable}); }
  getURL() { return 'https://files.example/' + this.name; } getURLChain() { return [this.getURL()]; } getFilename() { return this.name; } getSavePath() { return this.saved; }
  getReceivedBytes() { return 0; } getTotalBytes() { return 10; } getMimeType() { return ''; } getETag() { return ''; } getLastModifiedTime() { return ''; }
  isPaused() { return this.paused; } canResume() { return this.resumable; } pause() { this.paused = true; } resume() { this.paused = false; } setSavePath(file) { this.saved = file; } cancel() { this.emit('done', {}, 'cancelled'); }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function setup({answer = async () => ({canceled: true}), journalPath} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-dl-i18n-')), records = [], toasts = [], session = new EventEmitter(), resumed = [];
  session.createInterruptedDownload = options => resumed.push(options);
  const wc = {session, isDestroyed: () => false, downloadURL() {}};
  const owner = {profileId: 'A', tabId: 't', window: {}, controller: {}, toast: text => toasts.push(text), record: record => { const found = records.find(r => r.id === record.id); if (found) Object.assign(found, record); else records.push({...record}); }};
  const make = () => createDownloads({getOwner: contents => (contents === wc ? owner : null), preferences: {get: () => ({askWhere: true, folder: dir}), destination: name => path.join(dir, name)},
    dialog: {showSaveDialog: (...a) => answer(...a)}, app: {getPath: () => dir}, shell: {}, journalPath: journalPath || path.join(dir, 'journal.json')});
  const service = make(); service.attach(session);
  const begin = item => { session.emit('will-download', {preventDefault() {}}, item, wc); return item; };
  return {dir, records, toasts, service, wc, begin, resumed, make, cleanup: () => fs.rmSync(dir, {recursive: true, force: true})};
}

test('every download error text exists in all 13 languages, with the same {parameters}, translated', () => {
  const en = catalog('en');
  assert.deepEqual(fs.readdirSync(path.join(__dirname, '../src/i18n')).filter(name => name.endsWith('.json') && name !== 'converted.json').map(name => name.slice(0, -5)).sort(), [...CODES].sort());
  for (const code of CODES) {
    const c = catalog(code);
    for (const id of IDS) {
      assert.ok(typeof c[id] === 'string' && c[id].trim(), `${code} lacks ${id}`);
      assert.deepEqual([...c[id].matchAll(/\{(\w+)\}/g)].map(m => m[1]), [...en[id].matchAll(/\{(\w+)\}/g)].map(m => m[1]), `${code} ${id} parameters`);
      if (code !== 'en') assert.notEqual(c[id], en[id], `${code} ${id} is still English`);
    }
  }
});

test('the Downloads page\'s error line speaks the interface language for every refused action', async () => {
  for (const locale of ['de', 'ja', 'ar']) {
    use(locale);
    const c = catalog(locale), want = id => ({message: c[id]});
    const f = setup({answer: () => new Promise(() => {})});
    try {
      const missing = {id: 'gone', browserProfileId: 'A', status: 'Ready', path: path.join(f.dir, 'nothing-here.pdf'), url: 'https://files.example/a.pdf'};
      await assert.rejects(f.service.command('gone', 'show', 'A', [missing]), want('dl.fileUnavailable'));
      await assert.rejects(f.service.command('gone', 'open', 'A', [missing]), want('dl.fileUnavailable'));
      await assert.rejects(f.service.command('gone', 'show', 'B', [missing]), want('dl.otherProfile'));
      // A transfer waiting on the Save dialog (pending), then one flowing that the server can't resume.
      f.begin(new Item('waiting.bin')).emit('updated', {}, 'progressing');
      await wait(10);
      assert.equal(f.records.length, 1, 'the waiting transfer has its row');
      await assert.rejects(f.service.command(f.records[0].id, 'pause', 'A', f.records.map(r => ({...r}))), want('dl.chooseDestination'));
      const g = setup({answer: async (_window, options) => ({canceled: false, filePath: options.defaultPath})});
      try {
        g.begin(new Item('flowing.bin'));
        await wait(20);
        const row = () => g.records.map(r => ({...r}));
        await assert.rejects(g.service.command(g.records[0].id, 'resume', 'A', row()), want('dl.cannotResume'));
        await assert.rejects(g.service.command(g.records[0].id, 'retry', 'A', row()), want('dl.alreadyActive'));
      } finally { g.cleanup(); }
      // Rows of transfers that are no longer running.
      const old = {id: 'old', browserProfileId: 'A', status: 'Interrupted', path: path.join(f.dir, 'old.bin'), url: 'https://files.example/old.bin'};
      await assert.rejects(f.service.command('old', 'resume', 'A', [old]), want('dl.openSiteTab'));
      await assert.rejects(f.service.command('old', 'resume', 'A', [old], {webContents: f.wc}), want('dl.noPartial'));
      await assert.rejects(f.service.command('old', 'retry', 'A', [{...old, url: 'blob:https://files.example/x'}], {webContents: f.wc}), want('dl.cannotRetryAddress'));
      await assert.rejects(f.service.command('old', 'pause', 'A', [old]), want('dl.noLongerActive'));
    } finally { f.cleanup(); }
  }
});

test('"already resuming", "could not be saved" and "recovery data wasn\'t saved" follow the language too', async () => {
  use('fr');
  const c = catalog('fr');
  // A crash left half a file and its journal entry; Resume twice before the first takes hold.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-dl-i18n-j-')), half = path.join(dir, 'half.bin'), journal = path.join(dir, 'journal.json');
  fs.writeFileSync(half, 'x'.repeat(5));
  fs.writeFileSync(journal, JSON.stringify({version: 1, entries: [{id: 'half', profileId: 'A', path: half, urlChain: ['https://files.example/half.bin'], offset: 5, length: 10, startedAt: 1}]}));
  const f = setup({journalPath: journal});
  try {
    const row = [{id: 'half', browserProfileId: 'A', status: 'Interrupted', path: half, url: 'https://files.example/half.bin'}];
    assert.deepEqual(await f.service.command('half', 'resume', 'A', row, {webContents: f.wc}), {resuming: true});
    await assert.rejects(f.service.command('half', 'resume', 'A', row, {webContents: f.wc}), {message: c['dl.alreadyResuming']});
  } finally { f.cleanup(); fs.rmSync(dir, {recursive: true, force: true}); }
  // The Save dialog itself fails: the toast gives the reason inside the translated sentence.
  const g = setup({answer: async () => { throw new Error('EACCES'); }});
  try {
    g.begin(new Item('denied.bin'));
    await wait(30);
    assert.ok(g.toasts.includes(c['dl.notSaved'].replace('{reason}', 'EACCES')), JSON.stringify(g.toasts));
  } finally { g.cleanup(); }
  // The recovery journal can't be written (its folder is a file).
  const blocker = path.join(os.tmpdir(), 'acira-dl-i18n-blocker-' + process.pid);
  fs.writeFileSync(blocker, 'not a folder');
  const h = setup({journalPath: path.join(blocker, 'journal.json'), answer: async (_window, options) => ({canceled: false, filePath: options.defaultPath})});
  try {
    h.begin(new Item('unsaved.bin'));
    await wait(30);
    assert.ok(h.toasts.includes(c['dl.recoveryNotSaved']), JSON.stringify(h.toasts));
  } finally { h.cleanup(); fs.rmSync(blocker, {force: true}); }
  use('en');
});

test('main.cjs\'s download controls use the catalog for "Unknown download", the private Retry refusal and the open fallback', () => {
  const main = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
  const control = main.slice(main.indexOf("case 'downloads.command':"), main.indexOf("case 'imports.html':"));
  const act = main.slice(main.indexOf("if(action.type==='download.act')"), main.indexOf("if(action.type==='tab.move-window')"));
  assert.ok(control.length > 100 && act.length > 100);
  assert.match(control, /throw new Error\(tm\("dl\.unknown"\)\)/);
  assert.match(control, /throw new Error\(tm\("dl\.privateRetry"\)\)/);
  assert.match(act, /error\.message\|\|tm\("dl\.openFailed"\)/);
  for (const english of ['Unknown download', 'A private download can’t be retried', 'That download could not be opened']) assert.ok(!(control + act).includes(english), english);
});

test('no English sentence is left as a literal in the download engine', async () => {
  const {scanSource} = await import('../scripts/i18n-scan.mjs');
  const file = path.join(__dirname, '../desktop/browser-services/download-engine.cjs');
  assert.deepEqual(scanSource(file, fs.readFileSync(file, 'utf8'), {sentences: true}).map(found => found.text), []);
  assert.ok(!fs.readFileSync(file, 'utf8').includes("'The download could not be saved: '"));
});
