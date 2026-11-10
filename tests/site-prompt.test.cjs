'use strict';
// R3-73: the site prompt card (desktop/site-prompt.cjs): where it goes, which request it shows and when, and that every way of
// answering reaches the caller exactly once. The native view is a fake; the page's replies (ready, its height, the answer) are
// played by the test. Also the alert/confirm/prompt hook (desktop/browser-services/js-dialogs.cjs).
const test=require('node:test');const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');const fs=require('node:fs');const path=require('node:path');
const {createInitialState,reduceBrowser}=require('../desktop/runtime.cjs');
const {createSitePrompt,anchoredPlacement,centredBounds,describe,WIDTH,GAP,MARGIN,EXIT_MS,NEXT_MS}=require('../desktop/site-prompt.cjs');
const {createJsDialogs,hostOf}=require('../desktop/browser-services/js-dialogs.cjs');

class FakeContents extends EventEmitter{
 constructor(){super();this.ipc=new EventEmitter();this.sent=[];this.destroyed=false;this.focused=0;this.height=132;}
 loadFile(){setImmediate(()=>this.ipc.emit('acira:site-prompt',{},{type:'ready'}));return Promise.resolve();}
 send(channel,state){this.sent.push(state);if(state.type==='show')setImmediate(()=>this.ipc.emit('acira:site-prompt',{},{type:'size',token:state.token,height:this.height}));}
 setZoomFactor(value){this.zoom=value;}setWindowOpenHandler(){}isDestroyed(){return this.destroyed;}close(){this.destroyed=true;}focus(){this.focused++;}isFocused(){return false;}
 answer(message){this.ipc.emit('acira:site-prompt',{},message);}
}
class FakeView{constructor(options){this.options=options;this.webContents=new FakeContents();this.bounds=null;this.visible=false;}setBounds(b){this.bounds=b;}setVisible(v){this.visible=v;}setBackgroundColor(){}}
const flush=async(times=8)=>{for(let i=0;i<times;i++)await new Promise(resolve=>setImmediate(resolve));};

function harness(options={}){
 let state=createInitialState();
 for(const url of ['https://one.test/','https://two.test/'])state=reduceBrowser(state,{type:'tab.new',url});
 const h={get state(){return state;},set state(value){state=value;},views:[],blocked:false,reduced:false,focusedWindow:true,manage:[],restored:0,anchor:{x:96,y:36,width:28,height:28},scale:1};
 const children=[],win={isDestroyed:()=>false,isFocused:()=>h.focusedWindow,contentView:{children,getBounds:()=>({x:0,y:0,width:1200,height:800}),addChildView(v){const i=children.indexOf(v);if(i>=0)children.splice(i,1);children.push(v);},removeChildView(v){const i=children.indexOf(v);if(i>=0)children.splice(i,1);}}};
 h.children=children;
 h.tabs=new Map();h.pageA={isDestroyed:()=>false};h.pageB={isDestroyed:()=>false};
 h.card=createSitePrompt({WebContentsView:function(opts){const v=new FakeView(opts);h.views.push(v);return v;},getWindow:()=>win,getState:()=>state,
  tabOf:wc=>wc===h.pageA?state.tabs[0]?.id:wc===h.pageB?state.tabs[1]?.id:null,anchorOf:async()=>h.anchor,pageBounds:()=>({x:0,y:72,width:1200,height:728}),
  blocked:()=>h.blocked,isDark:()=>true,speed:()=>options.speed||'premium',reducedMotion:()=>h.reduced,uiScale:()=>h.scale,faviconFor:host=>host==='example.com'?'data:image/png;base64,AAAA':'',
  say:id=>id,onManage:entry=>h.manage.push(entry.host),restoreFocus:()=>{h.restored++;},enabled:()=>true});
 h.view=()=>h.views[0];h.page=()=>h.views[0]?.webContents;
 h.shown=()=>h.page().sent.filter(m=>m.type==='show');
 h.select=id=>{state=reduceBrowser(state,{type:'tab.select',id});h.card.onState();};
 h.tab=index=>state.tabs[index];
 return h;
}
const permission=(extra={},site={})=>({type:'question',popover:true,message:'example.com wants to send you notifications',detail:'',buttons:['Block','Allow'],defaultId:0,cancelId:0,site:{host:'example.com',manage:true,...site},...extra});
const settle=async(ms=EXIT_MS+NEXT_MS+30)=>{await new Promise(resolve=>setTimeout(resolve,ms));await flush();};

test('where the anchored card goes: 8px under the icon with left edges aligned, kept 8px inside the window, never over the icon',()=>{
 const win={width:1200,height:800},anchor={x:96,y:36,width:28,height:28};
 const placed=anchoredPlacement({anchor,window:win,height:132});
 assert.deepEqual(placed.card,{x:96,y:36+28+GAP,width:WIDTH,height:132});
 assert.equal(placed.bounds.y,anchor.y+anchor.height,'the view starts at the icon\'s bottom edge and never covers it');
 assert.equal(placed.inset.top,GAP);assert.equal(placed.inset.left,MARGIN);
 assert.equal(placed.origin.x,14,'the aperture opens at the icon\'s centre, in card pixels');
 assert.equal(anchoredPlacement({anchor:{x:1190,y:36,width:28,height:28},window:win,height:132}).card.x,1200-WIDTH-8,'clamped 8px inside the window');
 assert.equal(anchoredPlacement({anchor:{x:-20,y:36,width:28,height:28},window:win,height:132}).card.x,8);
 assert.ok(anchoredPlacement({anchor:{x:96,y:780,width:28,height:28},window:win,height:132}).card.y+132<=800-8,'a low icon keeps the card on screen');
 const none=anchoredPlacement({anchor:null,page:{x:0,y:72,width:1200,height:728},window:win,height:132});
 assert.deepEqual([none.card.x,none.card.y],[12,78],'no icon on screen (focus mode): top-left of the page');
 assert.ok(none.bounds.x>=0&&none.bounds.y>=0&&none.bounds.x+none.bounds.width<=1200&&none.bounds.y+none.bounds.height<=800,'the view stays inside the window');
});

test('at 150% the card is 1.5x in window pixels and its inset stays in interface pixels',()=>{
 const placed=anchoredPlacement({anchor:{x:144,y:54,width:42,height:42},window:{width:1800,height:1200},height:132,scale:1.5});
 assert.equal(placed.card.width,480);assert.equal(placed.card.height,198);assert.equal(placed.card.y,54+42+12);
 assert.equal(placed.inset.left,MARGIN,'the page places the card by interface pixels (its shadow room scales with the interface)');assert.equal(placed.inset.top,GAP);
});

test('the centred card\'s view is the page area (it dims the page and the page below never gets the press)',()=>{
 assert.deepEqual(centredBounds({page:{x:0,y:72,width:1200,height:728},window:{width:1200,height:800}}),{x:0,y:72,width:1200,height:728});
 assert.deepEqual(centredBounds({page:null,window:{width:900,height:600}}),{x:0,y:0,width:900,height:600});
});

test('a permission lists its actions first and the safe answer last; a dialog accents its default and a warning\'s other action reads as destructive',()=>{
 const p=describe(permission({buttons:['Block','Allow','Allow this time']}));
 assert.equal(p.mode,'anchored');assert.deepEqual(p.buttons.map(b=>[b.label,b.role]),[['Allow','primary'],['Allow this time','secondary'],['Block','secondary']]);
 assert.deepEqual([p.cancelId,p.defaultId],[0,0]);assert.equal(p.manage,true);
 const leave=describe({type:'warning',message:'Leave this site?',buttons:['Stay','Leave'],defaultId:0,cancelId:0,site:{centered:true,host:'example.com'}});
 assert.equal(leave.mode,'centered');assert.deepEqual(leave.buttons.map(b=>[b.label,b.role]),[['Leave','danger'],['Stay','primary']]);
 const js=describe({message:'example.com says',detail:'Hi',buttons:['Cancel','OK'],defaultId:1,cancelId:0,site:{centered:true,input:{value:'x'}}});
 assert.deepEqual(js.buttons.map(b=>[b.label,b.role]),[['OK','primary'],['Cancel','secondary']]);assert.deepEqual(js.input,{value:'x'});
 const clipped=describe({popover:true,message:'x'.repeat(900),detail:'y'.repeat(900),buttons:[1,2,3,4,5,6,7,8],cancelId:99,defaultId:-1});
 assert.equal(clipped.message.length,300);assert.equal(clipped.detail.length,600);assert.equal(clipped.buttons.length,5,'at most five buttons');assert.equal(clipped.cancelId,4,'a bad cancelId falls back to the last button');
});

test('a request shows its card anchored, without ever taking focus; the answer reaches the caller once',async()=>{
 const h=harness(),asked=h.card.showMessageBox(permission());
 await flush();
 assert.equal(h.card.visible,true);assert.equal(h.view().visible,true);assert.equal(h.page().focused,0,'typing in the page or the address bar carries on: the card never takes focus');
 const [show]=h.shown();assert.deepEqual([show.mode,show.host,show.message,show.favicon],['anchored','example.com','example.com wants to send you notifications','data:image/png;base64,AAAA']);
 assert.deepEqual(show.buttons.map(b=>b.label),['Allow','Block']);assert.equal(show.manage.label,'sitePrompt.manage');assert.equal(show.note,'');
 assert.ok(h.page().sent.some(m=>m.type==='reveal'&&m.token===show.token),'then it grows out of the icon');
 const token=show.token;h.page().answer({type:'answer',token,index:1,dismissed:false});
 assert.deepEqual(await asked,{response:1,checkboxChecked:false});
 h.page().answer({type:'answer',token,index:0,dismissed:false});await flush();
 assert.equal(h.card.pending,0,'a second answer to the same card is ignored');
});

test('Esc, ×, and a page that went away answer "dismissed" with the cancel button, remembering nothing',async()=>{
 const h=harness();h.select(h.tab(0).id);const asked=h.card.showMessageBox(permission());await flush();
 h.page().answer({type:'answer',token:h.shown()[0].token,index:0,dismissed:true});
 assert.deepEqual(await asked,{response:0,checkboxChecked:false,dismissed:true});
 await settle();
 let moved=false;const second=h.card.showMessageBox(permission({},{contents:h.pageA,stale:()=>moved}));await flush();assert.equal(h.card.visible,true);
 moved=true;h.card.onState();assert.deepEqual(await second,{response:0,checkboxChecked:false,dismissed:true},'its page navigated: dismissed, not a decision');
 await settle();assert.equal(h.card.pending,0);
 const gone=h.card.showMessageBox(permission({},{contents:h.pageB}));await flush();h.pageB.isDestroyed=()=>true;h.card.onState();assert.equal((await gone).dismissed,true,'its page was destroyed');
});

test('requests are asked one at a time, in order; the next card arrives after the first has left',async()=>{
 const h=harness(),order=[];
 const a=h.card.showMessageBox(permission({message:'a.test wants your location'},{host:'a.test'})).then(r=>order.push(['a',r.response]));
 const b=h.card.showMessageBox(permission({message:'b.test wants your location'},{host:'b.test'})).then(r=>order.push(['b',r.response]));
 await flush();assert.equal(h.card.pending,2);assert.equal(h.card.current.host,'a.test');assert.equal(h.shown().length,1,'only the first card is shown');
 h.page().answer({type:'answer',token:h.shown()[0].token,index:1});await a;
 assert.equal(h.card.current,null,'the first card is leaving');
 await settle();
 assert.equal(h.shown().length,2);assert.equal(h.card.current.host,'b.test');
 h.page().answer({type:'answer',token:h.shown()[1].token,index:0,dismissed:false});await b;
 assert.deepEqual(order,[['a',1],['b',0]]);
});

test('a request waits for its own tab: nothing shows over another tab, and it appears when its tab comes forward',async()=>{
 const h=harness(),[one,two]=[h.tab(0),h.tab(1)];
 h.select(one.id);
 const waiting=h.card.showMessageBox(permission({},{contents:h.pageB}));await flush();
 assert.equal(h.card.visible,false,'tab two is not the one on screen');assert.equal(h.card.pending,1,'but its question is still open');
 const here=h.card.showMessageBox(permission({message:'one.test wants to use your camera'},{host:'one.test',contents:h.pageA}));await flush();
 assert.equal(h.card.current.host,'one.test','another tab\'s request does not hold up this tab\'s');
 h.page().answer({type:'answer',token:h.shown()[0].token,index:1});await here;await settle();
 h.select(two.id);await flush();assert.equal(h.card.current.host,'example.com','switching to tab two shows its request');
 h.page().answer({type:'answer',token:h.shown()[1].token,index:1});assert.equal((await waiting).response,1);
});

test('a card steps aside for a menu or another popup and comes back, unanswered, when the space is free',async()=>{
 const h=harness(),asked=h.card.showMessageBox(permission());await flush();assert.equal(h.card.visible,true);
 h.blocked=true;h.card.relayout();assert.equal(h.card.visible,false,'a popup took the space');assert.equal(h.card.pending,1,'the question is still open');
 await settle();assert.equal(h.view().visible,false);
 h.blocked=false;h.card.relayout();await flush();assert.equal(h.card.visible,true,'back when the popup is gone');
 h.page().answer({type:'answer',token:h.shown().at(-1).token,index:0,dismissed:true});assert.equal((await asked).dismissed,true);
});

test('only the card\'s own page can answer, with a button that exists; "Manage" closes the question and opens the settings',async()=>{
 const h=harness(),asked=h.card.showMessageBox(permission());await flush();
 const token=h.shown()[0].token;
 h.page().answer({type:'answer',token:token+1,index:1});h.page().answer({type:'answer',token,index:7});h.page().answer({type:'nonsense'});h.page().answer(null);
 assert.equal(h.card.pending,1,'a wrong token, a button that does not exist and junk are ignored');
 h.page().answer({type:'manage',token});assert.equal((await asked).dismissed,true);assert.deepEqual(h.manage,['example.com'],'Manage is not a decision; the settings open');
});

test('centred cards (alert, confirm, prompt, "Leave this site?") dim the page, take focus when the window has it, and give focus back',async()=>{
 const h=harness(),asked=h.card.showMessageBox({type:'question',message:'example.com says',detail:'Hello',buttons:['Cancel','OK'],defaultId:1,cancelId:0,site:{centered:true,host:'example.com',input:{value:'seed'}}});await flush();
 const [show]=h.shown();assert.equal(show.mode,'centered');assert.deepEqual(show.input,{value:'seed'});
 assert.deepEqual(h.view().bounds,{x:0,y:72,width:1200,height:728},'the view is the page area');assert.equal(h.page().focused,1);
 h.page().answer({type:'answer',token:show.token,index:0,value:'typed'});
 assert.deepEqual(await asked,{response:0,checkboxChecked:false,value:'typed'});assert.equal(h.restored,1);
 await settle();h.focusedWindow=false;
 const quiet=h.card.showMessageBox({message:'Leave?',buttons:['Stay','Leave'],site:{centered:true}});await flush();assert.equal(h.page().focused,1,'a background window is never given focus');
 h.page().answer({type:'answer',token:h.shown().at(-1).token,index:0,dismissed:true});await quiet;
});

test('the page is told the speed, the theme, the private note and the mute choice; reduced motion reads as Off',async()=>{
 const h=harness({speed:'fast'});h.reduced=true;
 const asked=h.card.showMessageBox(permission({},{private:true,mute:{label:'Stop'}}));await flush();
 const [show]=h.shown();assert.deepEqual([show.speed,show.reducedMotion,show.dark],['off',true,true]);
 assert.equal(show.note,'sitePrompt.privateNote');
 assert.deepEqual(show.mute,{label:'Stop'});
 h.page().answer({type:'answer',token:show.token,index:0,dismissed:true,muted:true});assert.deepEqual(await asked,{response:0,checkboxChecked:false,dismissed:true,muted:true});
});

test('a private window never shows a stored icon; the interface scale zooms the card page',async()=>{
 const h=harness();h.scale=1.5;
 const asked=h.card.showMessageBox(permission({},{private:true}));await flush();
 assert.equal(h.shown()[0].favicon,'');assert.equal(h.page().zoom,1.5);
 assert.equal(h.view().bounds.width,Math.round(WIDTH*1.5)+2*MARGIN*1.5,'the view is the card plus its shadow room');
 h.page().answer({type:'answer',token:h.shown()[0].token,index:0,dismissed:true});await asked;
});

test('closing the window answers everything that was waiting, and nothing is shown afterwards',async()=>{
 const h=harness(),a=h.card.showMessageBox(permission()),b=h.card.showMessageBox(permission());await flush();
 h.card.dispose();
 assert.equal((await a).dismissed,true);assert.equal((await b).dismissed,true);
 assert.equal((await h.card.showMessageBox(permission())).dismissed,true,'asking after the window closed answers at once');
});

test('the page ships its own copy of the springs; the card page shows website text only as text',()=>{
 const html=fs.readFileSync(path.join(__dirname,'..','desktop','site-prompt.html'),'utf8');
 assert.ok(html.includes('//#spring')&&html.includes('//#endspring'));
 assert.doesNotMatch(html.replace(/\/\/#spring[\s\S]*?\/\/#endspring/,''),/innerHTML|insertAdjacentHTML|outerHTML|document\.write/,'every string is set with textContent');
 assert.match(html,/default-src 'none'/,'a locked-down content policy');
 const preload=fs.readFileSync(path.join(__dirname,'..','desktop','site-prompt-preload.cjs'),'utf8');
 assert.match(preload,/Number\.isInteger\(message\.index\)|integer\(message\.index,0,9\)/);
});

// ---- alert / confirm / prompt ----
function dialogs({owner=true,enabled=true,answers=[]}={}){
 const asked=[],page={isDestroyed:()=>false,getURL:()=>'https://example.com/path',on(){}};
 const controller={closing:false,pages:new Map([['tab-1',{view:{webContents:page}}]]),sitePrompt:{enabled:()=>enabled,showMessageBox:async options=>{asked.push(options);return answers.shift()||{response:1};}}};
 let clock=1000;
 const hook=createJsDialogs({controllers:new Set(owner?[controller]:[]),t:(id,params)=>params?id+':'+params.host:id,now:()=>clock});
 const call=(payload,sender=page)=>{const event={sender,senderFrame:{url:'https://frame.example/x'},returnValue:undefined};hook.handle(event,payload);return event;};
 return {asked,page,call,tick:ms=>{clock+=ms;}};
}
const settled=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};

test('alert, confirm and prompt are answered by the card: the reply goes back to the blocked page',async()=>{
 const d=dialogs({answers:[{response:1},{response:1},{response:0},{response:1,value:'typed'},{response:0,dismissed:true,value:'x'}]});
 const alert=d.call({kind:'alert',message:'Saved'});await settled();assert.deepEqual(alert.returnValue,{ok:true});
 const yes=d.call({kind:'confirm',message:'Sure?'});await settled();assert.deepEqual(yes.returnValue,{value:true});
 const no=d.call({kind:'confirm',message:'Sure?'});await settled();assert.deepEqual(no.returnValue,{value:false});
 const typed=d.call({kind:'prompt',message:'Name?',initial:'Ann'});await settled();assert.deepEqual(typed.returnValue,{value:'typed'});
 const esc=d.call({kind:'prompt',message:'Name?'});await settled();assert.deepEqual(esc.returnValue,{value:null},'Esc is Cancel: null');
 const first=d.asked[0];assert.deepEqual([first.site.centered,first.site.host,first.message,first.detail,first.buttons],[true,'frame.example','sitePrompt.says:frame.example','Saved',['sitePrompt.ok']],'the frame that asked is named; an alert has one button');
 assert.deepEqual(d.asked[3].site.input,{value:'Ann'});
});

test('what a page sends is checked: an unknown kind, a non-string message, or an asker that is not a tab gets the system dialog',()=>{
 const d=dialogs();
 assert.deepEqual(d.call({kind:'beep',message:'x'}).returnValue,{native:true});assert.deepEqual(d.call({kind:'alert',message:{toString(){}}}).returnValue,{native:true});assert.deepEqual(d.call(null).returnValue,{native:true});
 assert.deepEqual(d.call({kind:'alert',message:'x'},{isDestroyed:()=>false,getURL:()=>'https://x.test/'}).returnValue,{native:true},'a view that is not one of the window\'s tabs');
 assert.deepEqual(dialogs({owner:false}).call({kind:'alert',message:'x'}).returnValue,{native:true});
 assert.deepEqual(dialogs({enabled:false}).call({kind:'alert',message:'x'}).returnValue,{native:true},'a window that can\'t show the card (tests, hidden): system dialog, never lost');
});

test('a page that keeps asking is offered "stop", and once stopped it is answered with the defaults until it moves on',async()=>{
 const d=dialogs({answers:[{response:1},{response:1},{response:1,muted:true}]});
 for(let i=0;i<2;i++){d.call({kind:'alert',message:'x'});await settled();d.tick(500);}
 assert.equal(d.asked[0].site.mute,undefined);assert.equal(d.asked[1].site.mute,undefined);
 d.call({kind:'confirm',message:'again'});await settled();assert.equal(d.asked[2].site.mute.label,'sitePrompt.stopDialogs','the third in ten seconds offers to stop them');
 const muted=d.call({kind:'confirm',message:'again'});assert.deepEqual(muted.returnValue,{value:false});assert.equal(d.asked.length,3,'no card for a stopped page');
 assert.deepEqual(d.call({kind:'prompt',message:'x'}).returnValue,{value:null});assert.deepEqual(d.call({kind:'alert',message:'x'}).returnValue,{ok:true});
});

test('the host shown is the frame\'s own, and only for web addresses',()=>{
 assert.equal(hostOf('https://a.example:8443/x'),'a.example:8443');assert.equal(hostOf('file:///c:/x'),'');assert.equal(hostOf('nonsense'),'');
});

test('the three ends are wired: the engine asks the card, the preload hooks the page, main routes both',()=>{
 const main=fs.readFileSync(path.join(__dirname,'..','desktop','main.cjs'),'utf8'),engine=fs.readFileSync(path.join(__dirname,'..','desktop','browser-services','permission-engine.cjs'),'utf8');
 assert.match(main,/createSitePrompt\(/);assert.match(main,/sitePrompt\.relayout\(\)/);assert.match(main,/sitePrompt\.onState\(\)/);assert.match(main,/sitePrompt\.dispose\(\)/);
 assert.match(main,/ipcMain\.on\('acira:js-dialog'/);assert.match(main,/siteDialog\(\{\.\.\.asked,site:\{\.\.\.asked\.site,centered:true,contents:wc/,'"Leave this site?" and the unsaved-tab close (R4-35) use the card');assert.match(main,/\{type:'warning',title:tm\("main\.unsavedChanges"\)/,'a typed address keeps Leave this site?');
 assert.match(main,/promptDialog\.showMessageBox\(mainWindow,\{type:'question',popover:true,message,detail,/,'"Open <app>?" (external-protocol.cjs) uses the anchored card');
 assert.match(engine,/js-dialog-preload\.cjs/);assert.match(engine,/getWindow\(wc\)/);
});

test('R4-47: the close variant of the card puts the primary button last, after Cancel, and only passes plain host lists',()=>{
 const quit=describe({type:'question',message:'Close Acira?',buttons:['Close Acira','Cancel'],defaultId:0,cancelId:1,site:{centered:true,variant:'close',app:true,strip:{hosts:['a.test',7,'b.test'],more:3}}});
 assert.equal(quit.variant,'close');assert.deepEqual(quit.buttons.map(b=>b.label),['Cancel','Close Acira'],'secondary left, primary right (Back / Continue)');assert.equal(quit.buttons[1].role,'primary');
 assert.deepEqual(quit.strip,{hosts:['a.test','b.test'],more:3});assert.equal(quit.list,null);
 const unsaved=describe({type:'warning',message:'x',buttons:['Close anyway','Cancel'],defaultId:1,cancelId:1,site:{centered:true,variant:'close',list:{hosts:Array.from({length:12},(_,i)=>'s'+i+'.test'),more:2}}});
 assert.deepEqual(unsaved.buttons.map(b=>[b.label,b.role]),[['Close anyway','danger'],['Cancel','primary']],'with unsaved work Cancel is the primary');assert.equal(unsaved.list.hosts.length,8);
 const plain=describe({type:'warning',message:'x',buttons:['Leave','Stay'],defaultId:1,cancelId:1,site:{centered:true}});
 assert.equal(plain.variant,'');assert.deepEqual(plain.buttons.map(b=>b.label),['Leave','Stay']);assert.equal(plain.strip,null);
 assert.equal(describe({message:'x',buttons:['A','B'],site:{variant:'close'}}).variant,'','the variant is only for centred cards');
});
