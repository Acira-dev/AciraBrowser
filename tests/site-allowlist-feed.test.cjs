'use strict';
// beta.11: the reviewed-sites list is a static file beside the update feed (docs/launch/SITE_ALLOWLIST.md). The app asks that file first and asks the old
// Supabase function only while the file is missing (404/410); any other failure keeps the last copy and asks nobody else.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createSiteAllowlist,allowlistFileURL,FILE_NAME}=require('../desktop/browser-services/site-allowlist.cjs');
const {feedFolderURL,folderFromUpdateConfig}=require('../desktop/browser-services/release-feed.cjs');

// beta.11 names update.acirabrowser.com as its release target (packaging/release-target.json), so the file sits at that site's root.
const FILE='https://update.acirabrowser.com/site-allowlist.json',ENDPOINT='https://x.supabase.co/functions/v1/allowlist';
const answer=hosts=>JSON.stringify({schema:1,hosts});
const http=status=>Object.assign(new Error('The allow-list answered HTTP '+status+'.'),{status});
function memoryIo(){const files=new Map();return {files,readFileSync:p=>{if(!files.has(p))throw Object.assign(new Error('ENOENT'),{code:'ENOENT'});return files.get(p);},writeFileSync:(p,d)=>files.set(p,String(d)),renameSync:(a,b)=>{files.set(b,files.get(a));files.delete(a);},mkdirSync:()=>{},existsSync:p=>files.has(p),statSync:p=>{if(!files.has(p))throw Object.assign(new Error('ENOENT'),{code:'ENOENT'});return {size:files.get(p).length,isFile:()=>true};},lstatSync:p=>{if(!files.has(p))throw Object.assign(new Error('ENOENT'),{code:'ENOENT'});return {size:files.get(p).length,isFile:()=>true,isSymbolicLink:()=>false};},unlinkSync:p=>files.delete(p),openSync:()=>{throw new Error('no handles');}};}
const make=(fetchText,extra={})=>createSiteAllowlist({cachePath:'/a',fileUrl:FILE,endpoint:ENDPOINT,io:memoryIo(),fetchText,...extra});

test('the file is asked first and is enough: the Supabase function is never asked while the file answers',async()=>{
 const asked=[];const list=make(async url=>{asked.push(url);return answer(['nflxvideo.net']);});
 const status=await list.refresh({});
 assert.deepEqual(asked,[FILE]);assert.equal(status.entries,1);assert.equal(status.source,'file');assert.equal(status.lastError,null);assert.equal(list.covers('a.nflxvideo.net','nflxvideo.net'),true);
 await list.maybeRefresh({});assert.deepEqual(asked,[FILE],'and not again within the day');
});

test('only while the file is missing (404 or 410) does the old endpoint get asked, and the file is asked first every time',async()=>{
 for(const missing of [404,410]){
  const asked=[];let published=false;const list=make(async url=>{asked.push(url);if(url===FILE){if(!published)throw http(missing);return answer(['acira-shop.top']);}return answer(['acira-video.top']);});
  const first=await list.refresh({});
  assert.deepEqual(asked,[FILE,ENDPOINT],missing+': file first, then the endpoint');assert.equal(first.source,'endpoint');assert.equal(first.lastError,null);assert.equal(list.covers('acira-video.top','acira-video.top'),true);
  published=true;asked.length=0;const second=await list.refresh({});
  assert.deepEqual(asked,[FILE],missing+': once the file is published the endpoint is never asked again');assert.equal(second.source,'file');assert.equal(list.covers('acira-shop.top','acira-shop.top'),true);assert.equal(list.covers('acira-video.top','acira-video.top'),false,'the file replaces the endpoint\'s list');
 }
});

test('any other failure asks nobody else and keeps the last copy: no network, a timeout, a 5xx, a 403, a page that is not a list',async()=>{
 const failures=[new Error('net::ERR_INTERNET_DISCONNECTED'),Object.assign(new Error('The operation was aborted'),{name:'TimeoutError'}),http(500),http(502),http(503),http(403),http(429)];
 for(const failure of failures){
  const asked=[];let broken=false;const list=make(async url=>{asked.push(url);if(broken)throw failure;return answer(['acira-shop.top']);});
  await list.refresh({});broken=true;asked.length=0;const status=await list.refresh({});
  assert.deepEqual(asked,[FILE],String(failure.message)+': the endpoint is not asked');assert.ok(status.lastError);assert.equal(status.entries,1,'the last copy stays');assert.equal(list.covers('acira-shop.top','acira-shop.top'),true);
 }
 for(const odd of ['<html>Not Found</html>','{"schema":2,"hosts":[]}',answer(['https://evil/']),'']){
  const asked=[];const list=make(async url=>{asked.push(url);return odd;});const status=await list.refresh({});
  assert.deepEqual(asked,[FILE],'an odd answer from the file is not "missing": '+odd.slice(0,20));assert.ok(status.lastError);assert.equal(status.entries,0);
 }
});

test('a missing file with no endpoint (after the fallback is removed) is an error that changes nothing',async()=>{
 const list=createSiteAllowlist({cachePath:'/a',fileUrl:FILE,endpoint:'',io:memoryIo(),fetchText:async()=>{throw http(404);}});
 const status=await list.refresh({});assert.ok(status.lastError);assert.equal(status.entries,0);
});

test('no file address keeps the beta.10 behaviour exactly; an empty list in the file is a valid answer',async()=>{
 const asked=[];const old=createSiteAllowlist({cachePath:'/a',endpoint:ENDPOINT,io:memoryIo(),fetchText:async url=>{asked.push(url);return answer(['acira-shop.top']);}});
 assert.equal((await old.refresh({})).source,'endpoint');assert.deepEqual(asked,[ENDPOINT]);
 const none=createSiteAllowlist({cachePath:'/a',io:memoryIo(),fetchText:async()=>{throw new Error('must not be called');}});assert.equal((await none.maybeRefresh({})).entries,0);
 const empty=make(async()=>JSON.stringify({schema:1,updated:'2026-11-06',hosts:[]}));const status=await empty.refresh({});assert.equal(status.entries,0);assert.equal(status.lastError,null,'the file the founder publishes first is empty, and that is fine');assert.equal(status.source,'file');
});

test('where the file is: beside the update feed of the release target; a test profile reaches only what QA names',()=>{
 assert.equal(FILE_NAME,'site-allowlist.json');
 assert.equal(allowlistFileURL({}),FILE,'the shipped target (packaging/release-target.json)');
 assert.equal(allowlistFileURL({},{feedFolder:()=>'https://updates.example.org/feed/'}),'https://updates.example.org/feed/site-allowlist.json');
 assert.equal(allowlistFileURL({},{feedFolder:()=>''}),'','a target that is not a plain folder: only the old endpoint');
 assert.equal(allowlistFileURL({ACIRA_BROWSER_TEST_DATA:'/tmp/acira-qa/x'}),'','a test profile never reaches the shipped feed');
 assert.equal(allowlistFileURL({ACIRA_BROWSER_TEST_DATA:'/tmp/x',ACIRA_SITE_ALLOWLIST_FILE:'http://127.0.0.1:9696/site-allowlist.json'}),'http://127.0.0.1:9696/site-allowlist.json');
 assert.equal(allowlistFileURL({ACIRA_BROWSER_TEST_DATA:'/tmp/x',ACIRA_SITE_ALLOWLIST_FILE:'http://evil.example.org/x.json'}),'','plain http only on this computer');
 assert.equal(allowlistFileURL({ACIRA_BROWSER_TEST_DATA:'/tmp/x',ACIRA_SITE_ALLOWLIST_FILE:'https://a.example.org/x.json?id=1'}),'','no query string');
 assert.equal(allowlistFileURL({ACIRA_SITE_ALLOWLIST_FILE:'http://127.0.0.1:9696/x.json'}),FILE,'outside a test profile the environment is ignored');
});

test('the feed folder comes from the installed app\'s app-update.yml, or the source checkout\'s release target',()=>{
 const yml='provider: "generic"\nurl: "https://raw.githubusercontent.com/Acira-dev/AciraBrowserUpdates/main/feed/"\nupdaterCacheDirName: "acira-browser-updater"\n';
 assert.equal(folderFromUpdateConfig(yml),'https://raw.githubusercontent.com/Acira-dev/AciraBrowserUpdates/main/feed/');
 assert.equal(folderFromUpdateConfig('provider: generic\nurl: https://updates.example.org/feed\n'),'https://updates.example.org/feed/','a missing trailing slash is added');
 assert.equal(folderFromUpdateConfig('provider: github\nowner: Acira-dev\nrepo: x\n'),'','a github target has no plain folder');
 assert.equal(folderFromUpdateConfig('provider: generic\nurl: http://updates.example.org/feed/\n'),'','https only');
 assert.equal(folderFromUpdateConfig(''),'');assert.equal(folderFromUpdateConfig(undefined),'');
 const gone=()=>{throw new Error('Cannot find module');};
 assert.equal(feedFolderURL({loadTarget:gone,readConfig:()=>yml}),'https://raw.githubusercontent.com/Acira-dev/AciraBrowserUpdates/main/feed/','installed app: no packaging/ folder, so app-update.yml');
 assert.equal(feedFolderURL({loadTarget:()=>({provider:'generic',url:'https://u.example.org/feed'}),readConfig:()=>''}),'https://u.example.org/feed/');
 assert.equal(feedFolderURL({loadTarget:()=>({provider:'github',owner:'a',repo:'b'}),readConfig:()=>yml}),'','a github target wins over a stale yml');
 assert.equal(feedFolderURL({loadTarget:gone,readConfig:()=>''}),'');
 assert.equal(feedFolderURL(),FILE.replace(FILE_NAME,''),'the real target of this checkout');
});

test('content-blocking hands the file address to the allow-list and the packaged app reads its own feed folder',()=>{
 const blocking=fs.readFileSync(path.join(__dirname,'../desktop/content-blocking.cjs'),'utf8');
 assert.match(blocking,/createSiteAllowlist\(\{cachePath:[^}]*,fileUrl:require\('\.\/browser-services\/site-allowlist\.cjs'\)\.allowlistFileURL\(\),endpoint:require\('\.\/browser-services\/site-reports\.cjs'\)\.endpoints\(\)\.allowlist\}\)/);
 assert.match(fs.readFileSync(path.join(__dirname,'../desktop/test-hooks.cjs'),'utf8'),/'ACIRA_SITE_ALLOWLIST_FILE'/);
});

test('the exporter writes the file the app reads: sorted, no repeats, a date, unchanged lists keep their date, a bad host is refused',async()=>{
 const {buildFile,readFileText}=await import('../scripts/export-site-allowlist.mjs');
 const text=buildFile(['b.example.org','a.example.org','b.example.org'],{today:'2026-11-06'});
 assert.deepEqual(JSON.parse(text),{schema:1,updated:'2026-11-06',hosts:['a.example.org','b.example.org']});
 assert.deepEqual(readFileText(text),{hosts:['a.example.org','b.example.org'],updated:'2026-11-06'},'the app\'s own parser reads it');
 assert.equal(buildFile(['a.example.org','b.example.org'],{today:'2027-01-01',previous:text}),text,'same hosts: file and date untouched');
 assert.equal(JSON.parse(buildFile(['a.example.org'],{today:'2027-01-01',previous:text})).updated,'2027-01-01','a changed list gets the new date');
 assert.deepEqual(readFileText(buildFile([],{today:'2026-11-06'})).hosts,[],'an empty list is a valid file');
 for(const bad of ['https://evil.example.org/','Evil.example.org','192.168.1.1','localhost','x.onion'])assert.throws(()=>buildFile([bad]),bad);
 const published=path.join(__dirname,'..','previews','beta11-quiet-start','feed','site-allowlist.json');
 if(fs.existsSync(published))assert.doesNotThrow(()=>readFileText(fs.readFileSync(published,'utf8')),'the prepared file for the founder parses');
});
