// R3-44 row "Import from Chrome and Firefox (synthetic profiles)". Real app, one instance, closed in finally.   node qa/r3-proof/import-fixtures.mjs
// Everything the importer may read is a fixture under .qa-profiles (LOCALAPPDATA and APPDATA are redirected there; the app never sees a real browser):
// two Chrome profiles (bookmarks, history, extensions) and one Firefox profile (places.sqlite). Checked through the same service calls Setup and Settings use.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {startApp, poll} from '../d-harness.mjs';
import {probe, withSlot} from './lib.mjs';

const P = probe('import-fixtures');
const fixture = path.resolve('.qa-profiles/r3-proof-import-fixture');
const root = path.resolve('.qa-profiles/r3-proof-import-app');
fs.rmSync(fixture, {recursive: true, force: true}); fs.rmSync(root, {recursive: true, force: true});
const ID = 'ddkjiahejlhfcafbddmgiahcphecmpfh';
const chrome = path.join(fixture, 'Local/Google/Chrome/User Data');
const people = [['Default', 'Personal'], ['Profile 1', 'Work']];
const cache = {};
for (const [folder, name] of people) {
  const location = path.join(chrome, folder); fs.mkdirSync(location, {recursive: true});
  cache[folder] = {name, user_name: `${name.toLowerCase()}@example.test`};
  const slug = name.toLowerCase();
  const pages = [1, 2, 3].map(n => [`https://${slug}.example.org/page-${n}`, `${name} page ${n}`]);
  fs.writeFileSync(path.join(location, 'Bookmarks'), JSON.stringify({roots: {bookmark_bar: {name: 'Bookmarks bar', type: 'folder', children: [...pages.map(([url, title], i) => ({type: 'url', name: title, url, guid: `${folder}-${i}`})), {type: 'folder', name: `${name} folder`, children: [{type: 'url', name: `${name} nested`, url: `https://${slug}.example.org/nested`}]}]}, other: {name: 'Other bookmarks', type: 'folder', children: []}}}));
  const history = new DatabaseSync(path.join(location, 'History'));
  history.exec('CREATE TABLE urls(url TEXT,title TEXT,last_visit_time INTEGER)');
  pages.forEach(([url, title], i) => history.prepare('INSERT INTO urls VALUES(?,?,?)').run(url, title, (BigInt(Date.now() - i * 60000) + 11644473600000n) * 1000n));
  history.close();
  if (slug === 'personal') { const ext = path.join(location, 'Extensions', ID, '1.0_0'); fs.mkdirSync(ext, {recursive: true}); fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify({name: 'uBlock Origin Lite', version: '1.0', manifest_version: 3})); }
}
fs.writeFileSync(path.join(chrome, 'Local State'), JSON.stringify({profile: {info_cache: cache}}));
const ffHome = path.join(fixture, 'Roaming/Mozilla/Firefox'), ff = path.join(ffHome, 'Profiles/qa12.default-release');
fs.mkdirSync(ff, {recursive: true});
fs.writeFileSync(path.join(ffHome, 'profiles.ini'), '[Profile0]\r\nName=default-release\r\nIsRelative=1\r\nPath=Profiles/qa12.default-release\r\nDefault=1\r\n');
const places = new DatabaseSync(path.join(ff, 'places.sqlite'));
places.exec('CREATE TABLE moz_places(id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_date INTEGER, hidden INTEGER DEFAULT 0); CREATE TABLE moz_bookmarks(id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT, guid TEXT, dateAdded INTEGER DEFAULT 0)');
places.prepare("INSERT INTO moz_places VALUES(1,'https://developer.mozilla.org/','MDN',?,0)").run(BigInt(Date.now()) * 1000n);
places.prepare("INSERT INTO moz_places VALUES(2,'https://www.mozilla.org/','Mozilla',?,0)").run(BigInt(Date.now() - 120000) * 1000n);
const mark = places.prepare('INSERT INTO moz_bookmarks(id,type,fk,parent,position,title,guid) VALUES(?,?,?,?,?,?,?)');
mark.run(1, 2, null, 0, 0, '', 'root________'); mark.run(2, 2, null, 1, 0, 'toolbar', 'toolbar_____');
mark.run(10, 1, 1, 2, 0, 'MDN', 'qaFox0000001'); mark.run(11, 1, 2, 2, 1, 'Mozilla', 'qaFox0000002');
places.close();

await withSlot('proof-import-fixtures', async () => {
  const app = await startApp({root, env: {LOCALAPPDATA: path.join(fixture, 'Local'), APPDATA: path.join(fixture, 'Roaming')}});
  try {
    await app.act({type: 'settings.update', patch: {language: 'en', onboardingComplete: true}});
    const found = await app.svc({type: 'imports.discover'});
    const sources = found.sources || [];
    P.check('Acira finds the two fixture Chrome profiles and the fixture Firefox profile (and nothing else)', sources.filter(s => s.browser === 'Chrome').length === 2 && sources.filter(s => /Firefox/i.test(s.browser)).length === 1, sources.map(s => `${s.browser}/${s.name}`).join(', '));
    const chromeSource = sources.find(s => s.browser === 'Chrome' && s.name === 'Personal') || sources.find(s => s.browser === 'Chrome');
    const work = sources.find(s => s.browser === 'Chrome' && s.name === 'Work');
    const firefox = sources.find(s => /Firefox/i.test(s.browser));
    const preview = (await app.svc({type: 'imports.preview', sourceId: chromeSource.id})).preview;
    P.check('the preview counts the Chrome bookmarks (4), history, and lists the extension', preview.bookmarks === 4 && preview.extensions.length === 1, JSON.stringify({bookmarks: preview.bookmarks, folders: preview.folders, history: preview.history, extensions: preview.extensions.map(e => e.name)}));
    const count = async () => { const s = await app.state(); return {bookmarks: s.bookmarkNodes.filter(n => n.url).length, history: s.browsingHistory.length, tabs: s.tabs.length}; };
    const zero = await count();
    const run = await app.svc({type: 'imports.run', sourceId: chromeSource.id, categories: ['bookmarks', 'history', 'extensions']});
    const byCategory = Object.fromEntries(run.batch.results.map(r => [r.category, r]));
    const one = await count();
    P.check('Chrome import adds the bookmarks (4) and history (3) with the right counts', one.bookmarks - zero.bookmarks === 4 && one.history - zero.history === 3 && byCategory.bookmarks?.status === 'imported' && byCategory.history?.status === 'imported', JSON.stringify({delta: {bookmarks: one.bookmarks - zero.bookmarks, history: one.history - zero.history}, results: run.batch.results.map(r => `${r.category}:${r.status}:${r.count}`)}));
    P.check('Chrome extensions are inventory only (nothing is installed behind the person\'s back)', byCategory.extensions?.status === 'inventory only' && byCategory.extensions.count === 1, JSON.stringify(byCategory.extensions));
    const state = await app.state();
    P.check('the imported bookmarks are the fixture\'s (by address and title, nested folder kept)', state.bookmarkNodes.some(n => n.url === 'https://personal.example.org/page-2' && n.title === 'Personal page 2') && state.bookmarkNodes.some(n => n.url === 'https://personal.example.org/nested'), state.bookmarkNodes.filter(n => n.url).map(n => n.title).join(' | '));
    const again = await app.svc({type: 'imports.run', sourceId: chromeSource.id, categories: ['bookmarks', 'history']});
    const two = await count();
    P.check('importing the same profile again adds nothing twice', two.bookmarks === one.bookmarks && two.history === one.history, JSON.stringify({before: one, after: two, results: again.batch.results.map(r => `${r.category}:${r.status}:${r.count}`)}));
    const fx = await app.svc({type: 'imports.run', sourceId: firefox.id, categories: ['bookmarks', 'history']});
    const three = await count();
    P.check('Firefox import adds its bookmarks (2) and history (2)', three.bookmarks - two.bookmarks === 2 && three.history - two.history === 2, JSON.stringify({delta: {bookmarks: three.bookmarks - two.bookmarks, history: three.history - two.history}, results: fx.batch.results.map(r => `${r.category}:${r.status}:${r.count}`)}));
    const s3 = await app.state();
    P.check('the Firefox bookmarks are there by address', ['https://developer.mozilla.org/', 'https://www.mozilla.org/'].every(url => s3.bookmarkNodes.some(n => n.url === url)), s3.bookmarkNodes.filter(n => /mozilla/.test(n.url || '')).map(n => n.title).join(' | '));
    const wr = await app.svc({type: 'imports.run', sourceId: work.id, categories: ['bookmarks']});
    const four = await count();
    P.check('a second Chrome profile imports its own bookmarks (4) beside the first', four.bookmarks - three.bookmarks === 4, JSON.stringify(wr.batch.results.map(r => `${r.category}:${r.status}:${r.count}`)));
    // Undo (the receipt's Undo button calls this).
    const undo = await app.svc({type: 'imports.undo', batchId: fx.batch.id}).catch(error => ({error: String(error.message || error)}));
    const five = await count();
    P.check('Undo removes exactly what that import added', !undo.error && five.bookmarks === four.bookmarks - 2 && five.history === three.history - 2, undo.error || JSON.stringify({before: four, after: five}));
  } finally {
    await app.close();
  }
});
P.finish();
process.exit(P.checks.every(c => c.ok) && P.checks.length ? 0 : 1);
