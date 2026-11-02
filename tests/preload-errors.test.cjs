'use strict';
// The preload shows a refused request's message alone: Electron's "Error invoking remote method" wrapper never reaches a panel.
// (The preload is a sandboxed script that needs the whole Electron renderer, so the strip is read from its source.)
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','desktop','preload.cjs'),'utf8');
const line=source.split('\n').find(text=>text.startsWith('const plain='));
test('every request the preload makes rethrows a refusal without Electron\'s wrapper',()=>{
 assert.ok(line,'the preload defines plain()');
 assert.match(source,/const invoke=\(channel,\.\.\.args\)=>whenReady\(\)\.then\(\(\)=>ipcRenderer\.invoke\(channel,\.\.\.args\)\)\.catch\(plain\);/,'invoke goes through plain()');
 const plain=new Function(line+';return plain;')();
 for(const [raw,clean] of [["Error invoking remote method 'acira:service': Error: Enter a domain without a path, port or wildcard.",'Enter a domain without a path, port or wildcard.'],["Error invoking remote method 'acira:service': TypeError: Invalid URL",'Invalid URL'],["Error invoking remote method 'acira:native': Something plain",'Something plain'],['Already clean','Already clean']]){
  const error=new Error(raw);assert.throws(()=>plain(error),thrown=>thrown===error&&thrown.message===clean,raw);
 }
 assert.throws(()=>plain('not an error'),thrown=>thrown==='not an error');
});
