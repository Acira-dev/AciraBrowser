'use strict';
// The tab hover card hides when the window loses focus (Cmd-Tab, another window, a minimise). The interface already ended the card on
// its own window blur, but that never fires when the focus was in a web page (the usual case), so the card stayed over the strip.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');

test('main dismisses the card on the window\'s blur, minimise and hide, whatever has the focus and even under a native dialog',()=>{
 const handler=/for\(const event of \['blur','minimize','hide'\]\)mainWindow\.on\(event,\(\)=>\{(.*?)\}\);/.exec(main);
 assert.ok(handler,'the window-change handler is there');
 const body=handler[1],card=body.indexOf('tabCard.dismiss();'),dialog=body.indexOf('if(!dialogDepth');
 assert.ok(card>=0,'the card is dismissed');
 assert.ok(card<dialog,'before (outside) the dialog guard: a sheet that takes the focus hides the card too');
});

test('dismiss hides the card on that frame and cancels one still waiting for its delay',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const {createTabCard,SHOW_MS}=require('../desktop/tab-card.cjs'),{createInitialState,reduceBrowser}=require('../desktop/runtime.cjs'),{EventEmitter}=require('node:events');
 let state=createInitialState();for(const url of ['https://one.test/','https://two.test/'])state=reduceBrowser(state,{type:'tab.new',url});
 class Contents extends EventEmitter{constructor(){super();this.ipc=new EventEmitter();}loadFile(){setImmediate(()=>this.ipc.emit('acira:tab-card',{},'ready'));return Promise.resolve();}send(_c,m){if(!m.reveal&&!m.leaving)setImmediate(()=>this.ipc.emit('acira:tab-card',{},{size:90}));}setZoomFactor(){}isDestroyed(){return false;}close(){}}
 const views=[],win={isDestroyed:()=>false,contentView:{addChildView(){},removeChildView(){},getBounds:()=>({x:0,y:0,width:1200,height:800})}};
 const card=createTabCard({WebContentsView:function(){const v={webContents:new Contents(),setBounds(){},setVisible(on){this.visible=on;},setBackgroundColor(){},visible:true};views.push(v);return v;},getWindow:()=>win,getState:()=>state,pictures:()=>false});
 const flush=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
 const tab=state.tabs[1],anchor={x:300,y:0,width:180,height:32};
 card.command({action:'hover',tabId:tab.id,anchor,side:'below'});t.mock.timers.tick(SHOW_MS);await flush();
 assert.equal(card.visible,true);
 card.dismiss();assert.equal(card.visible,false);assert.equal(views[0].visible,false,'hidden at once, no fade under a window that went away');
 card.command({action:'hover',tabId:tab.id,anchor,side:'below'});card.dismiss();t.mock.timers.tick(SHOW_MS+50);await flush();
 assert.equal(card.visible,false,'a card still in its delay does not appear after the window went');
});
