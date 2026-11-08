'use strict';
// update.acirabrowser.com serves two kinds of file the app asks for: the reviewed-sites list and the spelling dictionaries (scripts/prepare-update-host-files.mjs checks and lists them).
// Both answered 404 in beta.13.1 because nobody had published them. These tests pin what the script refuses, what it writes, and that the URLs the app builds are the ones it lays out.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const REAL_NAMES='af-za-3-0 bg-bg-3-0 ca-es-3-0 cs-cz-3-0 cy-gb-1-0 da-dk-3-0 de-de-3-0 el-gr-3-0 en-au-10-1 en-ca-10-1 en-gb-10-1 en-gb-oxendict-10-1 en-us-10-1 es-es-3-0 et-ee-3-0 fa-ir-9-0 fo-fo-3-0 fr-fr-3-0 gl-1-0 he-il-3-0 hi-in-3-0 hr-hr-3-0 hu-hu-3-0 hy-1-0 id-id-3-0 it-it-3-0 ko-3-0 lt-lt-3-0 lv-lv-3-0 nb-no-3-0 nl-nl-3-0 pl-pl-3-0 pt-br-3-0 pt-pt-3-0 ro-ro-3-0 ru-ru-3-0 sh-4-0 sk-sk-3-0 sl-si-3-0 sq-3-0 sr-4-0 sv-se-3-0 ta-in-3-0 tg-tg-5-0 tr-tr-4-0 uk-ua-5-0 vi-vn-3-0'.split(' ').map(name=>name+'.bdic'); // Chromium 152.0.7977.167, as scripts/mirror-spellcheck-dictionaries.mjs listed them
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'acira-host-files-'));
function mirror(names=REAL_NAMES){const dir=temp(),sums=[];for(const name of names){const bytes=Buffer.from('bdic '+name);fs.writeFileSync(path.join(dir,name),bytes);sums.push(sha(bytes)+'  '+name);}fs.writeFileSync(path.join(dir,'SHA256SUMS'),sums.join('\n')+'\n');return dir;}
const allowlist=(text='{"schema":1,"updated":"2026-11-08","hosts":[]}\n')=>{const file=path.join(temp(),'site-allowlist.json');fs.writeFileSync(file,text);return file;};
let tools;const load=async()=>tools||=await import('../scripts/prepare-update-host-files.mjs');

test('every dictionary name Chromium 152 asks for passes the name check, and odd names do not',async()=>{
 const {DICTIONARY_NAME}=await load();assert.equal(REAL_NAMES.length,47);
 for(const name of REAL_NAMES)assert.match(name,DICTIONARY_NAME,name);
 for(const name of ['EN-US-10-1.bdic','en-us-10-1.BDIC','en-us.bdic','../en-us-10-1.bdic','en-us-10-1.bdic.txt','x-us-10-1.bdic'])assert.doesNotMatch(name,DICTIONARY_NAME,name);
});

test('the folder the script writes is the folder the app asks, under the host the app asks',async()=>{
 const {DICTIONARY_FOLDER}=await load();
 const sp=require('../desktop/browser-services/spellcheck-dictionaries.cjs'),{HOST_URL}=require('../desktop/browser-services/update-hosts.cjs'),{allowlistFileURL}=require('../desktop/browser-services/site-allowlist.cjs');
 assert.equal(sp.RELEASE_URL,HOST_URL+DICTIONARY_FOLDER+'/','dictionaries: base URL + file name, and Chromium adds the name');
 assert.equal(sp.dictionaryURLFromUpdateConfig('provider: generic\nurl: https://update.acirabrowser.com/\n'),HOST_URL+DICTIONARY_FOLDER+'/','the installed app derives the same folder from app-update.yml');
 assert.equal(allowlistFileURL({}),HOST_URL+'site-allowlist.json','the reviewed-sites list sits at the root');
});

test('readSums reads sha256sum lines and refuses anything else, and a name listed twice',async()=>{
 const {readSums}=await load(),a='a'.repeat(64);
 assert.deepEqual([...readSums(`${a}  x-1-0.bdic\n${a} *y-1-0.bdic\n\n`).keys()],['x-1-0.bdic','y-1-0.bdic']);
 assert.throws(()=>readSums('not a sum\n'),/Cannot read/);assert.throws(()=>readSums(`${a}  x\n${a}  x\n`),/twice/);
});

test('a complete mirror passes; every kind of damage is refused, all problems named',async()=>{
 const {checkDictionaries}=await load();
 const dir=mirror();const entries=checkDictionaries(dir);assert.equal(entries.length,47);assert.deepEqual(entries.map(e=>e.name),[...REAL_NAMES].sort());
 const bad=mirror();
 fs.unlinkSync(path.join(bad,'pl-pl-3-0.bdic'));                                  // listed, missing
 fs.writeFileSync(path.join(bad,'de-de-3-0.bdic'),'changed');                      // wrong hash
 fs.writeFileSync(path.join(bad,'zz-zz-3-0.bdic'),'extra');                        // on disk, not listed
 fs.writeFileSync(path.join(bad,'SHA256SUMS'),fs.readFileSync(path.join(bad,'SHA256SUMS'),'utf8')+sha('x')+'  EN-US.bdic\n'); // a name Chromium never asks
 assert.throws(()=>checkDictionaries(bad),error=>/pl-pl-3-0\.bdic: listed in SHA256SUMS but missing/.test(error.message)&&/de-de-3-0\.bdic: SHA-256/.test(error.message)&&/zz-zz-3-0\.bdic is in the folder but not in SHA256SUMS/.test(error.message)&&/EN-US\.bdic: not a name Chromium asks for/.test(error.message));
 assert.throws(()=>checkDictionaries(mirror(REAL_NAMES.slice(0,10))),/only 10 dictionaries/,'a run that skipped languages must not be published: those languages get no spell checking');
 assert.throws(()=>checkDictionaries(mirror(),{limit:10}),/GitHub Pages refuses files of 100 MB or more/);
 const none=temp();assert.throws(()=>checkDictionaries(none),/no SHA256SUMS/);
});

test('the allow-list file is checked the way the app reads it',async()=>{
 const {checkAllowlist}=await load();
 const empty=checkAllowlist(allowlist());assert.deepEqual([empty.hosts,empty.updated],[0,'2026-11-08']);assert.equal(empty.sha256.length,64);
 assert.equal(checkAllowlist(allowlist('{"schema":1,"hosts":["example.com","b.example.org"]}')).hosts,2);
 for(const bad of ['{"schema":1,"hosts":["https://evil/"]}','{"schema":2,"hosts":[]}','not json','','{"schema":1,"hosts":"example.com"}'])assert.throws(()=>checkAllowlist(allowlist(bad)),undefined,bad);
 assert.throws(()=>checkAllowlist(allowlist('{"schema":1,"hosts":[],"pad":"'+'x'.repeat(600*1024)+'"}')),/at most/);
});

test('prepare lays the files out as docs/ will hold them, with a manifest that reads back',async()=>{
 const {prepare,readManifest,manifestText,DICTIONARY_FOLDER}=await load(),out=path.join(temp(),'host');
 const result=prepare({allowlist:allowlist(),dictionaries:mirror(),out});
 assert.equal(result.files.length,48);assert.equal(result.dictionaries,47);
 assert.ok(fs.existsSync(path.join(out,'site-allowlist.json')));
 assert.deepEqual(fs.readdirSync(path.join(out,DICTIONARY_FOLDER)).sort(),[...REAL_NAMES].sort());
 const manifest=readManifest(fs.readFileSync(path.join(out,'MANIFEST.txt'),'utf8'));
 assert.deepEqual(manifest,result.files);assert.equal(manifest[0].path,'site-allowlist.json');
 for(const file of manifest){const bytes=fs.readFileSync(path.join(out,file.path));assert.equal(bytes.length,file.bytes,file.path);assert.equal(sha(bytes),file.sha256,file.path);}
 assert.match(manifestText(manifest),/# 48 files, \d+ bytes\n$/);
 assert.throws(()=>prepare({allowlist:allowlist('{"schema":1,"hosts":["bad host"]}'),dictionaries:mirror(),out:path.join(temp(),'x')}),undefined,'a damaged list stops the whole run');
});

test('verify-live compares every URL with the manifest: 200, size and (for the list, or with full) the SHA-256',async()=>{
 const {prepare,verifyLive,HOST_URL}=await Promise.resolve(load()).then(async t=>({...t,HOST_URL:require('../desktop/browser-services/update-hosts.cjs').HOST_URL}));
 const out=path.join(temp(),'host'),{files}=prepare({allowlist:allowlist(),dictionaries:mirror(),out});
 const serve=(overrides={})=>async(url,init)=>{const rel=url.slice(HOST_URL.length),file=files.find(f=>f.path===rel),o=overrides[rel];
  if(o==='missing'||!file)return new Response('',{status:404});
  const body=o==='changed'?Buffer.from('changed'):fs.readFileSync(path.join(out,rel));
  return new Response(init.method==='HEAD'?null:body,{status:200,headers:{'content-length':String(o==='short'?body.length-1:body.length)}});};
 const all=await verifyLive(files,{fetchImpl:serve()});assert.equal(all.length,48);assert.ok(all.every(r=>r.ok),JSON.stringify(all.filter(r=>!r.ok)));
 const broken=await verifyLive(files,{fetchImpl:serve({'pl-pl-3-0.bdic':'x','spellcheck-dictionaries/pl-pl-3-0.bdic':'missing','spellcheck-dictionaries/de-de-3-0.bdic':'short','site-allowlist.json':'changed'})});
 assert.deepEqual(broken.filter(r=>!r.ok).map(r=>r.path).sort(),['site-allowlist.json','spellcheck-dictionaries/de-de-3-0.bdic','spellcheck-dictionaries/pl-pl-3-0.bdic']);
 assert.match(broken.find(r=>r.path.endsWith('pl-pl-3-0.bdic')).detail,/HTTP 404/);
 const fullButSameLength=await verifyLive(files.slice(0,2),{fetchImpl:serve({'spellcheck-dictionaries/af-za-3-0.bdic':'changed'}),full:true});
 assert.equal(fullButSameLength[1].ok,false);assert.match(fullButSameLength[1].detail,/bytes, expected|SHA-256/);
});
