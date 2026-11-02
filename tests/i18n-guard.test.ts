import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
// @ts-ignore the scanner is a plain .mjs script
import {scanFiles,convertedFiles} from '../scripts/i18n-scan.mjs';
import {format} from '../src/i18n/format';
import {resolveLocale,LOCALES} from '../src/i18n/locales';

const catalog=(name:string)=>JSON.parse(readFileSync(new URL('../src/i18n/'+name+'.json',import.meta.url),'utf8')) as Record<string,string>;
const root=fileURLToPath(new URL('../',import.meta.url));

test('files already converted keep every user-visible string in the catalog',()=>{
  const files=convertedFiles() as string[];
  assert.ok(files.length>0);
  const found=scanFiles(files.map(file=>root+file)) as {file:string;line:number;text:string}[];
  assert.deepEqual(found.map(item=>`${item.file}:${item.line} ${item.text}`),[],'untranslated literal strings in converted files: use t(\'…\') and add the id to src/i18n/en.json');
});

test('every translation has an English source, the same {parameters}, and the same plural forms',()=>{
  const en=catalog("en"),params=(text:string)=>[...new Set([...text.matchAll(/\{(\w+)(?:,|\})/g)].map(match=>match[1]))].sort().join(",");
  for(const {code} of LOCALES){
    if(code==='en')continue;
    const messages=catalog(code);
    for(const [id,text] of Object.entries(messages)){
      assert.ok(id in en,`${code}: ${id} has no English source`);
      assert.equal(params(text),params(en[id]),`${code}: ${id} changes the {parameters}`);
    }
  }
});

test('messages format: parameters, plurals per language, # as the number',()=>{
  const plural='{count, plural, =0 {No tabs} one {# tab} other {# tabs}}';
  assert.equal(format('en',plural,{count:0}),'No tabs');
  assert.equal(format('en',plural,{count:1}),'1 tab');
  assert.equal(format('en',plural,{count:1234}),'1,234 tabs');
  assert.equal(format('en','Hello {name}, you have {count}',{name:'Ana',count:3}),'Hello Ana, you have 3');
  assert.equal(format('fr','{count, plural, one {# onglet} other {# onglets}}',{count:0}),'0 onglet','French counts 0 as singular');
  assert.equal(format('ja','{count, plural, other {# 個}}',{count:5}),'5 個');
  assert.equal(format('en','No parameters here'),'No parameters here');
  assert.equal(format('en','{missing}'),'{missing}');
});

test('the system language picks the closest shipped locale',()=>{
  assert.equal(resolveLocale('system','es-MX'),'es');
  assert.equal(resolveLocale('system','pt-PT'),'pt-BR');
  assert.equal(resolveLocale('system','zh-TW'),'zh-CN');
  assert.equal(resolveLocale('system','ko-KR'),'ko');
  assert.equal(resolveLocale('system','ar-LB'),'ar');
  assert.equal(resolveLocale('system','tr-TR'),'tr');
  assert.equal(resolveLocale('system','ru-RU'),'ru');
  assert.equal(resolveLocale('system','hi-IN'),'hi');
  assert.equal(resolveLocale('system','unknown-ZZ'),'en');
  assert.equal(resolveLocale('de','fr'),'de');
  assert.equal(resolveLocale(undefined,'ja-JP'),'ja');
});

test('Languages setting is validated, persisted and applied',()=>{
  const codes = ['system', ...LOCALES.map(locale => locale.code)].map(code => `'${code}'`).join(',');
  assert.ok(readFileSync(new URL('../desktop/validation.cjs',import.meta.url),'utf8').includes(`oneOf(patch.language,[${codes}],'Language')`));
});

test('every locale has every message (nothing falls back to English by accident)',()=>{
  const en=catalog('en');
  for(const {code} of LOCALES){
    if(code==='en')continue;
    const messages=catalog(code),missing=Object.keys(en).filter(id=>!(id in messages));
    assert.deepEqual(missing.slice(0,10),[],`${code} is missing ${missing.length} messages: node scripts/i18n-missing.mjs --batches <dir>`);
  }
});
