'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {Request}=require('@ghostery/adblocker'),{createFilterUpdates}=require('../desktop/browser-services/filter-updates.cjs');
// The lists without the engine.bin an installer (or a local package build) adds: this file tests the profile cache, which a shipped engine would skip.
const bundledFilters=path.join(__dirname,'..','resources','filters'),filtersPath=fs.mkdtempSync(path.join(os.tmpdir(),'acira-filters-'));
for(const name of fs.readdirSync(bundledFilters))if(name!=='engine.bin')fs.copyFileSync(path.join(bundledFilters,name),path.join(filtersPath,name));
process.on('exit',()=>{try{fs.rmSync(filtersPath,{recursive:true,force:true});}catch{}});
const decide=(engine,url,sourceUrl,type='script')=>{const m=engine.match(Request.fromRawDetails({url,sourceUrl,type}));return m.redirect?'redirect':m.match?'block':'allow';};
const scripts=engine=>engine.getCosmeticsFilters({url:'https://www.youtube.com/watch?v=x',hostname:'www.youtube.com',domain:'youtube.com',getBaseRules:false,getInjectionRules:true,getExtendedRules:false,getRulesFromHostname:true,getRulesFromDOM:false}).scripts.length;

test('compiled filter engine is cached, reused, and survives corruption or a different list set',()=>{
 const cachePath=path.join(os.tmpdir(),'acira-engine-cache-'+randomUUID());
 try{
  let t=Date.now();const first=createFilterUpdates({filtersPath,cachePath});const parseMs=Date.now()-t;
  const file=path.join(cachePath,'engine.bin');assert.ok(fs.existsSync(file),'engine.bin written after the first compile');
  t=Date.now();const second=createFilterUpdates({filtersPath,cachePath});const cachedMs=Date.now()-t;
  assert.ok(cachedMs<parseMs,`cached start ${cachedMs}ms must beat parse ${parseMs}ms`);
  for(const [url,source] of [['https://securepubads.g.doubleclick.net/tag/js/gpt.js','https://www.cnn.com/'],['https://www.google-analytics.com/analytics.js','https://example.com/'],['https://example.com/app.js','https://example.com/']])assert.equal(decide(second.getEngine(),url,source),decide(first.getEngine(),url,source),url);
  /* uBlock Origin's own lists answer gpt.js with a neutered stand-in instead of a failed load, so the page's ad code keeps running without ads */assert.equal(decide(second.getEngine(),'https://securepubads.g.doubleclick.net/tag/js/gpt.js','https://www.cnn.com/'),'redirect');
  assert.ok(scripts(first.getEngine())>0,'bundled scriptlet resources compile for YouTube');assert.equal(scripts(second.getEngine()),scripts(first.getEngine()),'scriptlet resources survive the cache');
  fs.writeFileSync(file,Buffer.from('garbage-that-is-not-an-engine'));
  assert.ok(createFilterUpdates({filtersPath,cachePath}).getEngine().onBeforeRequest,'corrupt cache is ignored and rewritten');
  assert.notEqual(fs.readFileSync(file).toString('latin1',0,20),'garbage-that-is-not');
  const key=fs.readFileSync(file);key.writeUInt32LE(1000,0);fs.writeFileSync(file,key);
  assert.ok(createFilterUpdates({filtersPath,cachePath}).getEngine(),'bad header length falls back to parsing');
 }finally{fs.rmSync(cachePath,{recursive:true,force:true});}
});
