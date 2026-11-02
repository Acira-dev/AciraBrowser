'use strict';
// R3-12: pop-up ads and pop-unders. Real bundled filter lists, fake windows.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
const {FiltersEngine}=require('@ghostery/adblocker');
const {createPopupPolicy,watchPopup,popupRule,popupRules,trustedHost,flowShaped}=require('../desktop/browser-services/popup-policy.cjs');

const filters=path.join(__dirname,'..','resources','filters');
const texts=['easylist.txt','easyprivacy.txt','unbreak.txt','ubo-filters.txt','ubo-quick-fixes.txt'].map(name=>fs.readFileSync(path.join(filters,name),'utf8'));
const extra=fs.readFileSync(path.join(filters,'popup-networks.txt'),'utf8');
const engine=FiltersEngine.parse(texts.join('\n'),{loadCosmeticFilters:false});
const make=(now=()=>1000)=>createPopupPolicy({getEngine:()=>engine,getTexts:()=>texts,getTextsKey:()=>'k',extraRules:extra,now});
const opener='https://streaming-site.com/watch/movie-1';

test('rules written for pop-ups become document rules the engine can read',()=>{
 assert.equal(popupRule('||adsession.com^$popup,doc'),'||adsession.com^$subdocument');
 assert.equal(popupRule('||example.com^$popup,third-party,domain=a.com|b.com'),'||example.com^$third-party,domain=a.com|b.com,subdocument');
 assert.equal(popupRule('$popup,third-party,domain=dood.la'),'*$third-party,domain=dood.la,subdocument');
 assert.equal(popupRule('*$popunder,domain=realgfporn.com'),'*$domain=realgfporn.com,subdocument');
 assert.equal(popupRule('@@||accounts.google.com^$popup'),'@@||accounts.google.com^$subdocument');
 assert.equal(popupRule('||example.com^$script'),null);
 assert.equal(popupRule('! a comment about $popup'),null);
 assert.equal(popupRule('example.com##.popup'),null);
 assert.ok(popupRules(texts).length>100,'the bundled uBlock lists carry well over a hundred pop-up rules');
 assert.ok(popupRules([extra]).length>=20);
});

test('known pop-up ad networks are refused, whether a script or a link opened them',()=>{
 const policy=make();
 for(const target of ['https://popads.net/pop.php?x=1','https://syndication.exoclick.com/splash.php?idzone=1','https://go.oclasrv.com/afu.php?zoneid=1','https://onclkds.com/redirect','https://www.profitablegatecpm.com/abc','https://clickadu.com/x','https://s.propellerclick.com/x']){
  assert.equal(policy.check({openerUrl:opener,targetUrl:target,linkClick:false,openerId:1}).block,true,target+' by script');
  assert.equal(policy.check({openerUrl:opener,targetUrl:target,linkClick:true,openerId:2}).block,true,target+' by link');
 }
});

test('the ordinary ad rules also apply to a window a script opened, but not to a link the person used',()=>{
 const policy=make();
 const generic='https://tzegilo.com/x';
 const scripted=policy.check({openerUrl:opener,targetUrl:generic,linkClick:false,openerId:1});
 assert.equal(scripted.block,true);assert.equal(scripted.reason,'ad-host');
 const clicked=policy.check({openerUrl:opener,targetUrl:generic,linkClick:true,openerId:2});
 assert.equal(clicked.block,false,'a link the person can see under the pointer opens');
});

test('site-specific pop-up rules read the opener: every third-party window from a listed site is refused, other sites are left alone',()=>{
 const policy=make();
 assert.equal(policy.check({openerUrl:'https://clik.pw/watch',targetUrl:'https://anything.example.com/x',linkClick:true,openerId:1}).block,true);
 assert.equal(policy.check({openerUrl:'https://clik.pw/watch',targetUrl:'https://clik.pw/other',linkClick:true,openerId:1}).block,false,'its own page is not third-party');
 assert.equal(policy.check({openerUrl:'https://other-site.com/watch',targetUrl:'https://anything.example.com/x',linkClick:true,openerId:1}).block,false);
 const exception=createPopupPolicy({getEngine:()=>null,getTexts:()=>['||bit.ly^$popup,domain=eurogamer.net','@@||bit.ly/ok^$popup'],getTextsKey:()=>'y'});
 assert.equal(exception.check({openerUrl:'https://eurogamer.net/a',targetUrl:'https://bit.ly/xyz',linkClick:true,openerId:1}).block,true);
 assert.equal(exception.check({openerUrl:'https://eurogamer.net/a',targetUrl:'https://bit.ly/ok',linkClick:true,openerId:1}).block,false,'an exception line wins');
});

test('sign-in, payment, share and ordinary windows are never refused',()=>{
 const policy=make();
 for(const target of ['https://accounts.google.com/o/oauth2/v2/auth?client_id=1&redirect_uri=x','https://login.microsoftonline.com/common/oauth2/v2.0/authorize','https://www.paypal.com/checkoutnow?token=EC-1','https://appleid.apple.com/auth/authorize','https://github.com/login/oauth/authorize?client_id=1','https://www.facebook.com/v18.0/dialog/oauth?client_id=1','https://www.facebook.com/sharer/sharer.php?u=x','https://twitter.com/intent/tweet?text=x','https://x.com/i/oauth2/authorize','https://www.linkedin.com/oauth/v2/authorization','https://discord.com/oauth2/authorize?client_id=1','https://checkout.stripe.com/c/pay/cs_1','https://open.spotify.com/authorize','https://dev-123.okta.com/oauth2/v1/authorize','https://secure.bank.example/login','https://t.me/share/url?url=x','https://en.wikipedia.org/wiki/X','https://news.ycombinator.com/item?id=1','https://pay.google.com/gp/w/u/0/home','https://www.amazon.com/ap/signin?x']){
  for(const linkClick of [false,true]){
   const verdict=policy.check({openerUrl:'https://shop.example/cart',targetUrl:target,linkClick,openerId:linkClick?3:4});
   assert.equal(verdict.block,false,target+' (link '+linkClick+') was '+verdict.reason+' '+verdict.filter);
  }
 }
 assert.equal(trustedHost(new URL('https://accounts.google.com/x')),true);
 assert.equal(trustedHost(new URL('https://www.paypal.com/x')),true);
 assert.equal(trustedHost(new URL('https://popads.net/x')),false);
 assert.equal(flowShaped(new URL('https://idp.example/oauth2/authorize?client_id=1')),true);
 assert.equal(flowShaped(new URL('https://ads.example/pop.php?x=1')),false);
});

test('an ad rule never wins over a sign-in host, even if a list names it',()=>{
 const policy=createPopupPolicy({getEngine:()=>null,getTexts:()=>['||accounts.google.com^$popup'],getTextsKey:()=>'x'});
 assert.equal(policy.check({openerUrl:opener,targetUrl:'https://accounts.google.com/signin',linkClick:false,openerId:1}).block,false);
 assert.equal(policy.check({openerUrl:opener,targetUrl:'https://ads.example/signin',linkClick:false,openerId:1}).block,false,'nothing names it');
});

test('a page may open its own windows; non-web addresses are left to the caller',()=>{
 const policy=make();
 assert.equal(policy.check({openerUrl:'https://site.example/a',targetUrl:'https://www.site.example/popout',linkClick:false,openerId:1}).block,false);
 assert.equal(policy.check({openerUrl:'https://site.example/a',targetUrl:'about:blank',linkClick:false,openerId:1}).block,false);
 assert.equal(policy.check({openerUrl:'https://site.example/a',targetUrl:'not a url',linkClick:false,openerId:1}).block,false);
});

test('a second script-opened window from one page a moment after the first is refused, then allowed again',()=>{
 let time=10000;const policy=make(()=>time);
 const first={openerUrl:opener,targetUrl:'https://partner-shop.example/deal',linkClick:false,openerId:7};
 assert.equal(policy.check(first).block,false);
 policy.opened(first);
 time+=1500;
 const second=policy.check({...first,targetUrl:'https://another-shop.example/offer'});
 assert.equal(second.block,true);assert.equal(second.reason,'burst');
 assert.equal(policy.check({...first,openerId:8}).block,false,'another page is not limited');
 time+=4000;
 assert.equal(policy.check({...first,targetUrl:'https://another-shop.example/offer'}).block,false,'later it is fine');
 policy.opened({...first,targetUrl:'https://accounts.google.com/signin'});
 time+=100;
 assert.equal(policy.check({...first,targetUrl:'https://third.example/'}).block,false,'sign-in windows do not count');
});

test('a link the person clicked is never limited by the one-at-a-time rule',()=>{
 let time=10000;const policy=make(()=>time);
 for(let i=0;i<4;i++){
  const open={openerUrl:opener,targetUrl:'https://news-'+i+'.example/story',linkClick:true,openerId:9};
  assert.equal(policy.check(open).block,false);
  policy.opened(open);time+=100;
 }
});

function fakePopup(){
 const popup=new EventEmitter(),contents=new EventEmitter();
 popup.webContents=contents;popup.destroyed=false;popup.closeCalls=0;
 popup.isDestroyed=()=>popup.destroyed;
 popup.visible=true;popup.focused=true;
 popup.isVisible=()=>popup.visible;popup.isFocused=()=>popup.focused;
 popup.close=()=>{popup.closeCalls++;popup.destroyed=true;};
 return popup;
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('a window sent on to a listed address is closed, and the move is cancelled',async()=>{
 const policy=make(),popup=fakePopup(),blocked=[];
 watchPopup({popup,opener:null,openerUrl:opener,judge:(url,from)=>policy.check({openerUrl:from,targetUrl:url,linkClick:false}),onBlocked:kind=>blocked.push(kind)});
 let prevented=false;
 popup.webContents.emit('will-navigate',{preventDefault(){prevented=true;}},'https://harmless.example/');
 assert.equal(prevented,false);
 popup.webContents.emit('will-redirect',{preventDefault(){prevented=true;}},'https://popads.net/pop.php');
 await tick();
 assert.equal(prevented,true);assert.deepEqual(blocked,['ad']);assert.equal(popup.closeCalls,1);
 popup.webContents.emit('will-navigate',{preventDefault(){}},'https://popads.net/again');
 await tick();assert.equal(popup.closeCalls,1,'closed once');
});

test('a sign-in window is not watched for ad hops',async()=>{
 const popup=fakePopup(),blocked=[];
 watchPopup({popup,openerUrl:opener,trusted:true,judge:()=>({block:true}),onBlocked:kind=>blocked.push(kind)});
 popup.webContents.emit('will-navigate',{preventDefault(){}},'https://popads.net/pop.php');
 popup.emit('blur');
 await tick();assert.deepEqual(blocked,[]);assert.equal(popup.closeCalls,0);
});

test('a window that sinks behind the page untouched is a pop-under; touching it or clicking the page first is not',async()=>{
 let time=5000;const judge=()=>({block:false});
 // pop-under: blur inside 2.5 s, nobody touched either window
 let popup=fakePopup(),blocked=[],opener1=new EventEmitter();
 watchPopup({popup,opener:opener1,openerUrl:opener,judge,onBlocked:kind=>blocked.push(kind),now:()=>time});
 time+=300;popup.emit('blur');await tick();
 assert.deepEqual(blocked,['under']);assert.equal(popup.closeCalls,1);
 // the person used the window first
 popup=fakePopup();blocked=[];
 watchPopup({popup,opener:new EventEmitter(),openerUrl:opener,judge,onBlocked:kind=>blocked.push(kind),now:()=>time});
 time+=200;popup.webContents.emit('before-mouse-event',{},{type:'mouseDown'});time+=100;popup.emit('blur');await tick();
 assert.deepEqual(blocked,[]);
 // the person clicked back on the page
 popup=fakePopup();blocked=[];const opener3=new EventEmitter();
 watchPopup({popup,opener:opener3,openerUrl:opener,judge,onBlocked:kind=>blocked.push(kind),now:()=>time});
 time+=400;opener3.emit('before-mouse-event',{},{type:'mouseDown'});time+=10;popup.emit('blur');await tick();
 assert.deepEqual(blocked,[]);
 // later than the window of 2.5 s
 popup=fakePopup();blocked=[];
 watchPopup({popup,opener:new EventEmitter(),openerUrl:opener,judge,onBlocked:kind=>blocked.push(kind),now:()=>time});
 time+=3000;popup.emit('blur');await tick();
 assert.deepEqual(blocked,[]);
 // a site's own window is not watched for it
 popup=fakePopup();blocked=[];
 watchPopup({popup,opener:new EventEmitter(),openerUrl:opener,watchUnder:false,judge,onBlocked:kind=>blocked.push(kind),now:()=>time});
 time+=100;popup.emit('blur');await tick();
 assert.deepEqual(blocked,[]);
});

test('a visible window that never had focus a moment after it opened, untouched, is under the page',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let time=1000;const judge=()=>({block:false});
 const run=(setup,input)=>{
  const popup=fakePopup(),blocked=[],openerContents=new EventEmitter();
  setup(popup);
  watchPopup({popup,opener:openerContents,openerUrl:opener,judge,onBlocked:kind=>blocked.push(kind),now:()=>time});
  input?.(popup,openerContents);
  time+=800;t.mock.timers.tick(800);
  return {popup,blocked};
 };
 let result=run(popup=>{popup.focused=false;});
 await tick();assert.deepEqual(result.blocked,['under'],'visible, behind, untouched');
 result=run(popup=>{popup.focused=true;});
 await tick();assert.deepEqual(result.blocked,[],'it has focus: the person is looking at it');
 result=run(popup=>{popup.focused=false;popup.visible=false;});
 await tick();assert.deepEqual(result.blocked,[],'a hidden window cannot be under anything');
 result=run(popup=>{popup.focused=false;},(popup)=>popup.webContents.emit('before-mouse-event',{},{type:'mouseDown'}));
 await tick();assert.deepEqual(result.blocked,[],'touched');
});
