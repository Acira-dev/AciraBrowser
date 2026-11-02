'use strict';
// A page a form posted cannot be reloaded until the person agrees to send the form again. Chromium waits for that answer and Electron never
// asks, so the reload did not start: Cmd+R did nothing and the Reload button stayed on Stop with a progress line that never ended.
const test=require('node:test'),assert=require('node:assert/strict');
const {guardFormResend,sameAddress}=require('../desktop/form-resend.cjs');

/** A page whose reload starts loading, unless `holdsReload` (a POST result: Chromium waits for the form to be allowed again). */
function fixture({url='https://shop.example/order',holdsReload=false,agree=true,answer=null}={}){
 const log=[];let loading=false,destroyed=false,current=url;
 const wc={
  isDestroyed:()=>destroyed,isLoading:()=>loading,getURL:()=>current,
  reload(){log.push('reload');loading=!holdsReload;},reloadIgnoringCache(){log.push('reloadIgnoringCache');loading=!holdsReload;},
  loadURL(target){log.push('loadURL '+target);if(new URL(target).hash!==new URL(current).hash&&new URL(target).href.split('#')[0]===current.split('#')[0]){current=target;return Promise.resolve();}loading=!holdsReload;return Promise.resolve();},
  executeJavaScript(code){log.push('js '+code);return Promise.resolve();},
 };
 const hooks={settle:()=>log.push('settle'),begin:()=>log.push('begin'),ask:()=>{log.push('ask');return answer?answer():Promise.resolve(agree);}};
 guardFormResend(wc,hooks);
 return {wc,log,destroy:()=>{destroyed=true;},move:to=>{current=to;},hooks};
}
const settled=()=>new Promise(resolve=>setImmediate(resolve));

test('a normal reload is left alone',async()=>{
 const f=fixture();f.wc.reload();await settled();assert.deepEqual(f.log,['reload']);
});

test('a reload that does not start asks, and a yes reloads from the page, which sends the form again',async()=>{
 const f=fixture({holdsReload:true,agree:true});f.wc.reload();await settled();
 assert.deepEqual(f.log,['reload','settle','ask','begin','js location.reload()']);
});

test('a no leaves the page as it is, settled, with nothing sent',async()=>{
 const f=fixture({holdsReload:true,agree:false});f.wc.reloadIgnoringCache();await settled();
 assert.deepEqual(f.log,['reloadIgnoringCache','settle','ask']);
});

test('one question at a time, and a later reload asks again',async()=>{
 const f=fixture({holdsReload:true,agree:false});f.wc.reload();f.wc.reload();f.wc.reload();await settled();
 assert.equal(f.log.filter(item=>item==='ask').length,1);
 f.wc.reload();await settled();assert.equal(f.log.filter(item=>item==='ask').length,2);
});

test('the same address typed again is a reload to Chromium: it asks; another address or a #fragment does not',async()=>{
 const same=fixture({holdsReload:true,agree:false});same.wc.loadURL('https://shop.example/order');await settled();
 assert.deepEqual(same.log,['loadURL https://shop.example/order','settle','ask']);
 const other=fixture({holdsReload:false});other.wc.loadURL('https://shop.example/cart');await settled();
 assert.deepEqual(other.log,['loadURL https://shop.example/cart']);
 const fragment=fixture({holdsReload:true});fragment.wc.loadURL('https://shop.example/order#top');await settled();
 assert.deepEqual(fragment.log,['loadURL https://shop.example/order#top'],'a fragment change finishes at once: nothing is held');
});

test('only web pages: an Acira page, an empty view or a closed tab never asks',async()=>{
 for(const url of ['acira://settings','','about:blank']){const f=fixture({url,holdsReload:true});f.wc.reload();await settled();assert.deepEqual(f.log,['reload'],url);}
 const closed=fixture({holdsReload:true});closed.destroy();closed.wc.reload();await settled();assert.deepEqual(closed.log,['reload']);
});

test('nothing is sent if the tab closed or moved on while the question was open',async()=>{
 for(const change of [f=>f.move('https://shop.example/elsewhere'),f=>f.destroy()]){
  let resolve;const f=fixture({holdsReload:true,answer:()=>new Promise(done=>{resolve=done;})});
  f.wc.reload();await settled();change(f);resolve(true);await settled();
  assert.ok(!f.log.some(item=>item==='begin'||item.startsWith('js ')),JSON.stringify(f.log));
 }
});

test('the address comparison is exact',()=>{
 assert.ok(sameAddress('https://a.example/x?y=1','https://a.example/x?y=1'));
 assert.ok(!sameAddress('https://a.example/x','https://a.example/x#top'));
 assert.ok(!sameAddress('https://a.example/x','nonsense'));
});

test('main wires the guard to every tab page, with an in-window question and a catalog text',()=>{
 const fs=require('node:fs'),path=require('node:path'),main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 const at=main.indexOf("require('./form-resend.cjs').guardFormResend(wc,");assert.ok(at>0&&at<main.indexOf('popupGate.attach(wc);'),'set up with the page, before its watchers');
 const block=main.slice(at,at+900);
 for(const piece of ["tm('main.resendFormMessage')","tm('main.resendFormDetail')","tm('main.resendFormSend')","siteDialog(","centered:true,contents:wc"])assert.ok(block.includes(piece),piece);
 const en=require('../src/i18n/en.json');for(const id of ['main.resendFormMessage','main.resendFormDetail','main.resendFormSend'])assert.ok(en[id],id);
});
