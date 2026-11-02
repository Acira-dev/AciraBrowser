'use strict';
// R4-58 · Peek polish: Copy link from the card, the page shown only once the card has formed and the page has a document (the
// dot-matrix loader fills the card until then, a slow page shows after a cap), and the frame's morph and loader as written.
const test=require('node:test');const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');const fs=require('node:fs');const path=require('node:path');
const {createInitialState,reduceBrowser}=require('../desktop/runtime.cjs');
const {createPeek}=require('../desktop/rewind/peek.cjs');

class FakeContents extends EventEmitter{
 constructor(options){super();this.options=options;this.url='';this.destroyed=false;this.session=new EventEmitter();this.ipc=new EventEmitter();this.sent=[];this.navigationHistory={canGoBack:()=>false,goBack:()=>{}};}
 loadURL(url){this.url=url;return Promise.resolve();}loadFile(){return Promise.resolve();}getURL(){return this.url;}getTitle(){return 'Title';}isLoading(){return false;}reload(){}stop(){}
 isDestroyed(){return this.destroyed;}close(){this.destroyed=true;}focus(){}send(...args){this.sent.push(args);}setWindowOpenHandler(){}setWebRTCIPHandlingPolicy(){}insertCSS(){return Promise.resolve('k');}removeInsertedCSS(){return Promise.resolve();}
}
class FakeView{constructor(options){this.webContents=new FakeContents(options);this.visible=true;}setBounds(){}setBorderRadius(){}setBackgroundColor(){}setVisible(v){this.visible=v;}}
function harness({reduced=false}={}){
 let state=createInitialState();state=reduceBrowser(state,{type:'tab.navigate',tabId:state.activeTabId,url:'https://source.test/'});
 const children=[],copied=[];
 const win={isDestroyed:()=>false,contentView:{children,addChildView(v){const i=children.indexOf(v);if(i>=0)children.splice(i,1);children.push(v);},removeChildView(v){const i=children.indexOf(v);if(i>=0)children.splice(i,1);}}};
 const peek=createPeek({WebContentsView:FakeView,getWindow:()=>win,getState:()=>state,dispatch:a=>{state=reduceBrowser(state,a);},pageBounds:()=>({x:0,y:68,width:1200,height:800}),pagePreload:'page.cjs',partitionOf:id=>state.browserProfiles.find(p=>p.id===id)?.partition,reducedMotion:()=>reduced,copyText:text=>copied.push(text)});
 peek.open({url:'https://docs.test/page',sourceTabId:state.activeTabId});
 const view=children.at(-1),frame=children.at(-2),say=command=>frame.webContents.ipc.emit('acira:peek-frame',{},command),last=()=>frame.webContents.sent.filter(x=>x[0]==='acira:peek-frame-state').at(-1)[1];
 return {peek,view,frame,say,last,copied};
}

test('Copy link puts the page\'s address on the clipboard and says so on the card, then the words go',async()=>{
 const h=harness();h.say('copy');
 assert.deepEqual(h.copied,['https://docs.test/page']);
 assert.equal(h.last().notice,'Link copied');assert.equal(h.last().copied,true,'the button shows a tick');
 assert.equal(h.last().labels.copy,'Copy link');
 assert.match(fs.readFileSync(path.join(__dirname,'../desktop/rewind/peek-frame-preload.cjs'),'utf8'),/'copy'/,'the frame may send it');
 h.peek.close();
});

test('the page view waits for the formed card and the page\'s first document; the frame is told when it shows',()=>{
 const h=harness();
 assert.equal(h.view.visible,false,'hidden while the card grows');
 h.say('entered');assert.equal(h.view.visible,false,'formed, but the page has no document yet: the loader stays');
 h.view.webContents.emit('dom-ready');assert.equal(h.view.visible,true);assert.equal(h.last().revealed,true,'the frame stops its loader');
 h.peek.close();
 const g=harness();g.view.webContents.emit('dom-ready');assert.equal(g.view.visible,false,'a fast page still waits for the card');g.say('entered');assert.equal(g.view.visible,true);g.peek.close();
 const f=harness();f.say('entered');f.view.webContents.emit('did-fail-load');assert.equal(f.view.visible,true,'an error page shows too');f.peek.close();
});

test('a slow page shows itself after the cap; reduced motion skips the growth but keeps the loader until the document',async()=>{
 const h=harness();h.say('entered');await new Promise(r=>setTimeout(r,1700));assert.equal(h.view.visible,true,'shown after LOAD_CAP_MS');h.peek.close();
 const r=harness({reduced:true});await new Promise(res=>setTimeout(res,5));assert.equal(r.view.visible,false);r.view.webContents.emit('dom-ready');assert.equal(r.view.visible,true);r.peek.close();
});

test('the frame: Copy link control, a morph that grows about the link on the same spring, and the dot-matrix loader',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../desktop/rewind/peek-frame.html'),'utf8');
 assert.match(html,/id="copy"/);assert.match(html,/peekFrame\.command\('copy'\)/);
 assert.match(html,/transform:'scale\(\.94\)'\},\{clipPath:APERTURE_END,transform:'none'\}\],grow,\{opening:true\}/,'opens from the link: aperture and scale together');
 assert.match(html,/transform:'scale\(\.96\)'\}\],exit\)/,'closes back toward the link');
 assert.match(html,/card\.style\.transformOrigin=originAt\(state\.link,g\)/);
 assert.match(html,/<canvas id="matrix"/);assert.match(html,/const working=\(t,r,c,R,C\)=>/,'the app\'s Working lights');
 assert.match(html,/revealed=!!state\.revealed/,'the loader stops once the page shows');
 assert.doesNotMatch(html,/https?:\/\/(?!www\.w3\.org)/,'the frame fetches nothing');
});

// The card's header says "Not secure" by the address field's rule (ui/urlDisplay.ts), not for every http: address: a page on this machine or the
// local network, or an onion address, is not flagged (found in the real app: a peek of http://127.0.0.1 showed it).
test('the peek card flags plain http as Not secure only where the address field does',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../desktop/rewind/peek-frame.html'),'utf8');
 const local=html.match(/^const local=.*;$/m),parts=html.match(/^const parts=.*;$/m);
 assert.ok(local&&parts,'the frame has the local-host rule and the parts reader');
 const {parts:read}=new Function(`${local[0]}${parts[0]}return {parts};`)();
 const insecure=url=>read(url).insecure;
 for(const url of ['http://example.com/','http://www.example.org:8080/a','http://8.8.8.8/'])assert.equal(insecure(url),true,url);
 for(const url of ['https://example.com/','http://localhost:3000/','http://app.localhost/','http://127.0.0.1:5173/p','http://[::1]:3000/','http://192.168.1.20/','http://10.0.0.5/','http://172.20.1.1/','http://abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcd.onion/'])assert.equal(insecure(url),false,url);
});
