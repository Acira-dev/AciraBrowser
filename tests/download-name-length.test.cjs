'use strict';
// A download whose name is longer than the file system allows (255 bytes, with room for " (n)" and Chromium's ".crdownload") failed at once with
// "Interrupted" and no file. The name is shortened, keeping its extension and its characters whole.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createDownloadPreferences,fitName}=require('../desktop/download-preferences.cjs');

function folder(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dl-name-'));return {dir,preferences:createDownloadPreferences({file:path.join(dir,'prefs.json'),defaultFolder:dir}),done:()=>fs.rmSync(dir,{recursive:true,force:true})};}

test('a name that fits is left alone, extension and all',()=>{
 const f=folder();try{for(const name of ['report.pdf','a.b.tar.gz','.hidden','README','é.txt'])assert.equal(path.basename(f.preferences.destination(name)),name);}finally{f.done();}
});

test('a 300-character name is shortened to something every file system can save, with its extension',()=>{
 const f=folder();try{
  const long='a'.repeat(300)+'.txt',first=f.preferences.destination(long);
  assert.equal(path.extname(first),'.txt');assert.ok(Buffer.byteLength(path.basename(first))+' (9999)'.length+'.crdownload'.length<=255);
  fs.writeFileSync(first,'x');// really creatable
  const second=f.preferences.destination(long);assert.match(path.basename(second),/ \(1\)\.txt$/);assert.notEqual(second,first);fs.writeFileSync(second,'x');
 }finally{f.done();}
});

test('multi-byte names are cut between characters, not inside one',()=>{
 const f=folder();try{
  const name=f.preferences.destination('é'.repeat(200)+'日本語'.repeat(50)+'.pdf');
  assert.ok(Buffer.byteLength(path.basename(name))<=255-' (9999)'.length-'.crdownload'.length);assert.ok(!path.basename(name).includes('�'));
  assert.match(path.basename(name),/^é+(日本語?|日本?|日?)?\.pdf$/);fs.writeFileSync(name,'x');
 }finally{f.done();}
});

test('fitName always leaves something to save',()=>{
 assert.equal(fitName('x'.repeat(1000),'.pdf').length<250,true);assert.equal(fitName('','.pdf'),'download');assert.equal(fitName('short','.txt'),'short');
});
