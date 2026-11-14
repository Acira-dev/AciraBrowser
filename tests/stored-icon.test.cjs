'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createFaviconStore } = require('../desktop/browser-services/favicon-store.cjs');
const { storedIconAtCommit } = require('../desktop/browser-services/stored-icon.cjs');
const { png, nativeImage } = require('./fixtures/tab-icons/pictures.cjs');

const kept = async (pageUrl) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stored-icon-')), file = path.join(directory, 'favicons.json');
  const store = createFaviconStore({ file, nativeImage, now: () => 1_000_000 });
  assert.equal(await store.remember({ profileId: 'p1', privateMode: false, pageUrl, iconUrl: 'https://assets.twitch.tv/assets/favicon-32.png', icon: { bytes: png(32) } }), true);
  return { store, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
};

test('a site visited before shows its stored icon at commit, under www. or not, and a site never visited shows none', async () => {
  const k = await kept('https://www.twitch.tv/chilledcat_music');
  try {
    const stored = k.store.get('p1', 'twitch.tv'); assert.match(stored, /^data:image\/png;base64,/);
    for (const url of ['https://www.twitch.tv/directory', 'https://twitch.tv/x', 'https://www.twitch.tv/chilledcat_music?a=1#b']) assert.equal(storedIconAtCommit({ store: k.store, profileId: 'p1', url }), stored, url);
    assert.equal(storedIconAtCommit({ store: k.store, profileId: 'p1', url: 'https://m.twitch.tv/lofiautisticgirl' }), '', 'another host (m.) has its own entry');
    assert.equal(storedIconAtCommit({ store: k.store, profileId: 'p2', url: 'https://www.twitch.tv/x' }), '', 'another profile');
  } finally { k.cleanup(); }
});
test('an icon already showing, a private tab, a Tor window and a page that is not a website never take the stored one', async () => {
  const k = await kept('https://www.twitch.tv/');
  try {
    const base = { store: k.store, profileId: 'p1', url: 'https://www.twitch.tv/x' };
    assert.notEqual(storedIconAtCommit(base), '');
    assert.equal(storedIconAtCommit({ ...base, currentFavicon: 'data:image/png;base64,AAAA' }), '');
    assert.equal(storedIconAtCommit({ ...base, privateTab: true }), '');
    assert.equal(storedIconAtCommit({ ...base, tor: true }), '');
    assert.equal(storedIconAtCommit({ ...base, url: 'acira://settings' }), '');
    assert.equal(storedIconAtCommit({ ...base, url: 'file:///a.html' }), '');
    assert.equal(storedIconAtCommit({}), '');
    assert.equal(storedIconAtCommit({ store: null, profileId: 'p1', url: 'https://x.com/' }), '');
  } finally { k.cleanup(); }
});

// The wiring in desktop/main.cjs (one hook; the app run is the proof, these pin the decisions).
const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
test('the page\'s icon is also resolved when no favicon event came for the document: dom-ready and the end of loading run the same pick with the page\'s own <link> tags', () => {
  assert.match(main, /const runIcon=\(favicons,manual\)=>\{if\(isNewTabOverride\(tab\.id\)\)return;/, 'the event handler\'s body is a function both paths call');
  assert.match(main, /wc\.on\('page-favicon-updated',\(_e,favicons\)=>\{entry\.iconSeen=true;runIcon\(favicons\);\}\);/);
  assert.match(main, /wc\.on\('did-start-navigation',details=>\{if\(details\.isMainFrame&&!details\.isSameDocument\)\{entry\.iconSeen=false;entry\.storedIcon='';showStored\(details\.url,false\);\}\}\);/, 'a new document has not announced yet; an in-page navigation is not one');
  assert.match(main, /const iconCheck=\(\)=>\{if\(entry\.iconSeen\|\|wc\.isDestroyed\(\)\|\|isNewTabOverride\(tab\.id\)\)return;runIcon\(\[\],true\);\};wc\.on\('dom-ready',iconCheck\);wc\.on\('did-stop-loading',\(\)=>\{if\(!wc\.isLoadingMainFrame\(\)\)iconCheck\(\);\}\);/);
});
test('a site visited before shows its stored icon at navigation start and at commit, never in a private tab or a Tor window, and a lookup that finds nothing keeps it', () => {
  assert.match(main, /const showStored=\(url,colour\)=>\{if\(torMode\|\|entry\.privateTab\|\|isNewTabOverride\(tab\.id\)\)return;/);
  assert.match(main, /storedIconAtCommit\(\{store:require\('\.\/browser-services\/favicon-store\.cjs'\)\.sharedFaviconStore\(\),profileId:tab\.browserProfileId,url,currentFavicon:'',privateTab:entry\.privateTab,tor:torMode\}\)/);
  assert.match(main, /if\(!\(cur&&cur\.favicon\)\)\{entry\.storedIcon=stored;send\(\{favicon:stored\}\);\}if\(colour\)try\{/, 'at commit the glow takes the stored icon\'s colour even when the start of the navigation already showed the icon');
  assert.match(main, /wc\.on\('did-navigate',\(_e,url\)=>showStored\(url,true\)\);/, 'the glow takes its colour from it at commit');
  assert.match(main, /const runIcon=\(favicons,manual\)=>/, 'our own lookup (no event came) never clears an icon the tab shows: the page may simply not answer yet');
  assert.match(main, /deliver:found=>\{[^}]*if\(!found&&\(manual\|\|\(entry\.storedIcon&&state\.tabs\.find\(item=>item\.id===tab\.id\)\?\.favicon===entry\.storedIcon\)\)\)return;if\(found\)\{entry\.iconSeen=true;entry\.storedIcon='';\}send\(\{favicon:found\?found\.data:''\}\);/s);
  assert.match(main, /entry\.siteColour\?\.iconResolved\(siteColour\.brandOfIcon\(found\.bytes,/, 'and the colour comes from the resolved icon');
});
