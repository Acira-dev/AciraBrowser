'use strict';
// 2 Nov 2026 (jackwestin.com): the protection panel said "3 blocked on this page" while four question images were missing, because page resources a phishing list
// blocked were never counted; and with the site's protection off it did not say what still applies. Both are now in the panel.
const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('a page resource a phishing list blocks is counted with the page\'s blocks, under its host', () => {
  const line = read('desktop/content-blocking.cjs').split(/\r?\n/).find(text => text.includes('threatGate.check('));
  assert.match(line, /const out=threatGate\.check\(details,wc,profileId,\{quiet:privateMode,pageProtected:\(\)=>!siteOff\(session,wc,wc\.getURL\(\)\)\}\);/);
  assert.match(line, /if\(out\.cancel&&details\.resourceType!=='mainFrame'\)record\(wc,details,'blocked',\{list:'threat'\}\);return out;/, 'a blocked top-level page shows the warning page instead');
  // record() is what the panel's count and host list read.
  assert.match(read('desktop/content-blocking.cjs'), /const record=\(wc,details,action,extra=\{\}\)=>\{const stat=counts\.get\(wc\.id\)/);
});

test('the status says what stays on with the site\'s protection off, from the running settings', () => {
  const source = read('desktop/content-blocking.cjs');
  assert.match(source, /warnings:privacyPlus\.get\(\)\.phishingLists!==false\|\|privacyPlus\.get\(\)\.pageWarnings!==false,thirdPartyCookiesBlocked:engineFeatureStatus\(app\)\.thirdPartyCookies==='block',/);
});

test('the panel shows one fact line, only while the site\'s own protection is off, naming only what is on', () => {
  const source = read('src/features/ShieldsSummary.tsx');
  assert.match(source, /\{privacy\?\.siteOff&&\(privacy\.warnings\|\|privacy\.thirdPartyCookiesBlocked\)&&<div className="acira-menu-row acira-menu-row-fact" role="status"><Info size=\{16\} className="acira-menu-icon"\/><span className="acira-menu-title">\{t\(privacy\.warnings\?\(privacy\.thirdPartyCookiesBlocked\?'protection\.stillOnCookies':'protection\.stillOn'\):'protection\.stillOnCookiesOnly'\)\}<\/span><span\/><\/div>\}/);
});

test('the three lines exist in every language and name the same two protections', () => {
  const dir = path.join(root, 'src', 'i18n'), locales = fs.readdirSync(dir).filter(file => /^[a-z]{2}(-[A-Z]{2})?\.json$/.test(file));
  assert.equal(locales.length, 13);
  const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'));
  assert.equal(en['protection.stillOn'], 'Still on: warnings before dangerous pages.');
  assert.equal(en['protection.stillOnCookies'], 'Still on: warnings before dangerous pages and third-party cookie blocking.');
  assert.equal(en['protection.stillOnCookiesOnly'], 'Still on: third-party cookie blocking.');
  for (const file of locales) {
    const strings = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const key of ['protection.stillOn', 'protection.stillOnCookies', 'protection.stillOnCookiesOnly']) {
      assert.equal(typeof strings[key], 'string', file + ' ' + key);
      assert.ok(strings[key].length > 10 && !strings[key].includes('{'), file + ' ' + key);
    }
    assert.ok(strings['protection.stillOnCookies'].length > strings['protection.stillOn'].length, file + ': the cookie line adds to the warnings line');
  }
});
