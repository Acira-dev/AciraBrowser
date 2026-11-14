'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const crypto=require('node:crypto');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createVault}=require('../desktop/passwords/vault.cjs');
const {createPageBridge}=require('../desktop/passwords/page-bridge.cjs');
const {placement,createPromptFrame}=require('../desktop/passwords/prompt-frame.cjs');

const deviceKey=crypto.createHash('sha256').update('page').digest();
const keys={available:()=>true,wrap:b=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',deviceKey,iv);return Buffer.concat([iv,c.update(b),c.final(),c.getAuthTag()]);},unwrap:blob=>{const d=crypto.createDecipheriv('aes-256-gcm',deviceKey,blob.subarray(0,12));d.setAuthTag(blob.subarray(blob.length-16));return Buffer.concat([d.update(blob.subarray(12,blob.length-16)),d.final()]);}};
const P='profile-personal',DOC='doc1';
function harness({url='https://app.example.test/login',enabled=true}={}){
 const vault=createVault({dir:fs.mkdtempSync(path.join(os.tmpdir(),'acira-pwp-')),keys});
 const h={vault,shows:[],hides:0,sent:[],toasts:[],clock:1000,timers:[],tabUrl:url,owner:{tabId:'tab1',profileId:P,private:false,url,active:true},service:{vault,enabled}};
 h.timers_={setTimeout:(fn,ms)=>{const t={fn,ms,cleared:false};h.timers.push(t);return t;},clearTimeout:t=>{if(t)t.cleared=true;}};
 h.bridge=createPageBridge({service:h.service,ownerOf:event=>event.owner===undefined?h.owner:event.owner,ui:{show:spec=>h.shows.push(spec),hide:()=>{h.hides++;}},page:{send:(tab,channel,payload)=>h.sent.push({tab,channel,payload}),url:()=>h.tabUrl,focus:()=>h.sent.push({focus:true})},notify:text=>h.toasts.push(text),now:()=>h.clock,timers:h.timers_});
 h.msg=(channel,payload,event={})=>h.bridge.message(channel,event,{docId:DOC,...payload});
 h.field=(extra={})=>({role:'password',kind:'login',fieldId:'f2',usernameId:'f1',passwordIds:['f2'],freshIds:[],rect:{x:100,y:200,width:300,height:32},...extra});
 h.fills=()=>h.sent.filter(s=>s.channel==='acira:pw-fill');
 h.submit=(extra={})=>h.msg('acira:pw-submit',{kind:'login',username:'ada',password:'S3cret-pass-1!',hadPrevious:false,...extra});
 return h;
}
const seed=(h,extra={})=>h.vault.save(P,{origin:'https://app.example.test',username:'ada',password:'old-password-7!',...extra});

test('focus: exact match offers the saved username; the list is Acira-drawn, no secrets sent to the frame',()=>{
 const h=harness();seed(h);h.msg('acira:pw-focus',h.field());
 assert.equal(h.shows.length,1);const spec=h.shows.at(-1);
 assert.deepEqual([spec.mode,spec.items.length,spec.items[0].label,spec.items[0].secondary],['suggest',1,'ada','']);
 assert.equal(JSON.stringify(spec).includes('old-password'),false);assert.deepEqual(h.sent.at(-1),{tab:'tab1',channel:'acira:pw-open',payload:{docId:DOC,open:true}});
});

test('focus: same-site login is labelled with its host; unrelated sites, signup username fields and nothing-saved show nothing',()=>{
 const site=harness({url:'https://login.example.test/'});seed(site);site.msg('acira:pw-focus',site.field());
 assert.equal(site.shows.at(-1).items[0].secondary,'app.example.test');
 const other=harness({url:'https://evil.test/'});seed(other);other.msg('acira:pw-focus',other.field());assert.equal(other.shows.length,0);
 const http=harness({url:'http://app.example.test/'});seed(http);http.msg('acira:pw-focus',http.field());assert.equal(http.shows.length,0,'https login is never offered on http');
 const signup=harness();seed(signup);signup.msg('acira:pw-focus',signup.field({role:'username',kind:'signup'}));assert.equal(signup.shows.length,0);
 const none=harness();none.msg('acira:pw-focus',none.field());assert.equal(none.shows.length,0);
});

test('focus: new-password fields offer the generator only',()=>{
 const h=harness();seed(h);h.msg('acira:pw-focus',h.field({role:'new-password',kind:'signup',passwordIds:['f2','f3'],freshIds:['f2','f3']}));
 assert.deepEqual(h.shows.at(-1).items.map(i=>i.kind),['generate']);
});

test('messages are validated: unknown owners, private, inactive tabs, disabled, bad fields, bad channels, floods',()=>{
 const h=harness();seed(h);
 h.msg('acira:pw-focus',h.field(),{owner:null});h.msg('acira:pw-focus',h.field(),{owner:{...h.owner,private:true}});h.msg('acira:pw-focus',h.field(),{owner:{...h.owner,active:false}});
 h.msg('acira:pw-focus',h.field(),{owner:{...h.owner,url:'file:///C:/x.html'}});h.msg('acira:pw-focus',h.field(),{owner:{...h.owner,url:'acira://settings'}});
 for(const bad of [{role:'x'},{kind:'x'},{fieldId:'<script>'},{passwordIds:['f1','f2','f3','f4','f5']},{rect:{x:NaN,y:0,width:1,height:1}},{rect:null},{usernameId:'a b'}])h.msg('acira:pw-focus',h.field(bad));
 h.bridge.message('acira:pw-focus',{},null);h.bridge.message('acira:pw-focus',{},'str');h.bridge.message('acira:other',{},{docId:DOC});h.bridge.message('acira:pw-focus',{},{docId:42});h.bridge.message('acira:pw-focus',{},{docId:'x'.repeat(100)});
 assert.equal(h.shows.length,0);
 const off=harness({enabled:false});seed(off);off.msg('acira:pw-focus',off.field());assert.equal(off.shows.length,0);
 const flood=harness();seed(flood);for(let i=0;i<100;i++)flood.msg('acira:pw-focus',flood.field());assert.ok(flood.shows.length<=40,'rate limited');
 flood.clock+=1500;flood.msg('acira:pw-focus',flood.field());assert.ok(flood.shows.length>0);
});

test('choose: fills the chosen login from main; refuses when the tab moved, the entry is gone or out of range',()=>{
 const h=harness();seed(h);h.msg('acira:pw-focus',h.field());h.bridge.choose(0);
 assert.deepEqual(h.fills().map(f=>f.payload),[{docId:DOC,usernameId:'f1',username:'ada',passwordIds:['f2'],password:'old-password-7!'}]);assert.ok(h.sent.some(s=>s.focus));
 const moved=harness();seed(moved);moved.msg('acira:pw-focus',moved.field());moved.tabUrl='https://other.test/';moved.bridge.choose(0);assert.equal(moved.fills().length,0);
 const gone=harness();const entry=seed(gone);gone.msg('acira:pw-focus',gone.field());gone.vault.remove(P,entry.id);gone.bridge.choose(0);assert.equal(gone.fills().length,0);
 const range=harness();seed(range);range.msg('acira:pw-focus',range.field());range.bridge.choose(5);range.bridge.choose(-1);range.bridge.choose(1.5);assert.equal(range.fills().length,0);
 const site=harness({url:'https://login.example.test/'});seed(site);site.msg('acira:pw-focus',site.field());site.bridge.choose(0);assert.equal(site.fills().length,1,'a same-site login is filled only after an explicit choice');
 const change=harness();seed(change);change.msg('acira:pw-focus',change.field({kind:'change',passwordIds:['f2','f3','f4'],freshIds:['f3','f4']}));change.bridge.choose(0);assert.deepEqual(change.fills()[0].payload.passwordIds,['f2'],'only the current-password field gets a saved password');
});

test('choose: generator fills the new-password fields with a strong password and nothing else',()=>{
 const h=harness();h.msg('acira:pw-focus',h.field({role:'new-password',kind:'signup',passwordIds:['f2','f3'],freshIds:['f2','f3']}));h.bridge.choose(0);
 const fill=h.fills()[0].payload;assert.deepEqual(fill.passwordIds,['f2','f3']);assert.equal(fill.password.length,20);assert.equal('username' in fill,false);
});

test('keyboard: arrows move the highlight, Enter fills it, Escape closes',()=>{
 const h=harness();seed(h);seed(h,{username:'bob'});h.msg('acira:pw-focus',h.field());
 h.msg('acira:pw-key',{key:'ArrowDown'});assert.equal(h.shows.at(-1).index,0);h.msg('acira:pw-key',{key:'ArrowDown'});assert.equal(h.shows.at(-1).index,1);h.msg('acira:pw-key',{key:'ArrowDown'});assert.equal(h.shows.at(-1).index,0,'wraps');
 h.msg('acira:pw-key',{key:'ArrowUp'});assert.equal(h.shows.at(-1).index,1);
 h.msg('acira:pw-key',{key:'Enter'});assert.equal(h.fills().length,1);assert.equal(h.fills()[0].payload.username,'bob');
 h.msg('acira:pw-focus',h.field());h.msg('acira:pw-key',{key:'Escape'});assert.equal(h.bridge.shown,null);
 h.msg('acira:pw-focus',h.field());h.msg('acira:pw-key',{key:'Enter'});assert.equal(h.fills().length,1,'Enter with nothing highlighted fills nothing');
});

test('sign-in that worked: the next page has no sign-in form -> offer to save; Save stores it, Never remembers the site',()=>{
 const h=harness();h.submit();assert.equal(h.shows.length,0,'nothing before the outcome is known');
 assert.ok(h.timers.some(t=>t.ms===450),'the tab is probed for the outcome');
 h.msg('acira:pw-ready',{docId:'doc2',passwordFields:-1});assert.equal(h.shows.length,0,'still loading: wait');
 h.msg('acira:pw-ready',{docId:'doc2',passwordFields:0,typing:false});
 const spec=h.shows.at(-1);assert.deepEqual([spec.mode,spec.kind,spec.host,spec.username,spec.masked],['save','save','app.example.test','ada','•'.repeat(12)]);assert.equal(JSON.stringify(spec).includes('S3cret'),false,'the frame never gets the password');
 h.bridge.action('save');assert.deepEqual(h.vault.list(P).map(e=>e.username),['ada']);assert.equal(h.vault.secret(P,h.vault.list(P)[0].id).password,'S3cret-pass-1!');assert.deepEqual(h.toasts,['Password saved']);assert.equal(h.bridge.shown,null);
 const never=harness();never.submit();never.msg('acira:pw-ready',{docId:'doc2',passwordFields:0});never.bridge.action('never');
 assert.equal(never.vault.list(P).length,0);assert.equal(never.vault.isNever(P,'https://app.example.test/x'),true);
 never.submit({password:'Another-1!'});never.msg('acira:pw-ready',{docId:'doc3',passwordFields:0});assert.equal(never.shows.filter(s=>s.mode==='save').length,1,'no second prompt for a never-saved site');
});

test('sign-in that failed: the form is still there afterwards -> no prompt, nothing pending',()=>{
 const h=harness();h.submit();h.msg('acira:pw-ready',{docId:'doc2',passwordFields:1});assert.equal(h.shows.length,0);assert.equal(h.bridge.pendingFor('tab1'),null);
 h.msg('acira:pw-ready',{docId:'doc3',passwordFields:0});assert.equal(h.shows.length,0,'the attempt was dropped, a later page does not revive it');
 const spa=harness();spa.submit();spa.msg('acira:pw-form-stays',{});assert.equal(spa.bridge.pendingFor('tab1'),null);spa.msg('acira:pw-form-gone',{});assert.equal(spa.shows.length,0);
});

test('single-page sign-in: the form disappearing in the same document is success',()=>{
 const h=harness();h.submit();h.msg('acira:pw-ready',{docId:DOC,passwordFields:0});assert.equal(h.shows.length,0,'same document: only the form signals count');
 h.msg('acira:pw-form-gone',{});assert.equal(h.shows.at(-1).mode,'save');
 const other=harness();other.submit();other.msg('acira:pw-form-gone',{},{});other.bridge.message('acira:pw-form-gone',{},{docId:'someone-else'});
});

test('update: a changed password offers Update; the same password stays silent; empty username matches the only saved login',()=>{
 const h=harness();seed(h);h.submit();h.msg('acira:pw-ready',{docId:'doc2',passwordFields:0});
 assert.deepEqual([h.shows.at(-1).kind,h.shows.at(-1).username],['update','ada']);h.bridge.action('save');assert.deepEqual(h.toasts,['Password updated']);
 assert.equal(h.vault.list(P).length,1);assert.equal(h.vault.secret(P,h.vault.list(P)[0].id).password,'S3cret-pass-1!');
 const same=harness();seed(same,{password:'S3cret-pass-1!'});same.submit();same.msg('acira:pw-ready',{docId:'doc2',passwordFields:0});assert.equal(same.shows.length,0);
 const change=harness();seed(change);change.submit({kind:'change',username:'',password:'Brand-new-9#',hadPrevious:true});change.msg('acira:pw-ready',{docId:'doc2',passwordFields:0});
 assert.deepEqual([change.shows.at(-1).kind,change.shows.at(-1).username],['update','ada']);
 const other=harness();seed(other);other.submit({username:'carol'});other.msg('acira:pw-ready',{docId:'doc2',passwordFields:0});assert.equal(other.shows.at(-1).kind,'save');
});

test('prompt lifecycle: dismiss, timeout, tab switch and tab close leave nothing saved',()=>{
 const h=harness();h.submit();h.msg('acira:pw-ready',{docId:'doc2',passwordFields:0});h.bridge.action('dismiss');assert.equal(h.vault.list(P).length,0);assert.equal(h.bridge.shown,null);
 const timeout=harness();timeout.submit();timeout.msg('acira:pw-ready',{docId:'doc2',passwordFields:0});const expire=timeout.timers.filter(t=>t.ms===30000).at(-1);expire.fn();assert.equal(timeout.bridge.shown,null);assert.equal(timeout.vault.list(P).length,0);
 const sw=harness();sw.submit();sw.msg('acira:pw-ready',{docId:'doc2',passwordFields:0});sw.bridge.onState({activeTabId:'tab2',tabs:[{id:'tab1'},{id:'tab2'}]});assert.equal(sw.bridge.shown,null);
 const closed=harness();closed.submit();closed.bridge.onState({activeTabId:'tab2',tabs:[{id:'tab2'}]});assert.equal(closed.bridge.pendingFor('tab1'),null);
 const stale=harness();stale.submit();stale.timers.filter(t=>t.ms===15000).at(-1).fn();stale.msg('acira:pw-ready',{docId:'doc2',passwordFields:0});assert.equal(stale.shows.length,0,'a late page after the window expired is ignored');
 const lateSave=harness();lateSave.submit();lateSave.msg('acira:pw-ready',{docId:'doc2',passwordFields:0});lateSave.bridge.hide();lateSave.bridge.action('save');assert.equal(lateSave.vault.list(P).length,0,'action after the prompt closed does nothing');
});

test('submit: malformed reports are ignored; the page origin comes from the browser',()=>{
 const h=harness();
 for(const bad of [{kind:'x'},{username:5},{password:''},{password:'p'.repeat(2000)},{username:'u'.repeat(600)},{password:undefined}])h.submit(bad);
 assert.equal(h.bridge.pendingFor('tab1'),null);
 h.msg('acira:pw-submit',{kind:'login',username:'ada',password:'pw-1-Strong!',origin:'https://bank.test',url:'https://bank.test/'});
 h.msg('acira:pw-ready',{docId:'doc2',passwordFields:0});h.bridge.action('save');
 assert.deepEqual(h.vault.list(P).map(e=>e.origin),['https://app.example.test'],'saved under the origin the browser reported, not the one in the message');
 const priv=harness();priv.bridge.message('acira:pw-submit',{owner:{...priv.owner,private:true}},{docId:DOC,kind:'login',username:'a',password:'b'});
});

test('prompt frame placement: suggestions under the field, flipped above at the edge; prompt at the page top-right',()=>{
 const page={x:0,y:68,width:1200,height:800};
 assert.deepEqual(placement({mode:'suggest',page,rect:{x:100,y:200,width:300,height:32},zoom:1,count:2}),{x:100,y:68+232+4,width:300,height:2*34+8});
 const low=placement({mode:'suggest',page,rect:{x:100,y:760,width:300,height:32},zoom:1,count:3});assert.ok(low.y+low.height<=68+760,'flips above the field');
 const wide=placement({mode:'suggest',page,rect:{x:1100,y:100,width:300,height:32},zoom:1,count:1});assert.ok(wide.x+wide.width<=1200,'clamped to the page');
 assert.equal(placement({mode:'suggest',page,rect:{x:0,y:0,width:100,height:30},zoom:1,count:1}).width,260,'minimum width');
 const zoomed=placement({mode:'suggest',page,rect:{x:100,y:100,width:200,height:30},zoom:1.5,count:1});assert.equal(zoomed.x,150);
 assert.deepEqual(placement({mode:'save',page}),{x:1200-320-16,y:76,width:320,height:164});
 assert.equal(placement({mode:'save',page:{x:0,y:0,width:300,height:300}}).width,268);assert.equal(placement({mode:'save',page:null}),null);assert.equal(placement({mode:'suggest',page:{x:0,y:0,width:0,height:5},rect:{x:0,y:0,width:1,height:1},count:1}),null);
});

test('password prompts stay inside narrow split panes and short page areas, including offscreen fields',()=>{
 for(const page of [{x:320,y:68,width:200,height:120},{x:0,y:0,width:700,height:80},{x:50,y:20,width:1,height:1}])for(const mode of ['save','suggest'])for(const rect of [{x:180,y:90,width:100,height:30},{x:-100,y:-500,width:500,height:30},{x:900,y:1000,width:300,height:30}]){
  const b=placement({mode,page,rect,count:8});assert.ok(b.width>0&&b.height>0);
  assert.ok(b.x>=page.x&&b.y>=page.y);assert.ok(b.x+b.width<=page.x+page.width&&b.y+b.height<=page.y+page.height);
 }
});

test('save prompt dismissal restores page focus and the native view forwards its focus request',()=>{
 const h=harness();h.submit();h.msg('acira:pw-ready',{docId:'doc2',passwordFields:0});h.bridge.action('dismiss');assert.ok(h.sent.some(s=>s.focus));
 const {EventEmitter}=require('node:events'),sent=[];let view;
 class NativeView{constructor(){view=this;this.webContents=Object.assign(new EventEmitter(),{ipc:new EventEmitter(),isDestroyed:()=>false,setWindowOpenHandler(){},loadFile:async()=>{},send:(_c,state)=>sent.push(state),focus(){this.focused=true},close(){}})}setBackgroundColor(){}setVisible(){}setBounds(){}}
 const window={isDestroyed:()=>false,contentView:{children:[],addChildView(v){this.children=[v]},removeChildView(){}}};
 const frame=createPromptFrame({WebContentsView:NativeView,getWindow:()=>window,boundsOf:()=>({x:0,y:0,width:500,height:400})});
 frame.show({mode:'save',tabId:'owned',anchored:true,focus:true});view.webContents.ipc.emit('acira:pw-frame',{},'ready');assert.equal(sent.at(-1).focus,true);assert.equal(view.webContents.focused,true);
 frame.show({mode:'save',tabId:'owned',anchored:true,focus:false});assert.equal(sent.at(-1).focus,false);frame.dispose();
});


test('username-first sign-ins: the username from the previous page is used for the password page, same tab and origin only',()=>{
 const h=harness();
 h.msg('acira:pw-username',{username:'  grace@example.test '});
 h.submit({username:''});h.msg('acira:pw-ready',{docId:'doc2',passwordFields:0});
 const spec=h.shows.at(-1);assert.deepEqual([spec.mode,spec.kind,spec.username],['save','save','grace@example.test']);
 h.bridge.action('save');assert.equal(h.vault.list(P)[0].username,'grace@example.test');
 // it is spent once the sign-in works: a later password page does not borrow it
 const again=h.vault.list(P).length;h.submit({username:'',password:'Other-pass-9!'});h.msg('acira:pw-ready',{docId:'doc3',passwordFields:0});
 assert.equal(h.shows.at(-1).username,'grace@example.test','the saved account is the only one, so it is offered as the update target');
 // a username typed on the password page itself always wins; a stale or other-origin step is ignored
 const typed=harness();typed.msg('acira:pw-username',{username:'old@example.test'});typed.submit({username:'new@example.test'});typed.msg('acira:pw-ready',{docId:'doc2',passwordFields:0});assert.equal(typed.shows.at(-1).username,'new@example.test');
 const stale=harness();stale.msg('acira:pw-username',{username:'old@example.test'});stale.clock+=6*60*1000;stale.submit({username:''});stale.msg('acira:pw-ready',{docId:'doc2',passwordFields:0});assert.equal(stale.shows.at(-1).username,'');
 const other=harness();other.msg('acira:pw-username',{username:'old@example.test'});other.owner.url='https://evil.test/login';other.submit({username:''});other.msg('acira:pw-ready',{docId:'doc2',passwordFields:0});assert.equal(other.shows.at(-1).username,'');
 const tabs=harness();tabs.msg('acira:pw-username',{username:'a@example.test'},{owner:{...tabs.owner,tabId:'tabB'}});tabs.submit({username:''});tabs.msg('acira:pw-ready',{docId:'doc2',passwordFields:0});assert.equal(tabs.shows.at(-1).username,'','another tab\'s step is never used');
 assert.ok(again>=1);
});

test('username step: validated, private tabs ignored, and the password page prefers the account just typed',()=>{
 const h=harness();seed(h,{username:'ada'});seed(h,{username:'grace'});
 for(const bad of [{username:42},{username:''},{username:'   '},{username:'x'.repeat(600)},{}])h.msg('acira:pw-username',bad);
 h.msg('acira:pw-username',{username:'grace'},{owner:{...h.owner,private:true}});
 h.msg('acira:pw-focus',h.field({usernameId:''}));assert.deepEqual(h.shows.at(-1).items.map(i=>i.label).sort(),['ada','grace'],'nothing was remembered, so both are offered');
 h.msg('acira:pw-username',{username:'grace'});h.clock+=1500;
 h.msg('acira:pw-focus',h.field({usernameId:''}));assert.deepEqual(h.shows.at(-1).items.map(i=>i.label),['grace'],'only the typed account');
 h.msg('acira:pw-username',{username:'nobody'});h.clock+=1500;h.msg('acira:pw-focus',h.field({usernameId:''}));assert.equal(h.shows.at(-1).items.length,2,'an unknown account falls back to every saved login');
 h.msg('acira:pw-username',{username:'grace'});h.clock+=1500;h.msg('acira:pw-focus',h.field());assert.equal(h.shows.at(-1).items.length,2,'a page with its own username field is not filtered');
});

test('a private tab never captures, prompts, suggests or fills, on any channel',()=>{
 const h=harness();seed(h);const priv={owner:{...h.owner,private:true}};
 h.msg('acira:pw-focus',h.field(),priv);h.msg('acira:pw-username',{username:'ada'},priv);h.msg('acira:pw-key',{key:'ArrowDown'},priv);
 h.msg('acira:pw-submit',{kind:'login',username:'ada',password:'S3cret-pass-1!',hadPrevious:false},priv);
 h.msg('acira:pw-ready',{docId:'doc2',passwordFields:0},priv);h.msg('acira:pw-form-gone',{},priv);h.msg('acira:pw-form-stays',{},priv);h.msg('acira:pw-dismiss',{},priv);
 assert.deepEqual([h.shows.length,h.hides,h.sent.length],[0,0,0],'nothing shown, nothing sent to any page');
 assert.equal(h.bridge.pendingFor('tab1'),null);assert.equal(h.bridge.shown,null);h.bridge.choose(0);assert.equal(h.fills().length,0);
 // the username step of a private tab is not remembered for the same tab id either
 h.msg('acira:pw-submit',{kind:'login',username:'',password:'x-Pass-1!'},priv);h.submit({username:''});h.msg('acira:pw-ready',{docId:'doc2',passwordFields:0});assert.equal(h.shows.at(-1).username,'ada','no remembered name came from the private step (the lone saved account is the update target)');
});

test('save prompt placement: under the right end of the address field, clamped to the window, top-right of the page without one',async()=>{
 const {readAddressRect}=require('../desktop/passwords/window.cjs');
 const page={x:0,y:76,width:1200,height:800},anchor={x:116,y:36,width:900,height:28},size={width:1200,height:900};
 assert.deepEqual(placement({mode:'save',page,anchor,window:size}),{x:900+116-320,y:36+28+4,width:320,height:164},'right edges line up, 4px below the field');
 assert.equal(placement({mode:'save',page,anchor:{x:0,y:36,width:200,height:28},window:size}).x,8,'never off the left edge');
 assert.equal(placement({mode:'save',page,anchor:{x:900,y:36,width:900,height:28},window:size}).x,1200-320-8,'never off the right edge');
 assert.deepEqual(placement({mode:'save',page,anchor:{x:0,y:0,width:0,height:0},window:size}),placement({mode:'save',page}),'an empty field falls back to the page corner');
 assert.deepEqual(placement({mode:'save',page,anchor:null}),{x:1200-320-16,y:84,width:320,height:164});
 const contents=(result,destroyed=false)=>({isDestroyed:()=>destroyed,executeJavaScript:async script=>{assert.match(script,/.address-field/);if(result instanceof Error)throw result;return result;}});
 assert.deepEqual(await readAddressRect({contents:contents({x:100,y:30,width:800,height:32}),scale:1.25}),{x:125,y:37.5,width:1000,height:40},'interface scale turns CSS pixels into DIPs');
 for(const bad of [null,{x:1,y:2,width:'a',height:3},{x:NaN,y:0,width:1,height:1}])assert.equal(await readAddressRect({contents:contents(bad)}),null);
 assert.equal(await readAddressRect({contents:contents(null,true)}),null,'a destroyed view is no anchor');assert.equal(await readAddressRect({contents:null}),null);
 await assert.rejects(readAddressRect({contents:contents(new Error('gone'))}),/gone/,'the frame treats a failed read as no anchor (askAnchor catches it)');
});

test('the prompt frame waits for the address field, a newer hide cancels a pending show, and a failed read falls back to the page corner',async()=>{
 const {createPromptFrame}=require('../desktop/passwords/prompt-frame.cjs');
 const tick=()=>new Promise(resolve=>setImmediate(resolve));
 let last=null;
 class FakeView{constructor(){last=this;this.bounds=null;this.shown=false;this.sent=[];this.webContents={isDestroyed:()=>false,setWindowOpenHandler(){},on(){},ipc:{on:()=>{}},loadFile:async()=>{},send:(...args)=>this.sent.push(args),focus(){},close(){}};}setBackgroundColor(){}setVisible(value){this.shown=value;}setBounds(bounds){this.bounds=bounds;}}
 const win={isDestroyed:()=>false,getContentSize:()=>[1200,900],contentView:{children:[],addChildView(view){this.children=this.children.filter(v=>v!==view);this.children.push(view);},removeChildView(){}}};
 const page={x:0,y:76,width:1200,height:800},spec={mode:'save',tabId:'t',kind:'save',host:'h',username:'u',masked:'••'};
 const make=anchorOf=>createPromptFrame({WebContentsView:FakeView,getWindow:()=>win,boundsOf:()=>page,anchorOf});
 const anchored=make(async()=>({x:116,y:36,width:900,height:28}));
 anchored.show(spec);assert.equal(anchored.visible,false,'nothing is shown until the field has been read');await tick();
 assert.deepEqual([anchored.visible,last.shown,last.bounds],[true,true,{x:696,y:68,width:320,height:164}]);
 anchored.hide(true);await tick();
 const cancelled=make(async()=>({x:116,y:36,width:900,height:28}));cancelled.show(spec);cancelled.hide();await tick();assert.equal(cancelled.visible,false,'a hide that arrives first wins');
 const failing=make(async()=>{throw new Error('chrome view gone');});failing.show(spec);await tick();
 assert.deepEqual([failing.visible,last.bounds],[true,{x:1200-320-16,y:84,width:320,height:164}],'no readable field: page top-right');
 const none=make(async()=>null);none.show(spec);await tick();assert.equal(last.bounds.y,84);
 const disposed=make(async()=>({x:116,y:36,width:900,height:28}));disposed.show(spec);disposed.dispose();await tick();assert.equal(disposed.visible,false,'a disposed owner cannot be recreated by a late address read');
 const list=make(async()=>({x:0,y:0,width:10,height:10}));list.show({mode:'suggest',tabId:'t',rect:{x:100,y:200,width:300,height:32},items:[{kind:'login',label:'ada',secondary:''}],index:-1});assert.equal(list.visible,true,'the suggestion list never waits');
});

test('anchored save prompts fit small window bounds even with a narrow split page or offscreen anchor',()=>{
 const page={x:80,y:60,width:120,height:80};
 for(const window of [{width:200,height:120},{width:700,height:90},{width:1,height:1}])for(const anchor of [{x:-500,y:-100,width:200,height:30},{x:900,y:1000,width:300,height:30}]){
  const b=placement({mode:'save',page,anchor,window});assert.ok(b.x>=0&&b.y>=0);assert.ok(b.width>0&&b.height>0);assert.ok(b.x+b.width<=window.width&&b.y+b.height<=window.height);
 }
});

test('a password manager extension that holds chrome.privacy.services.passwordSavingEnabled at false switches the save offer and the saved-login list off; clearing it brings them back',()=>{
 // Chrome's password manager follows kCredentialsEnableService, which the extension controls (chrome/browser/extensions/api/preference/preference_api.cc).
 const chromeSettings=require('../desktop/browser-services/extension-chrome-settings.cjs');
 const store=chromeSettings.forProfile(P),key='privacy.services.passwordSavingEnabled',BW='nngceckbapebfimnlniiiahkandclblb';
 try{
  store.setValue(key,BW,false,'regular','Bitwarden Password Manager');
  const h=harness();seed(h);
  h.msg('acira:pw-focus',h.field());assert.equal(h.shows.length,0,'no saved-login list');
  h.submit();h.msg('acira:pw-ready',{docId:'doc2',passwordFields:0});assert.equal(h.shows.length,0,'no save offer');
  store.setValue(key,BW,true,'regular');
  const on=harness();on.submit();on.msg('acira:pw-ready',{docId:'doc2',passwordFields:0});assert.equal(on.shows.at(-1)?.mode,'save','the extension\'s true leaves the offer to the person\'s switch (on here)');
  const off=harness({enabled:false});off.submit();off.msg('acira:pw-ready',{docId:'doc2',passwordFields:0});assert.equal(off.shows.length,0,'and never turns it on against the person\'s "off"');
  store.clearValue(key,BW);
  const back=harness();back.submit();back.msg('acira:pw-ready',{docId:'doc2',passwordFields:0});assert.equal(back.shows.at(-1)?.mode,'save');
 }finally{chromeSettings.reset();}
});
