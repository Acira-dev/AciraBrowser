'use strict';
// The tab hover card (desktop/tab-card.cjs): where it goes, when it shows, and that its picture is a memory-only,
// never-private thing. The native view is a fake; the page's replies (ready, its height) are played by the fake.
const test=require('node:test');const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');const fs=require('node:fs');const path=require('node:path');
const {createInitialState,reduceBrowser,tabCardKind,tabCardHost}=require('../desktop/runtime.cjs');
const {createTabCard,cardPlacement,WIDTH,GAP,SHOW_MS,SKIP_MS,LEAVE_MS,KEEP,MARGIN}=require('../desktop/tab-card.cjs');

class FakeContents extends EventEmitter{
 constructor(){super();this.ipc=new EventEmitter();this.sent=[];this.destroyed=false;this.height=120;}
 loadFile(){setImmediate(()=>this.ipc.emit('acira:tab-card',{},'ready'));return Promise.resolve();}
 send(channel,state){this.sent.push(state);if(!state.reveal&&!state.leaving)setImmediate(()=>this.ipc.emit('acira:tab-card',{},{size:state.picture?226:this.height}));}
 setZoomFactor(value){this.zoom=value;}isDestroyed(){return this.destroyed;}close(){this.destroyed=true;}
}
class FakeView{constructor(options){this.options=options;this.webContents=new FakeContents();this.bounds=null;this.visible=true;}setBounds(b){this.bounds=b;}setVisible(v){this.visible=v;}setBackgroundColor(){}}
const flush=async(times=6)=>{for(let i=0;i<times;i++)await new Promise(resolve=>setImmediate(resolve));};
const image=(width=1200)=>({isEmpty:()=>false,getSize:()=>({width,height:Math.round(width*.66)}),resize:({width:w})=>image(w),toJPEG:quality=>Buffer.from('jpeg-'+quality+'-'+width)});

function harness(options={}){
 let state=createInitialState();
 for(const url of ['https://one.test/','https://two.test/'])state=reduceBrowser(state,{type:'tab.new',url});
 const h={get state(){return state;},set state(value){state=value;},views:[],captures:[],blocked:false,pictures:true,scale:1};
 const children=[],win={isDestroyed:()=>false,contentView:{children,getBounds:()=>({x:0,y:0,width:1200,height:800}),addChildView(v){const i=children.indexOf(v);if(i>=0)children.splice(i,1);children.push(v);},removeChildView(v){const i=children.indexOf(v);if(i>=0)children.splice(i,1);}}};
 h.children=children;
 const pages=new Map();h.pages=pages;
 h.card=createTabCard({WebContentsView:function(opts){const v=new FakeView(opts);h.views.push(v);return v;},getWindow:()=>win,getState:()=>state,pageOf:id=>pages.get(id)||null,blocked:()=>h.blocked,pictures:()=>h.pictures,uiScale:()=>h.scale,say:()=>'Renamed',...options});
 h.page=(id,{loading=false,title='A page',fail=false}={})=>{pages.set(id,{isDestroyed:()=>false,isLoading:()=>loading,getTitle:()=>title,capturePage:()=>{h.captures.push(id);return fail?Promise.reject(new Error('x')):Promise.resolve(image());}});};
 h.tab=index=>state.tabs[index];
 h.select=id=>{const previous=state;state=reduceBrowser(state,{type:'tab.select',id});h.card.onState(previous,state);};
 return h;
}
const anchor={x:300,y:36,width:180,height:32};

test('where the card goes: under a strip tab (clamped, flipped above at the bottom), beside a sidebar tab (flipped left at the right edge)',()=>{
 const win={width:1200,height:800};
 const below=cardPlacement({anchor,side:'below',height:226,window:win});
 assert.equal(below.side,'below');assert.deepEqual(below.card,{x:300,y:36+32+GAP,width:WIDTH,height:226});
 assert.equal(below.bounds.y,anchor.y+anchor.height,'the view touches the tab and never covers it');assert.equal(below.inset.top,GAP);assert.equal(below.inset.left,MARGIN);
 assert.equal(cardPlacement({anchor:{x:1150,y:36,width:100,height:32},side:'below',height:100,window:win}).card.x,1200-WIDTH-8,'clamped 8px inside the window');
 assert.equal(cardPlacement({anchor:{x:-30,y:36,width:100,height:32},side:'below',height:100,window:win}).card.x,8);
 const bottom=cardPlacement({anchor:{x:300,y:760,width:180,height:32},side:'below',height:226,window:win});assert.equal(bottom.side,'above');assert.equal(bottom.card.y,760-GAP-226);
 const side=cardPlacement({anchor:{x:0,y:200,width:240,height:32},side:'right',height:226,window:win});
 assert.equal(side.side,'right');assert.equal(side.card.x,240+GAP);assert.equal(side.bounds.x,240,'the view starts at the sidebar edge');assert.equal(side.inset.left,GAP);
 const flipped=cardPlacement({anchor:{x:1000,y:200,width:190,height:32},side:'right',height:226,window:win});assert.equal(flipped.side,'left');assert.equal(flipped.card.x,1000-GAP-WIDTH);
 assert.ok(cardPlacement({anchor:{x:0,y:790,width:240,height:32},side:'right',height:226,window:win}).card.y+226<=800-8,'a low sidebar tab keeps the card on screen');
});

test('at 150% the card is 1.5x in window pixels and its inset stays in interface pixels',()=>{
 const placed=cardPlacement({anchor:{x:450,y:54,width:270,height:48},side:'below',height:226,window:{width:1800,height:1200},scale:1.5});
 assert.equal(placed.card.width,396);assert.equal(placed.card.height,339);assert.equal(placed.card.y,54+48+9);
 assert.equal(placed.inset.left,24,'the page places the card by interface pixels');assert.equal(placed.inset.top,6);
});

test('the card shows after 450ms, not before; between neighbouring tabs it follows at once and says so',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const h=harness(),[a,b]=[h.tab(1),h.tab(2)];
 h.card.command({action:'hover',tabId:a.id,anchor,side:'below'});
 t.mock.timers.tick(SHOW_MS-1);await flush();assert.equal(h.card.visible,false,'not yet');
 t.mock.timers.tick(1);await flush();assert.equal(h.card.visible,true);
 const view=h.views[0];assert.equal(view.visible,true);assert.ok(view.bounds.width>=WIDTH);
 const states=view.webContents.sent;assert.equal(states.at(-1).reveal,true);assert.equal(states.at(-1).instant,false,'the first card arrives with its motion');
 const first=states.find(s=>s.title);assert.equal(first.host,'one.test');assert.equal(first.picture,null,'nothing was taken yet: a name-only card');
 // The next tab: no new delay, the same view, instant content swap.
 h.card.command({action:'hover',tabId:b.id,anchor:{x:480,y:36,width:180,height:32},side:'below'});
 t.mock.timers.tick(0);await flush();
 assert.equal(h.views.length,1,'one view is reused');assert.equal(view.webContents.sent.at(-1).instant,true);assert.equal(view.webContents.sent.filter(s=>s.title).at(-1).host,'two.test');
});

test('leaving hides it after 120ms of grace; coming back in time keeps it; pressing or typing hides it at once',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const h=harness(),a=h.tab(1);
 h.card.command({action:'hover',tabId:a.id,anchor,side:'below'});t.mock.timers.tick(SHOW_MS);await flush();assert.equal(h.card.visible,true);
 h.card.command({action:'leave',tabId:a.id});t.mock.timers.tick(LEAVE_MS-1);assert.equal(h.card.visible,true);
 h.card.command({action:'hover',tabId:a.id,anchor,side:'below'});t.mock.timers.tick(LEAVE_MS+50);await flush();assert.equal(h.card.visible,true,'back in time: still there');
 h.card.command({action:'leave',tabId:a.id});t.mock.timers.tick(LEAVE_MS);assert.equal(h.card.visible,false);
 assert.equal(h.views[0].webContents.sent.at(-1).leaving,true);
 // Just after it went, the next tab shows at once (the skip window).
 h.card.command({action:'hover',tabId:h.tab(2).id,anchor,side:'below'});t.mock.timers.tick(0);await flush();assert.equal(h.card.visible,true,'within 300ms of the last card: no 450ms wait');
 h.card.command({action:'dismiss',tabId:a.id});assert.equal(h.card.visible,false);
 t.mock.timers.tick(SKIP_MS+10);h.card.command({action:'hover',tabId:a.id,anchor,side:'below'});t.mock.timers.tick(SHOW_MS-1);await flush();assert.equal(h.card.visible,false,'after the skip window the 450ms wait is back');
});

test('no card while a menu or a peek is open, for a scam-warned tab or one using the camera, or when the setting is off',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const h=harness(),a=h.tab(1);
 h.blocked=true;h.card.command({action:'hover',tabId:a.id,anchor,side:'below'});t.mock.timers.tick(SHOW_MS);await flush();assert.equal(h.card.visible,false);h.blocked=false;
 h.state=reduceBrowser(h.state,{type:'browser.event',event:{type:'state',tabId:a.id,risk:{kind:'lookalike',title:'t',detail:'d'}}});
 h.card.command({action:'hover',tabId:a.id,anchor,side:'below'});t.mock.timers.tick(SHOW_MS);await flush();assert.equal(h.card.visible,false,'the warning stays in the tooltip');
 h.state=reduceBrowser(h.state,{type:'browser.event',event:{type:'state',tabId:a.id,risk:null}});
 h.state=reduceBrowser(h.state,{type:'settings.update',patch:{tabHoverCard:'off'}});
 h.card.command({action:'hover',tabId:a.id,anchor,side:'below'});t.mock.timers.tick(SHOW_MS);await flush();assert.equal(h.card.visible,false);
});

test('a renamed tab shows its name and says it was renamed; the card closes when the tab is closed or selected',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const h=harness(),a=h.tab(1);
 h.state=reduceBrowser(h.state,{type:'tab.rename',id:a.id,title:'Tax documents'});
 h.card.command({action:'hover',tabId:a.id,anchor,side:'below'});t.mock.timers.tick(SHOW_MS);await flush();
 const shown=h.views[0].webContents.sent.find(s=>s.title);assert.equal(shown.title,'Tax documents');assert.equal(shown.renamed,true);assert.equal(shown.labels.renamed,'Renamed');
 const previous=h.state;h.state=reduceBrowser(h.state,{type:'tab.close',id:a.id});h.card.onState(previous,h.state);assert.equal(h.card.visible,false,'its tab is gone');
 h.card.command({action:'hover',tabId:h.tab(1).id,anchor,side:'below'});t.mock.timers.tick(SHOW_MS);await flush();assert.equal(h.card.visible,true);
 h.select(h.tab(0).id);assert.equal(h.card.visible,false,'selecting a tab closes the card');
});

test('the picture is taken when you leave a tab: small, in memory, one at a time, never for private tabs, windows, sleeping tabs or Acira pages',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const h=harness(),[a,b]=[h.tab(1),h.tab(2)];
 h.page(a.id);h.page(b.id);
 h.select(a.id);await flush();t.mock.timers.tick(200);await flush();h.captures.length=0; // leaving the new tab took its picture; start clean
 h.select(b.id);assert.deepEqual(h.captures,[a.id],'the tab just left is captured, not the one just opened');
 await flush();t.mock.timers.tick(200);await flush();
 const data=h.card.pictureOf(a.id);assert.match(data,/^data:image\/jpeg;base64,/);assert.equal(Buffer.from(data.split(',')[1],'base64').toString(),'jpeg-72-480','480px wide, JPEG quality 72');
 // One at a time: a second switch while a capture is in flight takes nothing.
 h.captures.length=0;h.select(a.id);h.select(b.id);assert.deepEqual(h.captures,[b.id],'a burst of switches never piles up captures');
 // Nothing for these:
 const check=async(label,mutate)=>{
  const g=harness();const [x,y]=[g.tab(1),g.tab(2)];mutate(g,x);g.page(x.id);g.page(y.id);
  g.select(x.id);await flush();t.mock.timers.tick(200);await flush();g.captures.length=0; // move onto x first (leaving y may take its picture)
  g.select(y.id);assert.deepEqual(g.captures,[],label);assert.equal(g.card.pictureOf(x.id),null,label+': no picture kept');
 };
 await check('a private tab',(g,x)=>{g.state={...g.state,tabs:g.state.tabs.map(tab=>tab.id===x.id?{...tab,privacy:'private'}:tab)};});
 await check('a Tor tab',(g,x)=>{g.state={...g.state,tabs:g.state.tabs.map(tab=>tab.id===x.id?{...tab,privacy:'tor'}:tab)};});
 await check('a private window',g=>{g.pictures=false;});
 await check('a sleeping tab',(g,x)=>{g.state={...g.state,tabs:g.state.tabs.map(tab=>tab.id===x.id?{...tab,sleeping:true}:tab)};});
 await check('an Acira page',(g,x)=>{g.state={...g.state,tabs:g.state.tabs.map(tab=>tab.id===x.id?{...tab,contentKind:'internal',url:'acira://settings'}:tab)};});
 await check('the setting on Name only',g=>{g.state=reduceBrowser(g.state,{type:'settings.update',patch:{tabHoverCard:'name'}});});
 await check('the setting Off',g=>{g.state=reduceBrowser(g.state,{type:'settings.update',patch:{tabHoverCard:'off'}});});
 await check('a page still loading with no title',(g,x)=>{g.page=(id)=>g.pages.set(id,{isDestroyed:()=>false,isLoading:()=>true,getTitle:()=>'',capturePage:()=>{g.captures.push(id);return Promise.resolve(image());}});});
});

test('pictures are dropped with their tab and with the setting, and kept to the newest 40; a hovered card shows the picture',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const h=harness(),a=h.tab(1);
 for(let i=0;i<KEEP+5;i++)h.card.remember('tab-'+i,Buffer.from('x'+i));
 assert.equal(h.card.size,KEEP);assert.equal(h.card.pictureOf('tab-0'),null,'the oldest went');assert.ok(h.card.pictureOf('tab-'+(KEEP+4)));
 h.card.clear();h.card.remember(a.id,Buffer.from('jpeg'));
 h.card.command({action:'hover',tabId:a.id,anchor,side:'below'});t.mock.timers.tick(SHOW_MS);await flush();
 assert.match(h.views[0].webContents.sent.find(s=>s.title).picture,/^data:image\/jpeg;base64,/);
 const previous=h.state;h.state=reduceBrowser(h.state,{type:'tab.close',id:a.id});h.card.onState(previous,h.state);assert.equal(h.card.pictureOf(a.id),null,'closed tab: its picture is gone');
 const b=h.tab(1);h.card.remember(b.id,Buffer.from('jpeg'));const before=h.state;h.state=reduceBrowser(h.state,{type:'settings.update',patch:{tabHoverCard:'off'}});h.card.onState(before,h.state);assert.equal(h.card.size,0,'turning the card off drops every picture');
});

test('the open tab never shows an older picture of itself',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const h=harness(),open=h.state.activeTabId;
 h.card.remember(open,Buffer.from('jpeg'));
 h.card.command({action:'hover',tabId:open,anchor,side:'below'});t.mock.timers.tick(SHOW_MS);await flush();
 const shown=h.views[0].webContents.sent.find(s=>s.title);assert.equal(shown.picture,null,'a name-only card for the tab you are on');
});

test('the picture lives in memory only: the card module never touches the disk',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../desktop/tab-card.cjs'),'utf8');
 assert.doesNotMatch(source,/require\(['"](node:)?fs['"]\)|writeFile|createWriteStream|appendFile|userData|localStorage|savePage/,'no file, no storage');
 const page=fs.readFileSync(path.join(__dirname,'../desktop/tab-card.html'),'utf8');
 assert.match(page,/img-src data:/,'the page can show only the picture it is given, nothing from the network');assert.doesNotMatch(page,/https?:\/\//,'and fetches nothing');
});

test('the view is built while the delay runs and dropped after a quiet half minute',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const h=harness(),a=h.tab(1);
 h.card.command({action:'hover',tabId:a.id,anchor,side:'below'});assert.equal(h.views.length,1,'built at hover, before the 450ms are up');
 t.mock.timers.tick(SHOW_MS);await flush();h.card.command({action:'dismiss',tabId:a.id});
 t.mock.timers.tick(31000);assert.equal(h.views[0].webContents.destroyed,true,'idle: the view is closed');assert.equal(h.children.includes(h.views[0]),false);
 h.card.command({action:'hover',tabId:a.id,anchor,side:'below'});assert.equal(h.views.length,2,'a new one when needed');
});

test('the interface scale zooms the card page and scales the anchor and the card to window pixels',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const h=harness();h.scale=1.5;const a=h.tab(1);
 h.card.command({action:'hover',tabId:a.id,anchor:{x:200,y:24,width:120,height:21},side:'below'});t.mock.timers.tick(SHOW_MS);await flush();
 assert.equal(h.views[0].options.webPreferences.zoomFactor,1.5);assert.equal(h.views[0].webContents.zoom,1.5);
 assert.equal(h.views[0].bounds.y,Math.round((24+21)*1.5),'the card hangs from the scaled tab box');
});

test('one rule for card or tooltip, shared by the interface and the main process',()=>{
 const tab={contentKind:'web',privacy:undefined,sleeping:false,risk:undefined,capturing:undefined};
 assert.equal(tabCardKind({tabHoverCard:'preview'},tab),'preview');assert.equal(tabCardKind(undefined,tab),'preview','the default');
 assert.equal(tabCardKind({tabHoverCard:'name'},tab),'name');assert.equal(tabCardKind({tabHoverCard:'off'},tab),null);
 assert.equal(tabCardKind({},{...tab,privacy:'tor'}),'name');assert.equal(tabCardKind({},tab,true),'name');assert.equal(tabCardKind({},{...tab,contentKind:'internal'}),'name');
 assert.equal(tabCardKind({},{...tab,risk:{kind:'clickfix',title:'a',detail:'b'}}),null);assert.equal(tabCardKind({},{...tab,capturing:['camera']}),null);assert.equal(tabCardKind({},undefined),null);
 assert.equal(tabCardHost('https://www.example.com/a?b'),'example.com');assert.equal(tabCardHost('acira://settings'),'Acira');assert.equal(tabCardHost('nonsense'),'');
});

test('the card command and its setting cross the desktop bridge',()=>{
 const {validateCommand,validateAction}=require('../desktop/validation.cjs'),s=createInitialState(),id=s.tabs[0].id;
 assert.doesNotThrow(()=>validateCommand({type:'tab-card',tabId:id,action:'hover',anchor:{x:1,y:2,width:3,height:4},side:'right'},s));
 assert.doesNotThrow(()=>validateCommand({type:'tab-card',tabId:id,action:'leave'},s));assert.doesNotThrow(()=>validateCommand({type:'tab-card',tabId:id,action:'dismiss'},s));
 assert.throws(()=>validateCommand({type:'tab-card',tabId:id,action:'hover'},s),/box of its tab/);
 assert.doesNotThrow(()=>validateCommand({type:'tab-card',tabId:id,action:'hover',anchor:{x:1,y:2,width:3,height:4},side:'below',floor:84},s));
 assert.throws(()=>validateCommand({type:'tab-card',tabId:id,action:'hover',anchor:{x:1,y:2,width:3,height:4},floor:-1},s));assert.throws(()=>validateCommand({type:'tab-card',tabId:id,action:'hover',anchor:{x:1,y:2,width:3,height:4},floor:'84'},s));
 assert.throws(()=>validateCommand({type:'tab-card',tabId:id,action:'hover',anchor:{x:1,y:2,width:3,height:4},side:'up'},s));
 assert.throws(()=>validateCommand({type:'tab-card',tabId:'nope',action:'hover',anchor:{x:1,y:2,width:3,height:4}},s));assert.throws(()=>validateCommand({type:'tab-card',tabId:id,action:'explode'},s));
 // The tab under the pointer can close while its card is up: the card's leave and dismiss then name a tab that is gone, and are still accepted (a closed-tab id used to log a bridge error on every such close).
 assert.doesNotThrow(()=>validateCommand({type:'tab-card',tabId:'tab-closed-a-moment-ago',action:'leave'},s));assert.doesNotThrow(()=>validateCommand({type:'tab-card',tabId:'tab-closed-a-moment-ago',action:'dismiss'},s));assert.throws(()=>validateCommand({type:'tab-card',tabId:'',action:'leave'},s));
 for(const value of ['preview','name','off'])assert.doesNotThrow(()=>validateAction({type:'settings.update',patch:{tabHoverCard:value}},s));
 assert.throws(()=>validateAction({type:'settings.update',patch:{tabHoverCard:'always'}},s));
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 assert.match(main,/c\.type==='tab-card'\)\{tabCard\.command\(c\)/);assert.match(main,/tabCard\.onState\(previous,state\)/);assert.match(main,/tabCard\.relayout\(\)/);assert.match(main,/tabCard\.dispose\(\)/);
});

// R4 leftovers: the card of a compact or icon-only tab dropped over the toolbar's back and forward buttons.
test('a card never starts above the page area: under the toolbar for a strip or compact tab, not over its controls',()=>{
 const win={width:1200,height:800},floor=84;
 // A compact tab sits in the 32px row at the top of the window; its own bottom is 36, the toolbar's back and forward buttons end at 84.
 const compact=cardPlacement({anchor:{x:20,y:4,width:32,height:28},side:'below',height:100,window:win,floor});
 assert.equal(compact.side,'below');assert.equal(compact.card.y,floor+GAP);assert.ok(compact.bounds.y>=floor,'the view itself starts at the page area, so it covers no toolbar control');
 // No floor (or a floor above the tab) keeps today's placement.
 assert.equal(cardPlacement({anchor,side:'below',height:226,window:win}).card.y,36+32+GAP);
 assert.equal(cardPlacement({anchor:{x:300,y:200,width:180,height:32},side:'below',height:100,window:win,floor}).card.y,200+32+GAP);
 // A tab beside the sidebar's top edge keeps its card out of the toolbar row too.
 const side=cardPlacement({anchor:{x:0,y:60,width:240,height:32},side:'right',height:226,window:win,floor});
 assert.equal(side.side,'right');assert.equal(side.card.y,floor);
 assert.equal(cardPlacement({anchor:{x:0,y:300,width:240,height:32},side:'right',height:226,window:win,floor}).card.y,296,'lower rows are unchanged');
 // At 150% the floor is in window pixels like the anchor.
 assert.equal(cardPlacement({anchor:{x:30,y:6,width:48,height:42},side:'below',height:100,window:{width:1800,height:1200},scale:1.5,floor:126}).card.y,126+9);
});

test('the floor the interface sends is scaled with the anchor, and a press or drag closes the card on that frame',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const h=harness(),a=h.tab(1);
 h.card.command({action:'hover',tabId:a.id,anchor:{x:20,y:4,width:32,height:28},side:'below',floor:84});t.mock.timers.tick(SHOW_MS);await flush();
 assert.equal(h.card.visible,true);assert.ok(h.views[0].bounds.y>=84,'the view starts under the toolbar');
 h.card.command({action:'dismiss'});
 assert.equal(h.card.visible,false);assert.equal(h.views[0].visible,false,'a press hides the view at once, with no fade');
 h.card.command({action:'hover',tabId:a.id,anchor:{x:20,y:4,width:32,height:28},side:'below',floor:84});t.mock.timers.tick(SHOW_MS);await flush();
 assert.equal(h.card.visible,true);
 h.card.command({action:'leave'});t.mock.timers.tick(LEAVE_MS);await flush();
 assert.equal(h.card.visible,false);assert.equal(h.views[0].visible,true,'the pointer leaving still fades it out');
 t.mock.timers.tick(200);assert.equal(h.views[0].visible,false);
});

test('the interface measures the floor from the top chrome and sends it with the tab box',()=>{
 const hook=fs.readFileSync(path.join(__dirname,'../src/ui/tabHoverCard.ts'),'utf8');
 assert.match(hook,/closest\('\.browser-shell'\)/);assert.match(hook,/cardSide\(row\), cardFloor\(row\)/);
});
