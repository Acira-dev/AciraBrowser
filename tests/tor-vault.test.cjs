'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createTorVault}=require('../desktop/browser-services/tor-vault.cjs');

const keys={available:()=>true,wrap:b=>Buffer.from(b.toString('hex').split('').reverse().join(''),'utf8'),unwrap:b=>Buffer.from(b.toString('utf8').split('').reverse().join(''),'hex')};
const gate=(ok=true)=>({asked:0,async ensure(){this.asked++;return ok?{ok:true}:{ok:false,message:'no'};}});
const setup=(options={})=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'acira-tor-vault-')),dir=path.join(root,'tor-vault'),g=gate(options.ok!==false);return {root,dir,g,vault:createTorVault({dir,keys,gate:g,now:()=>1000})};};
const files=dir=>{try{return fs.readdirSync(dir);}catch{return null;}};
const done=({root})=>fs.rmSync(root,{recursive:true,force:true});

test('off by default: nothing is saved and no file or folder is ever created',async()=>{
 const t=setup();
 try{
  assert.deepEqual(t.vault.status(),{enabled:false,available:true,hasItems:false});
  assert.throws(()=>t.vault.addBookmark({url:'https://example.org/secret-page',title:'Secret'}),/off/);
  assert.equal(t.vault.saveTabs([{url:'https://example.org/a',title:'A'}]),false);
  await assert.rejects(t.vault.listBookmarks(),/off/);await assert.rejects(t.vault.lastTabs(),/off/);
  assert.equal(files(t.dir),null,'the vault folder does not exist');
  assert.equal(t.g.asked,0);
 }finally{done(t);}
});

test('turning it on needs the Windows check; refusing leaves it off and writes nothing',async()=>{
 const t=setup({ok:false});
 try{await assert.rejects(t.vault.setEnabled(true),/no/);assert.equal(t.vault.status().enabled,false);assert.equal(files(t.dir),null);}finally{done(t);}
});

test('bookmarks and tabs are kept encrypted; the file shows no URL, title or word of either',async()=>{
 const t=setup();
 try{
  await t.vault.setEnabled(true);
  assert.equal(t.vault.addBookmark({url:'https://hidden-service.example/private/path?q=1',title:'Quarterly leak notes'}).created,true);
  assert.equal(t.vault.addBookmark({url:'https://hidden-service.example/private/path?q=1',title:'again'}).created,false,'same page is not saved twice');
  assert.equal(t.vault.saveTabs([{url:'https://news.example/story',title:'The story'},{url:'about:blank',title:'x'},{url:'https://news.example/story',title:'dup'}]),true);
  const onDisk=fs.readdirSync(t.dir).map(name=>fs.readFileSync(path.join(t.dir,name),'latin1')).join('\n');
  for(const secret of ['hidden-service','Quarterly','private/path','news.example','The story'])assert.equal(onDisk.includes(secret),false,secret);
  const list=await t.vault.listBookmarks();assert.equal(list.length,1);assert.equal(list[0].title,'Quarterly leak notes');
  assert.deepEqual(await t.vault.lastTabs(),[{url:'https://news.example/story',title:'The story'}]);
 }finally{done(t);}
});

test('reading needs the Windows check every time the gate asks; a refusal reveals nothing',async()=>{
 const t=setup();
 try{
  await t.vault.setEnabled(true);t.vault.addBookmark({url:'https://example.org/',title:'Ex'});
  t.g.ensure=async()=>({ok:false,message:'Couldn’t verify it’s you.'});
  await assert.rejects(t.vault.listBookmarks(),/verify/);await assert.rejects(t.vault.lastTabs(),/verify/);
 }finally{done(t);}
});

test('a tab set without web pages never replaces the saved one, and only web pages are kept',async()=>{
 const t=setup();
 try{
  await t.vault.setEnabled(true);t.vault.saveTabs([{url:'https://a.example/',title:'A'}]);
  assert.equal(t.vault.saveTabs([{url:'acira://new',title:'New tab'},{url:'javascript:alert(1)'}]),false);
  assert.deepEqual((await t.vault.lastTabs()).map(x=>x.url),['https://a.example/']);
  assert.throws(()=>t.vault.addBookmark({url:'file:///c:/secret.txt'}),/web pages/);
 }finally{done(t);}
});

test('clear removes the items and the key, keeps the on/off choice, and turning it off stops saving',async()=>{
 const t=setup();
 try{
  await t.vault.setEnabled(true);t.vault.addBookmark({url:'https://example.org/',title:'Ex'});
  assert.equal(t.vault.status().hasItems,true);
  t.vault.clearAll();assert.deepEqual(files(t.dir).sort(),['settings.json']);assert.equal(t.vault.status().hasItems,false);assert.equal(t.vault.status().enabled,true);
  await t.vault.setEnabled(false);assert.throws(()=>t.vault.addBookmark({url:'https://example.org/'}),/off/);assert.deepEqual(files(t.dir).sort(),['settings.json']);
 }finally{done(t);}
});

test('a damaged file is reported and never overwritten; a missing key is never replaced over existing data',async()=>{
 const t=setup();
 try{
  await t.vault.setEnabled(true);t.vault.addBookmark({url:'https://example.org/',title:'Ex'});
  const file=path.join(t.dir,'items.vault'),good=fs.readFileSync(file,'utf8'),bad=JSON.parse(good);bad.ct=Buffer.from('tampered').toString('base64');
  fs.writeFileSync(file,JSON.stringify(bad));
  await assert.rejects(t.vault.listBookmarks(),/can’t be read/);assert.throws(()=>t.vault.addBookmark({url:'https://other.example/'}),/can’t be read/);
  assert.equal(fs.readFileSync(file,'utf8'),JSON.stringify(bad),'untouched');
  fs.writeFileSync(file,good);fs.rmSync(path.join(t.dir,'master.key'));
  const again=createTorVault({dir:t.dir,keys,gate:t.g});
  assert.throws(()=>again.addBookmark({url:'https://other.example/'}),/key is missing/);
  assert.equal(fs.readFileSync(file,'utf8'),good,'data left alone');
 }finally{done(t);}
});

test('without secure storage nothing can be turned on',async()=>{
 const t=setup();const v=createTorVault({dir:t.dir,keys:{...keys,available:()=>false},gate:t.g});
 try{await assert.rejects(v.setEnabled(true),/Secure storage/);assert.equal(files(t.dir),null);}finally{done(t);}
});
