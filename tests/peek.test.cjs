'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createInitialState,reduceBrowser}=require('../desktop/runtime.cjs');
const {createPeek,peekGeometry}=require('../desktop/rewind/peek.cjs');

class FakeContents extends EventEmitter{
 constructor(options){super();this.options=options;this.url='';this.destroyed=false;this.session=FakeContents.sessions[options?.webPreferences?.partition]??=new EventEmitter();this.ipc=new EventEmitter();this.sent=[];this.calls=[];this.canBack=false;this.navigationHistory={canGoBack:()=>this.canBack,goBack:()=>this.calls.push('back')};}
 loadURL(url){this.url=url;return Promise.resolve();}loadFile(){return Promise.resolve();}getURL(){return this.url;}getTitle(){return 'Title of '+this.url;}isLoading(){return false;}reload(){this.calls.push('reload');}stop(){this.calls.push('stop');}
 isDestroyed(){return this.destroyed;}close(){this.destroyed=true;}focus(){}insertCSS(){return Promise.resolve('css');}removeInsertedCSS(){return Promise.resolve();}send(...args){this.sent.push(args);}setWindowOpenHandler(fn){this.openHandler=fn;}setWebRTCIPHandlingPolicy(){}
}
FakeContents.sessions={};
class FakeView{constructor(options){this.webContents=new FakeContents(options);this.bounds=null;this.radius=0;this.visible=true;}setBounds(b){this.bounds=b;}getBounds(){return this.bounds;}setBorderRadius(r){this.radius=r;}setBackgroundColor(){}setVisible(v){this.visible=v;}}
function harness(extra={}){
 let state=createInitialState();state=reduceBrowser(state,{type:'tab.navigate',tabId:state.activeTabId,url:'https://source.test/'});
 const children=[{page:true}],events=[];
 const win={isDestroyed:()=>false,contentView:{children,addChildView(v){const i=children.indexOf(v);if(i>=0)children.splice(i,1);children.push(v);},removeChildView(v){const i=children.indexOf(v);if(i>=0)children.splice(i,1);}}};
 const h={get state(){return state;},children,events,configured:[],select:id=>{state=reduceBrowser(state,{type:'tab.select',id});},dispatch:a=>{state=reduceBrowser(state,a);}};
 h.peek=createPeek({WebContentsView:FakeView,getWindow:()=>win,getState:()=>state,dispatch:a=>{state=reduceBrowser(state,a);h.peek.onState(state);},emit:e=>events.push(e),pageBounds:()=>({x:0,y:68,width:1200,height:800}),configure:(s,id)=>h.configured.push(id),pagePreload:'page.cjs',partitionOf:id=>state.browserProfiles.find(p=>p.id===id)?.partition,...extra});
 return h;
}

test('geometry: card centred at 78% x 86% of the page area, a 44px header over the page view 1px inside the card',()=>{
 const g=peekGeometry({x:0,y:68,width:1200,height:800});
 assert.deepEqual(g.card,{x:132,y:56,width:936,height:688});assert.equal(g.header,44);
 assert.deepEqual(g.view,{x:133,y:168,width:934,height:643},'the page view sits under the header, 1px inside the sides and bottom');
 assert.equal(g.view.y,68+g.card.y+g.header);assert.equal(peekGeometry(null),null);
 const narrow=peekGeometry({x:0,y:68,width:500,height:600});assert.equal(narrow.card.width,390);assert.ok(narrow.card.x>=0&&narrow.card.x+narrow.card.width<=500,'the card stays inside a narrow page');
});

test('open: page view in the source profile session above a frame view; popups refused, tab links stay in the peek',async()=>{
 const h=harness(),source=h.state.activeTabId;
 assert.equal(h.peek.open({url:'https://docs.test/a',sourceTabId:source}).ok,true);
 const [frame,view]=h.children.slice(-2);
 assert.equal(view.webContents.options.webPreferences.partition,h.state.browserProfiles[0].partition);assert.equal(view.webContents.options.webPreferences.sandbox,true);
 assert.equal(view.radius,8);assert.equal(view.webContents.url,'https://docs.test/a');assert.equal(frame.webContents.options.webPreferences.preload.endsWith('peek-frame-preload.cjs'),true);
 assert.deepEqual(h.configured,['profile-personal']);
 assert.deepEqual(view.webContents.openHandler({url:'https://popup.test/',disposition:'new-window'}),{action:'deny'});
 assert.deepEqual(view.webContents.openHandler({url:'https://next.test/',disposition:'foreground-tab'}),{action:'deny'});
 await new Promise(r=>setImmediate(r));assert.equal(view.webContents.url,'https://next.test/','a new-tab link navigates the peek');
 assert.equal(h.events.at(-1).peek.sourceTabId,source);
 for(const bad of ['javascript:alert(1)','file:///C:/x','https://u:p@x.test/'])assert.equal(h.peek.open({url:bad,sourceTabId:source}).ok,false);
});

test('a link that downloads is cancelled in the peek and says so; Download starts it from the source tab; other contents are untouched',()=>{
 const downloads=[],h=harness({download:(id,url)=>downloads.push([id,url])}),source=h.state.activeTabId;h.peek.open({url:'https://docs.test/file',sourceTabId:source});
 const view=h.children.at(-1),cancelled=[];const item={cancel:()=>cancelled.push(true),getFilename:()=>'report.pdf',getURL:()=>'https://docs.test/files/report.pdf'};
 view.webContents.session.emit('will-download',{},item,{other:true});assert.equal(cancelled.length,0);
 view.webContents.session.emit('will-download',{},item,view.webContents);assert.equal(cancelled.length,1);
 const frameState=h.children.at(-2).webContents.sent.at(-1)[1];assert.deepEqual(frameState.download,{name:'report.pdf',url:'https://docs.test/files/report.pdf'},'the card says a file downloads, by its name and address');
 assert.equal(frameState.notice,'','no toast over it');assert.equal(view.visible,false,'the blank page view is hidden');
 assert.equal(frameState.labels.download,'Download');assert.equal(frameState.labels.downloadTitle,'This link downloads a file');
 h.children.at(-2).webContents.ipc.emit('acira:peek-frame',{},'download');
 assert.deepEqual(downloads,[[source,'https://docs.test/files/report.pdf']],'Download starts it from the tab the peek came from');assert.equal(h.peek.active,false,'and the peek closes');
 h.peek.open({url:'https://docs.test/file',sourceTabId:source});const again=h.children.at(-1);again.webContents.session.emit('will-download',{},item,again.webContents);
 const tabs=h.state.tabs.length;h.children.at(-2).webContents.ipc.emit('acira:peek-frame',{},'tab');
 assert.equal(h.state.tabs.length,tabs+1,'Open as tab opens the file link in a tab of its own');assert.equal(h.state.tabs.find(t=>t.id===h.state.activeTabId).url,'https://docs.test/files/report.pdf');assert.equal(h.peek.active,false);assert.equal(again.webContents.destroyed,true,'the blank peek page is not kept');
});

test('a link that fails shows the address, the reason and Try again instead of a blank card; Try again loads it again',()=>{
 const h=harness();h.peek.open({url:'https://nowhere.invalid/page',sourceTabId:h.state.activeTabId});
 const [frame,view]=h.children.slice(-2);frame.webContents.ipc.emit('acira:peek-frame',{},'entered');
 view.webContents.emit('did-fail-load',{},-3,'ERR_ABORTED','https://nowhere.invalid/page',true);assert.equal(frame.webContents.sent.at(-1)[1].failure,null,'an aborted load is no failure');
 view.webContents.emit('did-fail-load',{},-105,'ERR_NAME_NOT_RESOLVED','https://nowhere.invalid/page',false);assert.equal(frame.webContents.sent.at(-1)[1].failure,null,'nor is a frame inside the page');
 view.webContents.emit('did-fail-load',{},-105,'ERR_NAME_NOT_RESOLVED','https://nowhere.invalid/page',true);
 const state=frame.webContents.sent.at(-1)[1];
 assert.deepEqual(state.failure,{title:'This site can’t be reached',message:'nowhere.invalid’s server IP address could not be found.',code:'ERR_NAME_NOT_RESOLVED',url:'https://nowhere.invalid/page'});
 assert.equal(view.visible,false,'the white error page stays hidden');assert.equal(state.labels.tryAgain,'Try again');
 view.webContents.url='about:blank';frame.webContents.ipc.emit('acira:peek-frame',{},'retry');assert.equal(view.webContents.url,'https://nowhere.invalid/page','Try again loads the link again');
 view.webContents.emit('did-start-navigation',{isMainFrame:true,isSameDocument:false});const retrying=frame.webContents.sent.at(-1)[1];
 assert.equal(retrying.failure,null);assert.equal(retrying.revealed,false,'the loader shows while it tries');
 view.webContents.emit('dom-ready');assert.equal(view.visible,true,'a page that loads shows');
});


test('Esc, a click outside, closing or leaving the source tab close the peek',()=>{
 const h=harness(),source=h.state.activeTabId;
 h.peek.open({url:'https://a.test/',sourceTabId:source});let view=h.children.at(-1);
 let prevented=false;view.webContents.emit('before-input-event',{preventDefault:()=>{prevented=true;}},{type:'keyDown',key:'Escape'});
 assert.equal(prevented,true);assert.equal(h.peek.active,false);assert.equal(view.webContents.destroyed,true);assert.equal(h.events.at(-1).peek,null);
 h.peek.open({url:'https://a.test/',sourceTabId:source});const frame=h.children.at(-2);frame.webContents.ipc.emit('acira:peek-frame',{},'close');assert.equal(h.peek.active,false);
 h.peek.open({url:'https://a.test/',sourceTabId:source});h.peek.handle({type:'peek.open',url:'https://b.test/'});assert.equal(h.children.at(-1).webContents.url,'https://b.test/','second peek replaces the first');
 h.peek.onState({...h.state,activeTabId:'other'});assert.equal(h.peek.active,false);
});

test('Open as tab keeps the same WebContents; Open in split puts it beside the source',()=>{
 const h=harness(),source=h.state.activeTabId;
 h.peek.open({url:'https://docs.test/page',sourceTabId:source});const view=h.children.at(-1);
 const result=h.peek.handle({type:'peek.promote'});assert.equal(result.ok,true);
 const tab=h.state.tabs.find(t=>t.id===result.tabId);assert.equal(tab.url,'https://docs.test/page');assert.equal(h.state.activeTabId,tab.id);
 assert.equal(h.peek.adopt(tab.id),view,'ensurePage gets the peek view');assert.equal(h.peek.adopt(tab.id),null,'only once');
 assert.equal(view.webContents.destroyed,false);assert.equal(view.radius,0);assert.equal(h.children.includes(h.children.find(c=>c.webContents?.options?.webPreferences?.partition==='acira-peek-frame')),false,'frame removed');
 h.select(source);h.peek.handle({type:'peek.open',url:'https://beside.test/'});
 const split=h.peek.handle({type:'peek.split'});assert.equal(split.ok,true);
 assert.deepEqual(h.state.windowUi.split.tabIds,[source,split.tabId]);
});

test('Open in split view: the peeked page is the current pane and has the keyboard; closing it leaves the page it came from (and the reverse)',()=>{
 const run=()=>{
  const h=harness(),source=h.state.activeTabId;
  // A tab right of the source: closing by tab order would land there instead of on the split's other pane.
  h.dispatch({type:'tab.new',url:'https://neighbour.test/',background:true,afterId:source});
  h.peek.open({url:'https://docs.test/page',sourceTabId:source});const view=h.children.at(-1);let focused=0;view.webContents.focus=()=>{focused++;};
  const split=h.peek.handle({type:'peek.split'});assert.equal(split.ok,true);
  assert.deepEqual(h.state.windowUi.split.tabIds,[source,split.tabId]);
  assert.equal(h.state.activeTabId,split.tabId,'the peeked page is the current pane, so Ctrl+W / Close tab mean it');
  assert.ok(focused>0,'the keyboard stays with the peeked page');
  assert.deepEqual(h.state.tabs.map(t=>t.url),['https://source.test/','https://docs.test/page','https://neighbour.test/']);
  return {h,source,peeked:split.tabId};
 };
 {const {h,source,peeked}=run();h.dispatch({type:'tab.close',id:peeked});
  assert.equal(h.state.tabs.some(t=>t.id===peeked),false,'the peeked tab closes');assert.equal(h.state.activeTabId,source,'the original page remains');assert.equal(h.state.windowUi.split,null,'back to one page');}
 {const {h,source,peeked}=run();h.dispatch({type:'tab.close',id:source});
  assert.equal(h.state.tabs.some(t=>t.id===source),false);assert.equal(h.state.activeTabId,peeked,'closing the original leaves the peeked page');assert.equal(h.state.windowUi.split,null);}
 {const {h,source,peeked}=run();h.dispatch({type:'split.remove',tabId:peeked});
  assert.equal(h.state.activeTabId,source,'the pane x on the peeked pane leaves the original on screen');assert.equal(h.state.windowUi.split,null);}
});

test('requests are validated',()=>{
 const h=harness();
 assert.throws(()=>h.peek.handle({type:'peek.nope'}));assert.throws(()=>h.peek.handle({type:'peek.close',extra:1}));assert.throws(()=>h.peek.handle(null));
 assert.deepEqual(h.peek.handle({type:'peek.state'}),{ok:true,peek:null});assert.deepEqual(h.peek.handle({type:'peek.promote'}),{ok:false,code:'closed'});
});

test('the preview grows from the clicked link: a window point becomes a point on the card, clamped',()=>{
 const {cardOrigin}=require('../desktop/rewind/peek.cjs');
 const g=peekGeometry({x:0,y:68,width:1200,height:800});
 assert.deepEqual(cardOrigin(g,{x:300,y:300}),{x:168,y:176});
 assert.deepEqual(cardOrigin(g,{x:-50,y:5000}),{x:0,y:g.card.height},'outside the card clamps to its edge');
 assert.equal(cardOrigin(g,null),null);assert.equal(cardOrigin(null,{x:1,y:1}),null);assert.equal(cardOrigin(g,{x:NaN,y:1}),null);
});

test('the Peek tip shows once, on the third background-tab link, and never after Peek was used',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const {createPeekHint,TEXT}=require('../desktop/rewind/peek-hint.cjs');
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'acira-peekhint-')),'peek-hint.json'),shown=[];
 const hint=createPeekHint({file});
 assert.equal(hint.note(t=>shown.push(t)),false);assert.equal(hint.note(t=>shown.push(t)),false);
 assert.equal(hint.note(t=>shown.push(t)),true);assert.deepEqual(shown,[TEXT]);assert.match(TEXT,/Alt-click a link, or press and hold it/);
 assert.equal(hint.note(t=>shown.push(t)),false,'once ever');assert.equal(createPeekHint({file}).done,true,'remembered across runs');
 const other=path.join(path.dirname(file),'b.json'),used=createPeekHint({file:other});used.seen();
 for(let i=0;i<5;i++)assert.equal(used.note(()=>shown.push('x')),false,'someone who used Peek never gets the tip');
});

// ---- R3 zen-extras: Alt+click, header (title, address, Back, Reload), Open as tab / split, keys, morph from the link ----

test('the card grows from the link: its box on the card, clamped inside it; a link beside the card grows it from the nearest edge',()=>{
 const {cardLink}=require('../desktop/rewind/peek.cjs');
 const g=peekGeometry({x:0,y:68,width:1200,height:800});
 // The link at window (400,300), 120x18: its box relative to the card (card at frame x 132, y 56; frame y 68).
 assert.deepEqual(cardLink(g,{x:430,y:310,rect:{x:400,y:300,width:120,height:18}}),{x:268,y:176,width:120,height:18});
 assert.deepEqual(cardLink(g,{x:430,y:310}),{x:298,y:186,width:1,height:1},'no link box: the clicked point');
 const beside=cardLink(g,{x:20,y:200,rect:{x:10,y:190,width:60,height:16}});
 assert.equal(beside.x,0);assert.ok(beside.width>=1&&beside.width<=2,'a link left of the card starts at the card edge');
 const above=cardLink(g,{x:600,y:70,rect:{x:560,y:68,width:80,height:14}});assert.equal(above.y,0);
 assert.equal(cardLink(null,{x:1,y:1}),null);assert.equal(cardLink(g,{x:NaN,y:1}),null);
 const wide=cardLink(g,{x:600,y:300,rect:{x:0,y:300,width:5000,height:20}});assert.ok(wide.x+wide.width<=g.card.width,'a link wider than the card is cut to it');
});

test('keys: Esc closes; Ctrl+Enter opens as a tab; Ctrl+Shift+Enter beside this page; Ctrl+W, Alt+Left, F5 and Ctrl+R',()=>{
 const {peekKey}=require('../desktop/rewind/peek.cjs'),k=(key,mods={})=>peekKey({type:'keyDown',key,control:false,alt:false,meta:false,shift:false,...mods},'win32');
 assert.equal(k('Escape'),'close');assert.equal(k('Escape',{shift:true}),null,'Esc with a modifier is the page\'s');
 assert.equal(k('Enter',{control:true}),'tab');assert.equal(k('Enter',{control:true,shift:true}),'split');assert.equal(k('Enter'),null,'a plain Enter belongs to the page');assert.equal(k('Enter',{control:true,alt:true}),null);
 assert.equal(k('w',{control:true}),'close');assert.equal(k('ArrowLeft',{alt:true}),'back');assert.equal(k('ArrowLeft'),null);
 assert.equal(k('F5'),'reload');assert.equal(k('r',{control:true}),'reload');assert.equal(k('R',{control:true,shift:true}),null);
 assert.equal(peekKey({type:'keyUp',key:'Escape'},'win32'),null);assert.equal(peekKey({type:'keyDown',key:'Escape',isAutoRepeat:true},'win32'),null,'holding a key repeats nothing');
 assert.equal(peekKey({type:'keyDown',key:'Enter',meta:true},'darwin'),'tab','Cmd+Enter on a Mac');assert.equal(peekKey({type:'keyDown',key:'Enter',control:true},'darwin'),null);
});

test('Ctrl+Enter from the page keeps the same page as a tab; Ctrl+Shift+Enter puts it beside the source; both from the frame too',()=>{
 const mod=process.platform==='darwin'?{meta:true}:{control:true};
 let h=harness(),source=h.state.activeTabId;
 h.peek.open({url:'https://docs.test/page',sourceTabId:source});const view=h.children.at(-1);
 let prevented=false;view.webContents.emit('before-input-event',{preventDefault:()=>{prevented=true;}},{type:'keyDown',key:'Enter',...mod});
 assert.equal(prevented,true);assert.equal(h.peek.active,false);const tab=h.state.tabs.find(t=>t.url==='https://docs.test/page');assert.ok(tab,'a tab holds the page');assert.equal(h.state.activeTabId,tab.id);assert.equal(h.peek.adopt(tab.id),view);
 h=harness();source=h.state.activeTabId;h.peek.open({url:'https://beside.test/',sourceTabId:source});const frame=h.children.at(-2);
 frame.webContents.emit('before-input-event',{preventDefault:()=>{}},{type:'keyDown',key:'Enter',...mod,shift:true});
 assert.equal(h.peek.active,false);assert.deepEqual(h.state.windowUi.split.tabIds,[source,h.state.tabs.find(t=>t.url==='https://beside.test/').id]);
});

test('Back and Reload are commands of the header: Back only when the peek can go back; Reload reloads, Stop stops',()=>{
 const h=harness();h.peek.open({url:'https://a.test/',sourceTabId:h.state.activeTabId});
 const view=h.children.at(-1),frame=h.children.at(-2),say=command=>frame.webContents.ipc.emit('acira:peek-frame',{},command);
 say('back');assert.deepEqual(view.webContents.calls,[],'nothing to go back to');
 view.webContents.canBack=true;say('back');say('reload');say('stop');assert.deepEqual(view.webContents.calls,['back','reload','stop']);
 assert.equal(h.peek.active,true,'the header buttons leave the peek open');
 assert.match(require('node:fs').readFileSync(require('node:path').join(__dirname,'../desktop/rewind/peek-frame-preload.cjs'),'utf8'),/'back','reload','stop'/);
});

test('the frame is told the title, the address, Back, the link box, the speed, the accent, the words and the keys',()=>{
 const h=harness(),source=h.state.activeTabId;
 h.peek.open({url:'https://docs.test/a/b?x=1',sourceTabId:source,origin:{x:400,y:300,rect:{x:380,y:292,width:90,height:16}}});
 const view=h.children.at(-1),frame=h.children.at(-2);view.webContents.canBack=true;view.webContents.emit('page-title-updated');
 const s=frame.webContents.sent.filter(x=>x[0]==='acira:peek-frame-state').at(-1)[1];
 assert.equal(s.title,'Title of https://docs.test/a/b?x=1');assert.equal(s.url,'https://docs.test/a/b?x=1');assert.equal(s.canGoBack,true);assert.equal(s.loading,false);
 assert.deepEqual(s.link,{x:248,y:168,width:90,height:16});assert.equal(s.speed,'premium');assert.equal(s.accent,'#3b6eea');
 assert.deepEqual(Object.keys(s.labels).sort(),['back','close','copied','copy','download','downloadTitle','frameLabel','notSecure','openAsTab','openInSplit','reload','stop','tryAgain']);
 assert.equal(s.labels.openAsTab,'Open as tab');assert.equal(s.labels.openInSplit,'Open in split view');assert.equal(s.labels.back,'Back');
 assert.match(s.keys.tab,/^(Ctrl|Cmd)\+Enter$/);assert.equal(s.keys.close,'Esc');
});

test('Off and reduced motion tell the frame so; only a real accent colour reaches it',()=>{
 const build=options=>{const h=harness();const children=[];const win={isDestroyed:()=>false,contentView:{children,addChildView(v){children.push(v);},removeChildView(){}}};
  const peek=createPeek({WebContentsView:FakeView,getWindow:()=>win,getState:()=>h.state,dispatch:()=>{},pageBounds:()=>({x:0,y:68,width:1200,height:800}),pagePreload:'p.cjs',partitionOf:()=>'persist:x',...options});
  peek.open({url:'https://a.test/',sourceTabId:h.state.activeTabId});return children[0].webContents.sent.filter(x=>x[0]==='acira:peek-frame-state').at(-1)[1];};
 const off=build({reducedMotion:()=>true,accent:()=>'#E11D48'});assert.equal(off.speed,'off');assert.equal(off.reducedMotion,true);assert.equal(off.accent,'#E11D48');
 const fast=build({motionSpeed:()=>'fast',accent:()=>'javascript:alert(1)'});assert.equal(fast.speed,'fast');assert.equal(fast.accent,'#3b6eea');
});

test('the Peek words come from the catalogs, in the app language, and the hint toast is an exact catalog sentence',()=>{
 const en=require('../src/i18n/en.json'),{TEXT}=require('../desktop/rewind/peek-hint.cjs');
 for(const id of ['peek.frameLabel','peek.openAsTab','peek.openInSplit','peek.download','peek.downloadTitle','peek.hint'])assert.equal(typeof en[id],'string',id);
 assert.equal(en['peek.hint'],TEXT,'the toast text reverse-maps to peek.hint, so it shows translated');
 const {setLanguage,tm}=require('../desktop/tm.cjs');setLanguage('de');
 try{
  const h=harness();h.peek.open({url:'https://a.test/',sourceTabId:h.state.activeTabId});
  const frame=h.children.at(-2),s=frame.webContents.sent.filter(x=>x[0]==='acira:peek-frame-state').at(-1)[1];
  assert.equal(s.labels.openAsTab,tm('peek.openAsTab'));assert.notEqual(s.labels.openAsTab,'Open as tab');assert.equal(s.labels.back,tm('app.back'));assert.equal(s.labels.openAsTab,'Als Tab öffnen');
 }finally{setLanguage('en');}
});

// Item 17, the Link preview marker: the sidebar draws a card with the preview's site icon beside the source's icon, so the peek-state event carries it.
test('the preview\'s site icon: the icon kept for its site shows at once, the page\'s own icon replaces it, a new document clears it, a late answer is dropped',()=>{
 const asked=[],stored={'https://docs.test/a':'data:image/png;base64,KEPT','https://next.test/b':'data:image/png;base64,NEXTKEPT'};
 const h=harness({storedIcon:(profile,url)=>stored[url]||'',resolveIcon:(wc,options)=>asked.push({wc,...options})}),source=h.state.activeTabId;
 h.peek.open({url:'https://docs.test/a',sourceTabId:source});
 const view=h.children.at(-1).webContents;
 assert.equal(h.events.at(-1).peek.favicon,'data:image/png;base64,KEPT','a site seen before shows its kept icon from the first event');
 assert.equal(h.events.at(-1).peek.sourceTabId,source);
 view.emit('page-favicon-updated',{},['https://docs.test/icon.png','data:image/png;base64,x','javascript:alert(1)']);
 assert.equal(asked.length,1);assert.deepEqual(asked[0].announced,['https://docs.test/icon.png'],'only web addresses are asked for');
 assert.equal(asked[0].pageUrl,'https://docs.test/a');assert.equal(asked[0].current(),true);
 asked[0].deliver({data:'data:image/png;base64,OWN',url:'https://docs.test/icon.png'});
 assert.equal(h.events.at(-1).peek.favicon,'data:image/png;base64,OWN','the page\'s own icon replaces the kept one');
 // the same publish carries it again (layout changes), and the frame's own state is not widened by it
 h.peek.relayout();assert.equal(h.events.at(-1).peek.favicon,'data:image/png;base64,OWN');
 // a new document: the kept icon of the new site, not the old page's
 view.url='https://next.test/b';view.emit('did-navigate',{});
 assert.equal(h.events.at(-1).peek.favicon,'data:image/png;base64,NEXTKEPT','a new document clears the old icon for the new site\'s kept one');
 view.emit('page-favicon-updated',{},['https://next.test/i.png']);const second=asked.at(-1);
 view.url='https://third.test/c';view.emit('did-navigate',{});
 assert.equal(second.current(),false,'an answer for the previous document is no longer wanted');
 second.deliver({data:'data:image/png;base64,LATE',url:'https://next.test/i.png'});
 assert.equal(h.events.at(-1).peek.favicon,'','a late answer neither shows nor is kept');
 // too heavy for an event: dropped
 view.emit('page-favicon-updated',{},['https://third.test/i.png']);asked.at(-1).deliver({data:'data:image/png;base64,'+'A'.repeat(70000),url:'x'});
 assert.equal(h.events.at(-1).peek.favicon,'');
 assert.equal(h.peek.handle({type:'peek.state'}).peek.favicon,'','the state request carries it too');
 h.peek.close();assert.equal(h.events.at(-1).peek,null,'closing sends peek null: the card slides back');
});

test('a preview with no icon service or a failing one still opens; the card keeps its globe',()=>{
 const h=harness({resolveIcon:()=>{throw new Error('boom');},storedIcon:()=>{throw new Error('boom');}}),source=h.state.activeTabId;
 assert.equal(h.peek.open({url:'https://docs.test/a',sourceTabId:source}).ok,true);
 const view=h.children.at(-1).webContents;view.emit('page-favicon-updated',{},['https://docs.test/icon.png']);
 assert.equal(h.events.at(-1).peek.favicon,'');assert.equal(h.events.at(-1).peek.url,'https://docs.test/a');
});

// Right-click inside the preview: the page menu a tab has, for the tab the preview came from.
test('right-click in the preview asks for the page menu for the source tab, over where the preview page is; nothing after it closes or when it shows an error card',()=>{
 const asked=[],h=harness({contextMenu:call=>asked.push(call)}),source=h.state.activeTabId;
 h.peek.open({url:'https://docs.test/a',sourceTabId:source});
 const view=h.children.at(-1),params={x:40,y:30,linkURL:'https://x.test/'};
 assert.equal(h.peek.sourceOf(view.webContents),source,'the preview\'s own page knows its tab');
 assert.equal(h.peek.sourceOf({isDestroyed:()=>false}),null,'any other contents is not a preview page');
 view.webContents.emit('context-menu',{},params);
 assert.equal(asked.length,1);assert.equal(asked[0].wc,view.webContents);assert.equal(asked[0].sourceTabId,source);assert.equal(asked[0].params,params);assert.deepEqual(asked[0].bounds,view.bounds,'the menu opens over the page view');
 // a page that failed to load shows the card's own error state, a file link its download notice: no page menu behind them
 view.webContents.emit('did-fail-load',{},-105,'ERR_NAME_NOT_RESOLVED','https://docs.test/a',true);view.webContents.emit('context-menu',{},params);assert.equal(asked.length,1,'not over an error card');
 h.peek.close();
 view.webContents.emit('context-menu',{},params);assert.equal(asked.length,1,'a closed preview has no menu');
 assert.equal(h.peek.sourceOf(view.webContents),null);
});

test('a menu that cannot be built never breaks the preview',()=>{
 const h=harness({contextMenu:()=>{throw new Error('boom');}}),source=h.state.activeTabId;h.peek.open({url:'https://docs.test/a',sourceTabId:source});
 const view=h.children.at(-1);assert.doesNotThrow(()=>view.webContents.emit('context-menu',{},{x:1,y:1}));assert.equal(h.peek.active,true);
});

test('main wires one page menu for tabs and the preview: the same function, the source tab as owner, downloads from it, no extension rows',()=>{
 const main=require('node:fs').readFileSync(require('node:path').join(__dirname,'../desktop/main.cjs'),'utf8');
 assert.match(main,/wc\.on\('context-menu',\(_event,params\)=>\{if\(entry\.securedLocked\)return;showPageContextMenu\(wc,params,tab\.id,entry\.view\.getBounds\(\)\);\}\);/,'a tab\'s page shows the menu through the shared function');
 assert.match(main,/function showPageContextMenu\(wc,params,tabId,box\)\{const menu=contextCommands\.menu\(wc,params\);if\(!menu\|\|!chromeView\|\|chromeView\.webContents\.isDestroyed\(\)\)return contextCommands\.popup\(wc,params,Menu,mainWindow\);pageContextMenu=\{tabId,/);
 assert.match(main,/contextMenu:\(\{wc,params,sourceTabId,bounds\}\)=>showPageContextMenu\(wc,params,sourceTabId,bounds\)/,'the preview shows it for the tab it came from');
 assert.match(main,/getContext:wc=>\{const from=peek\.sourceOf\(wc\),id=pageOwner\(pages,wc\)\|\|from,/,'the preview\'s page is owned by its source tab');
 assert.match(main,/extensionItems:\(wc,params\)=>peek\.sourceOf\(wc\)\?\[\]:/,'no extension rows for a preview page');
});

test('after a menu closes over the preview the keyboard goes back to the preview\'s page, not to the page behind it; never to an error card or a closed preview',()=>{
 const h=harness(),source=h.state.activeTabId;h.peek.open({url:'https://docs.test/a',sourceTabId:source});
 const view=h.children.at(-1),frame=h.children.at(-2);
 assert.equal(h.peek.focusTarget(),null,'not shown yet');
 view.webContents.emit('dom-ready');frame.webContents.ipc.emit('acira:peek-frame',{},'entered');
 assert.equal(h.peek.focusTarget(),view.webContents,'shown: its own page');
 view.webContents.emit('did-fail-load',{},-105,'ERR_NAME_NOT_RESOLVED','https://docs.test/a',true);
 assert.equal(h.peek.focusTarget(),null,'an error card holds the screen');
 h.peek.close();assert.equal(h.peek.focusTarget(),null);
 const main=require('node:fs').readFileSync(require('node:path').join(__dirname,'../desktop/main.cjs'),'utf8');
 assert.match(main,/function restoreVisibleFocus\(\)\{const preview=peek\.focusTarget\(\),entry=pages\.get\(state\.activeTabId\);[^]*?if\(preview\)focusContents\(preview\);else if\(entry&&/);
});
