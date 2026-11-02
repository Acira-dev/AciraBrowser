'use strict';
// R4-58 · The Preview chip on search results: which pages count, where results really go, and (in Electron, on local stand-ins of
// all six engines' result pages) that hovering or focusing a result shows the chip beside its title without moving anything,
// that a real click or Tab+Enter opens Peek for that result with its title box, and that it stays away when it should.
const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const {engineOf,resultTarget}=require('../desktop/browser-services/search-preview-preload.cjs');
const {bing}=require('./fixtures/search-preview/pages.cjs');

test('the result pages of the six engines count; their image tabs, other sites and plain http do not',()=>{
 for(const [address,id] of [['https://www.google.com/search?q=acira','google'],['https://www.google.co.uk/search?q=acira','google'],['https://www.bing.com/search?q=acira','bing'],['https://duckduckgo.com/?q=acira','duckduckgo'],['https://html.duckduckgo.com/html/?q=acira','duckduckgo'],['https://search.brave.com/search?q=acira','brave'],['https://www.startpage.com/sp/search?query=acira','startpage'],['https://www.ecosia.org/search?q=acira','ecosia']])assert.equal(engineOf(address)?.id,id,address);
 for(const address of ['https://www.google.com/search?q=acira&tbm=isch','https://www.google.com/search?q=acira&udm=2','https://www.google.com/','https://duckduckgo.com/','http://www.bing.com/search?q=acira','https://example.com/search?q=acira','https://google.example.com/search?q=x','not a url'])assert.equal(engineOf(address),null,address);
 assert.equal(engineOf('http://127.0.0.1:4000/acira-serp/bing/search?q=x')?.fixture,true,'a local fixture is marked (the browser answers it only in a test profile)');
 assert.equal(engineOf('http://127.0.0.1:4000/acira-serp/nope/search?q=x'),null);
});

test('a result opens at its destination: engine click-through addresses are unwrapped; the engine\'s own pages are not results',()=>{
 assert.equal(resultTarget(bing('https://example.org/page?a=1'),'www.bing.com'),'https://example.org/page?a=1');
 assert.equal(resultTarget('https://www.google.com/url?q=https://example.org/x&sa=U','www.google.com'),'https://example.org/x');
 assert.equal(resultTarget('https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fy','duckduckgo.com'),'https://example.org/y');
 assert.equal(resultTarget('https://maps.google.com/place','www.google.com'),null);
 assert.equal(resultTarget('https://www.bing.com/images/search?q=x','www.bing.com'),null);
 assert.equal(resultTarget('javascript:alert(1)','www.google.com'),null);
 assert.equal(resultTarget('https://user:pw@example.org/','www.google.com'),null,'no credentials in a previewed address');
 assert.equal(resultTarget('https://www.bing.com/ck/a?u=zz','www.bing.com'),null);
 assert.equal(resultTarget('https://example.org/z','www.google.com'),'https://example.org/z');
});

test('the browser side: one ordinary-session content script, a private, Tor and peek check, and the setting',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 assert.match(main,/pageBridge\.handle\('acira:search-preview',/);
 assert.match(main,/const allowed=Boolean\(entry\)&&!entry\.privateTab&&!privateMode&&!torMode&&event\.senderFrame===event\.sender\.mainFrame&&\(!fixture\|\|Boolean\(process\.env\.ACIRA_BROWSER_TEST_DATA\)\)/);
 assert.match(main,/if\(!profileId\.startsWith\('private-'\)&&!torMode&&typeof ses\.registerPreloadScript==='function'\)/,'never registered for private or Tor sessions');
 assert.ok(main.includes("pageBridge.on('acira:page-peek-link',(event,payload)=>{if(state.settings.linkPreview===false)return;"),'page gestures obey the setting');
 assert.ok(fs.readFileSync(path.join(__dirname,'../scripts/desktop-bundle.mjs'),'utf8').includes("'desktop/browser-services/search-preview-preload.cjs'"),'shipped in the desktop bundle');
});

const electron=(()=>{try{const value=require('electron');return typeof value==='string'&&fs.existsSync(value)?value:null;}catch{return null;}})();
let result=null,problem='';
if(electron){
 const run=spawnSync(electron,[path.join(__dirname,'fixtures','search-preview','run.cjs')],{encoding:'utf8',timeout:120000,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,ELECTRON_ENABLE_LOGGING:'0'}});
 const line=(run.stdout||'').split(/\r?\n/).find(text=>text.startsWith('RESULT '));
 if(line)result=JSON.parse(line.slice(7));else problem=((run.stdout||'')+(run.stderr||'')).split(/\r?\n/).filter(text=>!/^\[\d+:/.test(text)).join('\n').slice(0,900)||'electron produced no result';
}
const skip=!electron?'electron binary not available':false;
const expected={google:'https://example.org/result-',bing:'https://example.org/result-',duckduckgo:'https://example.org/result-',brave:'https://example.org/result-',startpage:'https://example.org/result-',ecosia:'https://example.org/result-'};

test('on every engine: hovering a result\'s text shows the chip beside its title, and nothing in the page moves',{skip},()=>{
 assert.ok(result,problem);
 assert.deepEqual(result.engines.map(e=>e.engine),Object.keys(expected));
 for(const e of result.engines){
  assert.deepEqual(e.invoked,[['acira:search-preview',{fixture:false}]],e.engine+': asks the browser once');
  assert.equal(e.hoverText.on,true,e.engine+': chip shown');assert.equal(e.layoutStable,true,e.engine+': no layout shift');
  const chip=e.hoverText.box,title=e.title;
  assert.equal(chip.text,'Preview');assert.match(chip.label,/^Preview: /,e.engine+': named after the result');
  assert.ok(chip.x>=title.x+title.width+4&&chip.x<=title.x+title.width+12,`${e.engine}: beside the title's end (${chip.x} vs ${title.x+title.width})`);
  assert.ok(Math.abs(chip.y+chip.height/2-(title.y+title.height/2))<=3,`${e.engine}: centred on the title line`);
  assert.equal(chip.height,24);
 }
});

test('on every engine: a real click on the chip opens Peek for that result, growing from its title; leaving the result hides it',{skip},()=>{
 assert.ok(result,problem);
 for(const e of result.engines){
  assert.equal(e.clicked.sent.length,1,e.engine+': one request');const [channel,payload]=e.clicked.sent[0];
  assert.equal(channel,'acira:page-peek-link');assert.equal(payload.url,expected[e.engine]+'1',e.engine+': the destination, not a redirect');
  assert.deepEqual(payload.rect,{x:Math.round(e.title.x),y:Math.round(e.title.y),width:Math.round(e.title.width),height:Math.round(e.title.height)},e.engine+': the title box');
  assert.equal(e.clicked.on,false,e.engine+': the chip steps aside for the preview');
  assert.equal(e.away.on,false,e.engine+': hidden away from results');
 }
});

test('on every engine: keyboard — focusing a title shows its chip, Tab reaches it, Enter previews that result',{skip},()=>{
 assert.ok(result,problem);
 for(const e of result.engines){
  assert.equal(e.focusTitle.on,true,e.engine+': focus shows it');assert.equal(e.tabToChip.active,true,e.engine+': Tab lands on the chip');
  assert.equal(e.enter.sent.length,1,e.engine+': Enter previews');assert.equal(e.enter.sent[0][1].url,expected[e.engine]+'2');
 }
});

test('it stays away: setting off, private tabs, other sites and image results; dark pages get the dark chip',{skip},()=>{
 assert.ok(result,problem);
 assert.equal(result.dark.dark,true,'a dark result page gets the dark chip');
 assert.deepEqual(result.off,{host:false,on:false},'Link preview off: no chip');
 assert.deepEqual(result.privateTab,{host:false,on:false},'not allowed (private/Tor): no chip');
 assert.deepEqual(result.otherSite,{host:false,invoked:[]},'another site: the script does nothing, asks nothing');
 assert.deepEqual(result.images.invoked,[],'image results: nothing');
});
