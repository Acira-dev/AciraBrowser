'use strict';
// uBlock's $redirect stand-ins: the engine's data: answers become acira-resource:// addresses whose handler serves the same bytes, and a real Electron page
// gets the neutered googletag (Chromium refuses a redirect to data:, net::ERR_UNSAFE_REDIRECT, which is what pages got before).
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const {ElectronBlocker}=require('@ghostery/adblocker-electron'),{createRedirectResources,decodeDataUrl,PRIVILEGES,SCHEME}=require('../desktop/browser-services/redirect-resources.cjs');
const electron=(()=>{try{const value=require('electron');return typeof value==='string'&&fs.existsSync(value)?value:null;}catch{return null;}})();
const resourcesText=fs.readFileSync(path.join(__dirname,'..','resources','filters','resources.json'),'utf8'),resources=JSON.parse(resourcesText).redirects;
const resource=name=>resources.find(item=>item.name===name||(item.aliases||[]).includes(name));
const engine=()=>{const blocker=ElectronBlocker.parse(['||ads.example^$script,redirect=googletagservices_gpt.js','||pixel.example^$image,redirect=1x1.gif','||beacon.example^$xhr,redirect=noop.json','||frames.example^$subdocument,redirect=noop.html','||plain.example^$script'].join('\n'),{loadNetworkFilters:true,loadCosmeticFilters:false});blocker.updateResources(resourcesText,'bundled');return blocker;};
const answer=(blocker,url,resourceType)=>{let result={};blocker.onBeforeRequest({id:1,url,resourceType,referrer:'https://news.example/',webContentsId:1},patch=>{result=patch;});return result;};

test('data: URLs in the forms the engine writes decode to their type and bytes',()=>{
 assert.deepEqual(decodeDataUrl('data:application/javascript;base64,'+Buffer.from('window.x=1').toString('base64')),{type:'application/javascript',body:Buffer.from('window.x=1')});
 const gif=decodeDataUrl('data:image/gif;base64;base64,R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==');assert.equal(gif.type,'image/gif');assert.equal(gif.body.subarray(0,6).toString(),'GIF89a');
 assert.deepEqual(decodeDataUrl('data:text/plain;charset=utf-8,a%20b%2'),{type:'text/plain;charset=utf-8',body:Buffer.from('a b%2')});
 for(const bad of ['https://example.com/','data:nocomma',null,'data:text/plain;base64,'+'A'.repeat(4*1024*1024)])assert.equal(decodeDataUrl(bad),null,String(bad).slice(0,30));
 assert.deepEqual(PRIVILEGES,{scheme:SCHEME,privileges:{standard:true,secure:true,bypassCSP:true,supportFetchAPI:true,corsEnabled:true}});
});

test('the engine\'s redirects become stand-in addresses that serve uBlock\'s exact resource; blocks and other redirects are untouched',async()=>{
 const blocker=engine(),standIns=createRedirectResources({token:'t0ken'});
 const cases=[['https://ads.example/tag/js/gpt.js','script','googletagservices_gpt.js'],['https://pixel.example/p.gif','image','1x1.gif'],['https://beacon.example/b','xhr','noop.json'],['https://frames.example/ad.html','subFrame','noop.html']];
 const seen=new Set();
 for(const [url,type,name] of cases){
  const raw=answer(blocker,url,type);assert.match(raw.redirectURL||'',/^data:/,'the engine answers '+name+' with a data: URL');
  const moved=standIns.translate(raw);assert.match(moved.redirectURL,/^acira-resource:\/\/t0ken\/[0-9a-f]{24}$/,name);assert.equal(standIns.translate(raw).redirectURL,moved.redirectURL,'stable per resource');seen.add(moved.redirectURL);
  const response=await standIns.respond(new Request(moved.redirectURL,{headers:{origin:'https://news.example'}})),body=Buffer.from(await response.arrayBuffer()),want=resource(name);
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),want.contentType.split(';')[0]);
  assert.deepEqual(body,/;base64/.test(want.contentType)?Buffer.from(want.body,'base64'):Buffer.from(want.body),name+' bytes');
  assert.equal(response.headers.get('access-control-allow-origin'),'https://news.example');assert.equal(response.headers.get('access-control-allow-credentials'),'true');
 }
 assert.equal(seen.size,cases.length);
 assert.match(Buffer.from(await (await standIns.respond(new Request([...seen][0]))).arrayBuffer()).toString(),/googletag/);
 assert.deepEqual(standIns.translate(answer(blocker,'https://plain.example/x.js','script')),{cancel:true},'a plain block stays a block');
 for(const result of [{},{cancel:true},{redirectURL:'https://example.com/upgraded'}])assert.deepEqual(standIns.translate(result),result);
 const id=[...seen][0].split('/').pop();
 assert.equal((await standIns.respond(new Request('acira-resource://another-token/'+id))).status,404,'a page that guesses without this launch\'s token gets nothing');
 assert.equal((await standIns.respond(new Request('acira-resource://t0ken/'+'0'.repeat(24)))).status,404);
 assert.notEqual(createRedirectResources().prefix,createRedirectResources().prefix,'a fresh token per launch');
});

test('electron: a page whose gpt.js, pixel, fetch and frame are redirected gets the stand-ins, CSP and all, where data: failed with ERR_UNSAFE_REDIRECT',{skip:!electron&&'Electron is not installed'},()=>{
 const run=spawnSync(electron,['--use-mock-keychain',path.join(__dirname,'fixtures','redirect-resources','run.cjs')],{encoding:'utf8',timeout:120000,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,ELECTRON_ENABLE_LOGGING:'0'}});
 const line=String(run.stdout).split('\n').find(text=>text.startsWith('RESULT '));assert.ok(line,'runner output: '+String(run.stdout).slice(-600)+String(run.stderr).slice(-600));
 const result=JSON.parse(line.slice(7));
 assert.equal(result.data.googletag,'undefined','control: the engine\'s data: answer never reaches the page');assert.ok(result.data.unsafeRedirect,'control: Chromium reports ERR_UNSAFE_REDIRECT');
 assert.deepEqual(result.standIn,{googletag:'object',cmdPush:'ran',display:'function',img:'load 1',fetch:'200 {}',frame:'acira-resource',unsafeRedirect:false});
});
