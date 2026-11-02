import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {format} from '../src/i18n/format';
import {LOCALES} from '../src/i18n/locales';

// R4-35 / R4-36: the words on the close cards exist in every language and read as one sentence (no {braces}, no # left over),
// including the two plurals of "6 tabs in 2 windows" in each language's own plural forms.
const catalog=(name:string)=>JSON.parse(readFileSync(new URL('../src/i18n/'+name+'.json',import.meta.url),'utf8')) as Record<string,string>;
const KEYS=['closeGuard.andMore','closeGuard.closeAnyway','closeGuard.askDetail','closeGuard.askTitle','closeGuard.close','closeGuard.dontAsk','closeGuard.quitDetail','closeGuard.quitTitle','closeGuard.thisPage','closeGuard.leaveTitle','closeGuard.leaveMany','closeGuard.leaveBody','closeGuard.keepEditing','shortcutCmd.quit'];
/** The title is one line in the 420px card (19px type, 364px of text): short titles in every language, the body is one sentence. */
const TITLE_LIMIT=32;

test('all 13 catalogs carry the close-card strings',()=>{
  assert.equal(LOCALES.length,13);
  for(const {code} of LOCALES){
    const messages=catalog(code);
    for(const key of KEYS)assert.ok(typeof messages[key]==='string'&&messages[key].length>0,`${code}: ${key}`);
  }
});

test('every language formats "N tabs in M windows" and the unsaved lines cleanly',()=>{
  for(const {code} of LOCALES){
    const messages=catalog(code);
    for(const [tabs,windows] of [[2,1],[6,2],[21,1],[5,5],[1,1]]){
      const text=format(code,messages['closeGuard.quitDetail'],{tabs,windows});
      assert.ok(!/[{}#]/.test(text),`${code} ${tabs}/${windows}: ${text}`);
      assert.ok(text.includes(String(tabs))||code==='ar'&&tabs===1||code==='ar'&&tabs===2,`${code}: ${text} shows the tab count`);
    }
    for(const key of ['closeGuard.leaveTitle','closeGuard.leaveMany','closeGuard.leaveBody','closeGuard.keepEditing','closeGuard.closeAnyway','closeGuard.quitTitle']){
      assert.ok(!/[{}#]/.test(messages[key]),`${code} ${key}: ${messages[key]}`);
    }
    for(const key of ['closeGuard.leaveTitle','closeGuard.leaveMany','closeGuard.quitTitle'])assert.ok([...messages[key]].length<=TITLE_LIMIT,`${code} ${key} stays on one line: ${messages[key]}`);
    assert.ok(format(code,messages['closeGuard.andMore'],{count:3}).includes('3'),`${code}: and N more`);
  }
});

test('English reads as the founder wrote it',()=>{
  const en=catalog('en');
  assert.equal(format('en',en['closeGuard.quitDetail'],{tabs:6,windows:2}),'6 tabs in 2 windows');
  assert.equal(format('en',en['closeGuard.quitDetail'],{tabs:2,windows:1}),'2 tabs in 1 window');
  assert.equal(en['closeGuard.leaveTitle'],'Leave without saving?');assert.equal(en['closeGuard.leaveMany'],'Some tabs have unsaved changes');
  assert.equal(en['closeGuard.leaveBody'],'Changes you made may not be saved.');assert.equal(en['closeGuard.keepEditing'],'Keep editing');
  assert.equal(en['closeGuard.quitTitle'],'Close Acira?');assert.equal(en['closeGuard.closeAnyway'],'Close anyway');
  assert.equal(en['closeGuard.dontAsk'],"Don't ask again");assert.equal(en['closeGuard.askTitle'],'Ask before closing the browser');
});

test('Russian counts windows and tabs in their own forms',()=>{
  const ru=catalog('ru');
  assert.equal(format('ru',ru['closeGuard.quitDetail'],{tabs:6,windows:2}),'6 вкладок в 2 окнах');
  assert.equal(format('ru',ru['closeGuard.quitDetail'],{tabs:2,windows:1}),'2 вкладки в 1 окне');
  assert.equal(format('ru',ru['closeGuard.quitDetail'],{tabs:21,windows:21}),'21 вкладка в 21 окне');
});
