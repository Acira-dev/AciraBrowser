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

// QA walk QW-3: the Shelf's empty-state lines ("No downloads yet", "No history yet", "Add pages with + to read later", "Nothing is kept in a private window"), the Downloads / History list buttons,
// "Untitled folder" and "Unnamed group" were English in every language. scripts/i18n-scan.mjs looks at JSX text and attributes; these were arguments of a local helper and `||` fallbacks, so this
// test reads every string literal of the sidebar's files and refuses one that reads as English prose unless it goes through the catalog (t / tr / tm / translateText / controlTitle).
test('the sidebar shows no English literal in any language: empty states, list buttons and fallback names are catalog messages',async()=>{
  const ts=(await import('typescript')).default;
  const files=['src/components/sidebar/AciraSidebar.tsx','src/components/sidebar/groupCarry.ts','src/components/CompactTabs.tsx','src/components/BrowserTabsHorizontal.tsx'];
  const quietCalls=new Set(['t','tr','tm','translateText','controlTitle','require','querySelector','querySelectorAll','closest','matches','getElementById','setAttribute','getAttribute','dispatchEvent','CustomEvent','addEventListener','removeEventListener','formatShortcut']);
  const found:string[]=[];
  for(const file of files){
    const source=readFileSync(root+file,'utf8'),sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    const quiet=(node:import('typescript').Node):boolean=>{
      for(let p=node.parent;p;p=p.parent){
        if(ts.isCallExpression(p)){const e=p.expression,name=ts.isIdentifier(e)?e.text:ts.isPropertyAccessExpression(e)?e.name.text:'';if(quietCalls.has(name))return true;}
        if(ts.isImportDeclaration(p)||ts.isTypeNode(p))return true;
        if(ts.isJsxAttribute(p)&&['className','data-flip','key','role','type','id','data-app-id','data-sb-focus'].includes(p.name.getText()))return true;
      }
      return ts.isPropertyAssignment(node.parent)&&node.parent.name===node;
    };
    const walk=(node:import('typescript').Node)=>{
      if((ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))&&!quiet(node)){
        const text=node.text;
        if(/^[A-Z][a-z]+( [A-Za-z+.,'’-]+)+[.…!?]?$/.test(text)&&!/^(Ctrl|Shift|Alt|Cmd|Mod|Meta)\b/.test(text))found.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line+1} ${text}`);
      }
      ts.forEachChild(node,walk);
    };
    walk(sf);
  }
  assert.deepEqual(found,[],'English literals shown to people: use t(\'…\') and add the id to src/i18n/en.json and the 12 catalogs');
  const en=catalog('en');
  for(const [id,text] of Object.entries({'acirasidebar.readingEmpty':'Add pages with + to read later','acirasidebar.historyPrivate':'Nothing is kept in a private window','acirasidebar.allDownloads':'All downloads','acirasidebar.allHistory':'All history','acirasidebar.unnamedGroup':'Unnamed group','dl.emptyTitle':'No downloads yet','history.emptyTitle':'No history yet','bm.untitled':'Untitled folder'})){
    assert.equal(en[id],text,id);
    for(const {code} of LOCALES){if(code==='en')continue;const value=catalog(code)[id];assert.ok(value&&value!==text,`${code}: ${id} is translated`);}
  }
});
