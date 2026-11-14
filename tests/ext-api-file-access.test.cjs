'use strict';
// file: URLs for an extension's own pages with "Allow access to file URLs" on (ext-api/extension/file-read.cjs and the `extension` package's handler on the main side, ext-api/extension-renderer.cjs on the page side). Electron gives an extension
// page no file URL loader even with the engine's flag on (found in the real app with PDF.js: its viewer's XHR of the local PDF failed), so the page's fetch and XMLHttpRequest ask
// the main process for the bytes. The real-app proof with the real extension is in the report.
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),{pathToFileURL}=require('node:url');
const main=require('../desktop/browser-services/ext-api/extension/file-read.cjs');
const pkg=require('../desktop/browser-services/ext-api/extension.cjs');
const page=require('../desktop/browser-services/ext-api/extension-renderer.cjs');
const extApi=require('../desktop/browser-services/ext-api/index.cjs');

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acira-file-access-'));
const file=name=>path.join(dir,name);
fs.writeFileSync(file('note.txt'),'hello from a local file');
fs.writeFileSync(file('data.json'),'{"a":1}');
fs.writeFileSync(file('doc space.pdf'),Buffer.from('%PDF-1.4 0123456789'));
fs.mkdirSync(file('folder'));
process.on('exit',()=>{try{fs.rmSync(dir,{recursive:true,force:true});}catch{/* gone */}});
const url=name=>pathToFileURL(file(name)).href;
const on=()=>true;

test('the main side answers a regular local file for an extension whose switch is on, and for no other',async()=>{
 const reply=await main.readFileFor({allowed:on,address:url('note.txt')});
 assert.deepEqual([reply.status,reply.type,reply.size],[200,'text/plain',23]);assert.equal(Buffer.from(reply.bytes).toString(),'hello from a local file');
 assert.equal(typeof reply.modified,'number');
 await assert.rejects(main.readFileFor({allowed:()=>false,address:url('note.txt')}),/not allowed/,'switch off: nothing is read');
 assert.equal((await main.readFileFor({allowed:on,address:url('doc space.pdf')})).type,'application/pdf','a path with a space (percent-encoded in the address)');
 assert.equal((await main.readFileFor({allowed:on,address:url('data.json')})).type,'application/json');
});

test('only local files: another host, credentials, other schemes, a folder, a missing file and a huge one are refused',async()=>{
 for(const address of ['file://server/share/x.txt','file://user:pw@localhost/etc/hosts','https://example.com/x','chrome-extension://abc/x','data:text/plain,hi','not a url',''])
  await assert.rejects(main.readFileFor({allowed:on,address}),/Not a local file address/,address);
 await assert.rejects(main.readFileFor({allowed:on,address:url('folder')}),/ERR_FILE_IS_A_FOLDER/);
 await assert.rejects(main.readFileFor({allowed:on,address:url('missing.txt')}),/ERR_FILE_NOT_FOUND/);
 const big={promises:{stat:async()=>({isFile:()=>true,isDirectory:()=>false,size:main.MAX_BYTES+1,mtimeMs:1})}};
 await assert.rejects(main.readFileFor({allowed:on,address:url('note.txt'),fsApi:big}),/ERR_FILE_TOO_LARGE/);
 assert.equal(main.localPathOf('file://localhost'+pathToFileURL(file('note.txt')).pathname),file('note.txt'),'localhost is this machine');
});

test('one Range, as the file loader answers it: 206 with the bytes asked for, a suffix, an open end; a range past the end is 416; anything odd is the whole file',async()=>{
 const text=async range=>{const r=await main.readFileFor({allowed:on,address:url('note.txt'),range});return [r.status,Buffer.from(r.bytes).toString(),r.start,r.end];};
 assert.deepEqual(await text('bytes=0-4'),[206,'hello',0,4]);
 assert.deepEqual(await text('bytes=6-'),[206,'from a local file',6,22]);
 assert.deepEqual(await text('bytes=-4'),[206,'file',19,22]);
 assert.deepEqual(await text('bytes=0-9999'),[206,'hello from a local file',0,22]);
 assert.equal((await text('bytes=9999-'))[0],416);
 assert.deepEqual((await text('bytes=0-1,5-6'))[0],200,'several ranges: the whole file');
 assert.deepEqual((await text('lines=1-2'))[0],200);assert.deepEqual((await text(undefined))[0],200);
});

// ---- the page side, against fakes of fetch and XMLHttpRequest (the real ones are checked in the real app)
class FakeXHR extends EventTarget{
 constructor(){super();this._responseType='';this.opened=[];this.sent=0;}
 get responseType(){return this._responseType;}set responseType(value){this._responseType=value;}
 open(method,url){this.opened.push([method,url]);}send(){this.sent++;}abort(){this.aborted=true;}
 setRequestHeader(){this.headerSet=true;}getResponseHeader(){return 'real';}getAllResponseHeaders(){return 'real: all\r\n';}overrideMimeType(){this.mime=true;}
}
function world({fileAccess=true,answers}={}){
 const calls=[],realCalls=[];
 const acira={fileAccess,call:name=>async(address,range)=>{calls.push([name,address,range]);return answers(address,range);}};
 const saved={fetch:globalThis.fetch,XHR:globalThis.XMLHttpRequest,location:globalThis.location};
 globalThis.fetch=async(input,init)=>{realCalls.push(['fetch',String(input&&input.url||input)]);return new Response('real');};
 globalThis.XMLHttpRequest=FakeXHR;
 globalThis.location={href:'chrome-extension://abcdefghijklmnopabcdefghijklmnop/page.html'};
 const symbol=Symbol.for('acira.file-requests');delete globalThis[symbol];
 const result=page.renderer(acira);
 return {calls,realCalls,result,restore(){globalThis.fetch=saved.fetch;globalThis.XMLHttpRequest=saved.XHR;globalThis.location=saved.location;delete globalThis[symbol];}};
}
const reply=(text,extra={})=>({status:200,type:'text/plain',size:Buffer.byteLength(text),start:0,end:Buffer.byteLength(text)-1,modified:Date.UTC(2026,10,14),bytes:new Uint8Array(Buffer.from(text)),...extra});

test('with the switch off or no call bridge the page is left alone (the extension namespace is built as before)',()=>{
 const saved=[globalThis.fetch,globalThis.XMLHttpRequest];
 try{
  for(const acira of [{fileAccess:false,call(){return async()=>({});}},{fileAccess:true},{},null]){
   const before=[globalThis.fetch,globalThis.XMLHttpRequest,FakeXHR.prototype.open];globalThis.XMLHttpRequest=FakeXHR;
   assert.deepEqual(Object.keys(page.renderer(acira)),['extension'],'the namespace is built as before');assert.equal(globalThis.fetch,before[0]);assert.equal(FakeXHR.prototype.open,before[2]);
  }
 }finally{[globalThis.fetch,globalThis.XMLHttpRequest]=saved;}
 assert.deepEqual([page.namespaces,pkg.namespaces],[['extension'],['extension']]);
});

test('fetch of a file: address answers from the main process; every other address, and a second world of the same page, reach the real fetch',async()=>{
 const w=world({answers:address=>reply('file '+address.slice(-8))});
 try{
  const response=await fetch(url('note.txt'));
  assert.deepEqual([response.status,response.ok,response.url,response.headers.get('content-type'),response.headers.get('content-length')],[200,true,url('note.txt'),'text/plain',String(response.headers.get('content-length'))]);
  assert.equal(await response.text(),'file note.txt');
  assert.match(response.headers.get('last-modified'),/^\w{3}, \d\d \w{3} 2026/);
  assert.deepEqual(w.calls[0],['acira.file.read',url('note.txt'),undefined]);
  await fetch('https://example.com/a');await fetch(new Request('https://example.com/b'));await fetch(new URL('https://example.com/c'));
  assert.deepEqual(w.realCalls.map(call=>call[1]),['https://example.com/a','https://example.com/b','https://example.com/c']);
  // relative, URL and Request forms; the page itself is chrome-extension: so "file:" must be absolute
  assert.equal((await fetch(new URL(url('data.json')))).url,url('data.json'));assert.equal((await fetch(new Request(url('data.json')))).url,url('data.json'));
  page.renderer({fileAccess:true,call:()=>async()=>reply('x')});assert.equal(w.calls.length,3,'the world is patched once: a second build changes nothing');
 }finally{w.restore();}
});

test('fetch: a Range goes to the main process and comes back 206 with Content-Range; HEAD has no body; POST, a failed read and an abort are rejected like fetch rejects',async()=>{
 const w=world({answers:(address,range)=>range?reply('hello',{status:206,start:0,end:4,size:23}):address.endsWith('gone.txt')?Promise.reject(new Error('ERR_FILE_NOT_FOUND')):reply('hello from a local file')});
 try{
  const part=await fetch(url('note.txt'),{headers:{Range:'bytes=0-4'}});
  assert.deepEqual([part.status,part.headers.get('content-range'),await part.text()],[206,'bytes 0-4/23','hello']);assert.equal(w.calls[0][2],'bytes=0-4');
  const head=await fetch(url('note.txt'),{method:'HEAD'});assert.deepEqual([head.status,await head.text()],[200,'']);
  await assert.rejects(fetch(url('note.txt'),{method:'POST',body:'x'}),TypeError);
  await assert.rejects(fetch(url('gone.txt')),error=>error instanceof TypeError&&/Failed to fetch/.test(error.message));
  const controller=new AbortController();controller.abort();await assert.rejects(fetch(url('note.txt'),{signal:controller.signal}),error=>error.name==='AbortError');
 }finally{w.restore();}
});

function done(xhr,types){return new Promise(resolve=>{const seen=[];for(const type of types)xhr.addEventListener(type,()=>{seen.push([type,xhr.readyState]);if(type==='loadend')resolve(seen);});});}
test('XMLHttpRequest of a file: address: Chrome\'s shape (readyState 4, status 0, the answer in responseType) and its event order; other addresses reach the real one',async()=>{
 const w=world({answers:()=>reply('{"a":1}',{type:'application/json'})});
 try{
  const xhr=new XMLHttpRequest();xhr.responseType='arraybuffer';
  const events=done(xhr,['readystatechange','loadstart','progress','load','loadend','error']);
  xhr.open('GET',url('data.json'));assert.equal(xhr.readyState,1);assert.deepEqual(xhr.opened,[],'the real open was not called');
  xhr.setRequestHeader('Range','bytes=0-9');xhr.send();
  const seen=await events;
  assert.deepEqual(seen.map(e=>e[0]),['readystatechange','loadstart','readystatechange','readystatechange','progress','readystatechange','load','loadend']);
  assert.deepEqual([xhr.readyState,xhr.status,xhr.statusText,xhr.responseURL],[4,0,'',url('data.json')]);
  assert.equal(Buffer.from(xhr.response).toString(),'{"a":1}');assert.equal(xhr.response instanceof ArrayBuffer,true);
  assert.throws(()=>xhr.responseText,error=>error.name==='InvalidStateError');
  assert.equal(xhr.getResponseHeader('Content-Type'),'application/json');assert.equal(xhr.getResponseHeader('x-nothing'),null);assert.match(xhr.getAllResponseHeaders(),/^content-type: application\/json\r\n/);
  assert.equal(w.calls[0][2],'bytes=0-9','the page\'s Range header reaches the read');
  // text, json and blob forms
  for(const [type,check] of [['',v=>assert.equal(v,'{"a":1}')],['text',v=>assert.equal(v,'{"a":1}')],['json',v=>assert.deepEqual(v,{a:1})],['blob',v=>assert.equal(v.size,7)]]){
   const x=new XMLHttpRequest();x.responseType=type;const finished=done(x,['loadend']);x.open('GET',url('data.json'));assert.equal(x.response,type===''||type==='text'?'':null,'nothing before the answer');x.send();await finished;check(x.response);if(type===''||type==='text')assert.equal(x.responseText,'{"a":1}');
  }
  // other addresses: the real object, untouched
  const other=new XMLHttpRequest();other.open('GET','https://example.com/x');other.setRequestHeader('a','b');other.send();
  assert.deepEqual(other.opened,[['GET','https://example.com/x']]);assert.equal(other.headerSet,true);assert.equal(other.sent,1);assert.equal(other.getResponseHeader('x'),'real');assert.equal(other.readyState,undefined);
  // reopened on a website: the file state is gone
  const reused=new XMLHttpRequest();reused.open('GET',url('note.txt'));reused.open('GET','https://example.com/y');assert.equal(Object.prototype.hasOwnProperty.call(reused,'readyState'),false);assert.deepEqual(reused.opened,[['GET','https://example.com/y']]);
 }finally{w.restore();}
});

test('XMLHttpRequest: a failed read is an error event, abort() stops it quietly, POST and a synchronous open are refused, setRequestHeader needs OPENED',async()=>{
 const w=world({answers:address=>address.endsWith('gone.txt')?Promise.reject(new Error('ERR_FILE_NOT_FOUND')):new Promise(resolve=>setTimeout(()=>resolve(reply('late')),30))});
 try{
  const failed=new XMLHttpRequest();const finished=done(failed,['error','load','loadend']);failed.open('GET',url('gone.txt'));failed.send();
  const seen=await finished;assert.deepEqual(seen.map(e=>e[0]),['error','loadend']);assert.deepEqual([failed.readyState,failed.status,failed.response,failed.responseURL],[4,0,'','']);
  const slow=new XMLHttpRequest(),events=[];for(const type of ['load','abort','loadend','error'])slow.addEventListener(type,()=>events.push(type));
  slow.open('GET',url('note.txt'));slow.send();slow.abort();await new Promise(resolve=>setTimeout(resolve,80));
  assert.deepEqual(events,['abort','loadend'],'no load after an abort');assert.equal(slow.readyState,0);
  const post=new XMLHttpRequest();const errored=done(post,['error','loadend']);post.open('POST',url('note.txt'));post.send('x');assert.deepEqual((await errored).map(e=>e[0]),['error','loadend']);
  const sync=new XMLHttpRequest();assert.throws(()=>sync.open('GET',url('note.txt'),false),error=>error.name==='NotSupportedError');
  const late=new XMLHttpRequest();late.open('GET',url('note.txt'));late.send();assert.throws(()=>late.setRequestHeader('a','b'),error=>error.name==='InvalidStateError');assert.throws(()=>late.send(),error=>error.name==='InvalidStateError');
 }finally{w.restore();}
});

test('the packages are listed, the renderer reaches every context (a page and a worker), and the handler is Acira-internal and gated by the extension\'s switch',()=>{
 const found=extApi.loadPackages({fresh:true}).find(entry=>entry.name==='extension');
 assert.ok(found&&typeof found.install==='function'&&typeof found.renderer==='function',JSON.stringify(found&&found.files));
 assert.deepEqual(found.namespaces,['extension']);assert.deepEqual(found.files.sort(),['extension-renderer.cjs','extension.cjs']);
 const registered=[];
 pkg.install({handle:(name,callback,options)=>registered.push({name,callback,options}),fileAccessAllowed:id=>id==='abcdefghijklmnopabcdefghijklmnop'});
 assert.deepEqual(registered.map(entry=>[entry.name,entry.options]),[['acira.file.read',{check:false}]]);
 return Promise.all([
  registered[0].callback({extension:{id:'abcdefghijklmnopabcdefghijklmnop'}},url('note.txt')).then(reply=>assert.equal(reply.status,200)),
  assert.rejects(Promise.resolve().then(()=>registered[0].callback({extension:{id:'ponmlkjihgfedcbaponmlkjihgfedcba'}},url('note.txt'))),/not allowed/),
  assert.rejects(Promise.resolve().then(()=>registered[0].callback({},url('note.txt'))),/not allowed/)
 ]);
});

test('the preload carries the ids with the switch on (per extension) into the renderer source',()=>{
 const text=extApi.rendererSource({fileAccess:['abcdefghijklmnopabcdefghijklmnop','bad id','ponmlkjihgfedcbaponmlkjihgfedcba']});
 assert.match(text,/fileAccess: \["abcdefghijklmnopabcdefghijklmnop","ponmlkjihgfedcbaponmlkjihgfedcba"\]\.includes\(extensionId\)/,'valid ids only, sorted');
 assert.match(extApi.rendererSource({}),/fileAccess: \[\]\.includes\(extensionId\)/);
 assert.match(text,/acira\.file\.read/,'the extension package renderer, with the file requests, is in the source');
});

// ---- chrome.permissions: a file: host pattern is only one of the extension's permissions with the switch on (Chromium permissions_parser.cc ParseHostPermissions drops SCHEME_FILE
// without ALLOW_FILE_ACCESS; the real app showed scripting on a file: page refused with the switch off and allowed with it on)
function permissionsWorld({fileAccess}) {
  const ID = 'abcdefghijklmnopabcdefghijklmnop';
  const ext = {id: ID, manifest: {manifest_version: 3, name: 'Files', version: '1', permissions: ['storage'], host_permissions: ['https://a.test/*', 'file:///*'], optional_host_permissions: ['file:///docs/*']}};
  const handlers = new Map();
  const router = {handlers, listeners: new Map(), handle(name, callback) { handlers.set(name, {callback, extensionContext: true}); }, sendEvent() {}, broadcastEvent() {}};
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-file-perm-'));
  const {createPermissionTable} = require('../desktop/browser-services/extension-permission-table.cjs');
  const permissions = createPermissionTable({userData, storeKey: 'p1', getExtension: id => (id === ID ? ext : null), fileAccess: id => id === ID && fileAccess});
  permissions.request = async (target, request) => { permissions.grant(target, request); return permissions.contains(target, request); };
  const packages = extApi.loadPackages({fresh: true}).filter(entry => entry.name === 'permissions');
  extApi.installPackages({session: {}, runtime: {ctx: {router}}, router, userData, storeKey: 'p1', getExtension: id => (id === ID ? ext : null), emit() {}, permissions, log() {}}, {packages, log() {}});
  return {call: (name, ...args) => handlers.get(name).callback({type: 'frame', extension: ext}, ...args), table: permissions, cleanup: () => fs.rmSync(userData, {recursive: true, force: true})};
}

test('chrome.permissions with the switch off: file: patterns are not held, not listed and cannot be requested (Chromium\'s message)', async () => {
  const w = permissionsWorld({fileAccess: false});
  try {
    assert.equal(w.table.fileAccess({id: 'abcdefghijklmnopabcdefghijklmnop'}), false);
    assert.deepEqual((await w.call('permissions.getAll')).origins, ['https://a.test/*'], 'the file: pattern is not one of its permissions');
    assert.equal(await w.call('permissions.contains', {origins: ['file:///*']}), false);
    await assert.rejects(Promise.resolve(w.call('permissions.request', {origins: ['file:///docs/*']})).then(result => { if (result && result.__acira_error) throw new Error(result.__acira_error); }), /Extension must have file access enabled to request 'file:\/\/\/docs\/\*'\./);
  } finally { w.cleanup(); }
});

test('chrome.permissions with the switch on: the declared file: pattern is held and listed, an optional one can be requested like any other', async () => {
  const w = permissionsWorld({fileAccess: true});
  try {
    assert.equal(w.table.fileAccess({id: 'abcdefghijklmnopabcdefghijklmnop'}), true);
    assert.deepEqual((await w.call('permissions.getAll')).origins.sort(), ['file:///*', 'https://a.test/*']);
    assert.equal(await w.call('permissions.contains', {origins: ['file:///*']}), true, 'required');
    assert.equal(await w.call('permissions.contains', {origins: ['file:///some/file.txt']}), true, 'inside it');
    assert.equal(await w.call('permissions.request', {origins: ['file:///docs/*']}), true, 'an optional one, held already through the required file:///*');
    assert.equal(await w.call('permissions.contains', {origins: ['file:///elsewhere/*']}), true);
  } finally { w.cleanup(); }
  assert.equal(createPermissionTable0().fileAccess({id: 'x'}), false, 'a table made with no hook says no');
  function createPermissionTable0() { return require('../desktop/browser-services/extension-permission-table.cjs').createPermissionTable({userData: dir, storeKey: 'q'}); }
});
