'use strict';
// Electron runner for tests/search-preview.test.cjs: injects the real search-preview-preload.cjs (ipcRenderer and the page address
// stubbed) into local stand-ins of each engine's result page, drives it with real mouse and key input, and reports what happened.
// Usage: electron run.cjs
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {app,BrowserWindow}=require('electron');
const {page,ENGINES}=require('./pages.cjs');
app.setPath('userData',path.join(os.tmpdir(),'acira-search-preview-'+process.pid));
app.on('window-all-closed',()=>{});
const fail=error=>{process.stdout.write('ERROR '+(error&&error.stack||error)+'\n');app.exit(1);};
process.on('uncaughtException',fail);process.on('unhandledRejection',fail);setTimeout(()=>fail(new Error('runner timed out')),90000).unref();
const source=fs.readFileSync(path.join(__dirname,'..','..','..','desktop','browser-services','search-preview-preload.cjs'),'utf8')
 .replace("const {ipcRenderer}=require('electron');",'const ipcRenderer=globalThis.__fakeIpc;').replace('const pageAddress=()=>location.href;','const pageAddress=()=>globalThis.__fakeAddress;');
if(source.includes("require('electron')")||source.includes('location.href'))throw new Error('preload stubs did not apply');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,port,theme='light';
const STATE=`(()=>{const host=document.querySelector('acira-preview');const r=globalThis.__probe;return {host:!!host,on:r?r.on():false,box:r?r.box():null,active:document.activeElement===host,sent:globalThis.__sent,invoked:globalThis.__invoked,html:document.documentElement.scrollHeight};})()`;
async function scenario(engine,{address=ENGINES[engine].address,answer={allowed:true,on:true,speed:'off',labels:{preview:'Preview'}}}={},steps){
 const win=new BrowserWindow({show:false,width:1200,height:820,webPreferences:{sandbox:false,contextIsolation:false,backgroundThrottling:false}});
 const wc=win.webContents;if(process.env.DEBUG)wc.on('console-message',event=>process.stdout.write('PAGE '+(event.message||'')+'\n'));await win.loadURL(`http://127.0.0.1:${port}/${engine}?theme=${theme}`);wc.debugger.attach('1.3');await Promise.race([wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true}),sleep(2000)]);
 // The chip's shadow root is closed: the probe keeps a handle on it the way the script does (attachShadow is wrapped first).
 await wc.executeJavaScript(`globalThis.__sent=[];globalThis.__invoked=[];globalThis.__handlers={};globalThis.__fakeAddress=${JSON.stringify(address)};
  globalThis.__fakeIpc={send:(...a)=>__sent.push(JSON.parse(JSON.stringify(a))),on:(c,f)=>{__handlers[c]=f;},invoke:(c,r)=>{__invoked.push([c,r]);return Promise.resolve(${JSON.stringify(answer)});}};
  {const attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(o){const root=attach.call(this,o);if(this.localName==='acira-preview'){const b=()=>root.querySelector('button');globalThis.__probe={on:()=>b().classList.contains('on'),box:()=>{const r=b().getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,label:b().getAttribute('aria-label'),text:b().textContent,dark:this.hasAttribute('data-dark')};},focus:()=>b().focus()};}return root;};}
  true`);
 await wc.executeJavaScript(source+'\ntrue');await sleep(30);
 const read=()=>wc.executeJavaScript(STATE),js=code=>wc.executeJavaScript(code);
 const move=async(x,y)=>{for(const d of [3,0]){wc.sendInputEvent({type:'mouseMove',x:Math.round(x)+d,y:Math.round(y)});await sleep(50);}};
 const click=async(x,y)=>{await move(x,y);wc.sendInputEvent({type:'mouseDown',x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});wc.sendInputEvent({type:'mouseUp',x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});await sleep(60);};
 const key=async(keyCode,modifiers=[])=>{wc.sendInputEvent({type:'keyDown',keyCode,modifiers});wc.sendInputEvent({type:'char',keyCode,modifiers});wc.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(60);};
 try{return await steps({read,js,move,click,key,wc});}finally{win.destroy();}
}
// Boxes of the result titles and snippets, and every result block (to prove nothing moved).
const BOXES=`(()=>{const pick=s=>[...document.querySelectorAll(s)].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
 const text=e=>{const r=document.createRange();r.selectNodeContents(e);const l=[...r.getClientRects()].filter(b=>b.width>0);const x=Math.min(...l.map(b=>b.left)),y=Math.min(...l.map(b=>b.top));return {x,y,width:Math.max(...l.map(b=>b.right))-x,height:Math.max(...l.map(b=>b.bottom))-y};};
 return {titles:[...document.querySelectorAll('main h3,main h2,main .title')].map(text),text:pick('.VwiC3b,.b_caption p,.result-snippet,.snippet-description,.w-gl__description,.result__description'),blocks:pick('main *')};})()`;
async function engineRun(engine){
 return scenario(engine,{},async({read,js,move,click,key})=>{
  const out={engine};const before=await js(BOXES);const t=before.titles[1],text=before.text[1];
  out.invoked=(await read()).invoked;
  // The chip is placed on a frame after the hover: wait for it (up to 600 ms) instead of reading the very next task.
  await move(text.x+20,text.y+text.height/2);let s=await read();for(const until=Date.now()+600;!s.box&&Date.now()<until;){await sleep(25);s=await read();}out.hoverText={on:s.on,box:s.box};
  if(!s.box)throw new Error(engine+': no chip after hovering a result');
  const after=await js(BOXES);out.layoutStable=JSON.stringify(after.blocks)===JSON.stringify(before.blocks);
  out.title=t;
  // Click the chip with the real mouse.
  await click(s.box.x+s.box.width/2,s.box.y+s.box.height/2);s=await read();out.clicked={sent:s.sent,on:s.on};
  // Hover the engine's own Images link (not a result): the chip goes.
  await move(t.x+40,t.y+t.height/2);await move(5,5);await sleep(260);s=await read();out.away={on:s.on};
  // Keyboard: focus the third title, Tab reaches its chip, Enter previews it, Esc on the chip returns to the title.
  await js(`(()=>{const h=document.querySelectorAll('main h3,main h2,main .title')[2];(h.closest('a')||h.querySelector('a')).focus();return true;})()`);await sleep(40);s=await read();out.focusTitle={on:s.on};
  await key('Tab');s=await read();out.tabToChip={active:s.active,focused:await js('document.activeElement&&document.activeElement.outerHTML.slice(0,80)')};
  if(s.active){await key('Enter');s=await read();out.enter={sent:s.sent.slice(1)};}else out.enter={sent:[]};
  return out;
 });
}
async function main(){
 server=http.createServer((req,res)=>{const u=new URL(req.url,'http://x');const engine=u.pathname.slice(1);res.setHeader('content-type','text/html; charset=utf-8');try{res.end(page(engine,{theme:u.searchParams.get('theme')||'light'}));}catch{res.statusCode=404;res.end('no');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));port=server.address().port;
 const result={engines:[]};
 for(const engine of Object.keys(ENGINES)){const t0=Date.now();result.engines.push(await engineRun(engine));if(process.env.DEBUG)process.stdout.write(`STEP ${engine} ${Date.now()-t0}ms
`);}
 theme='dark';result.dark=await scenario('google',{},async({read,move,js})=>{const b=await js(BOXES);await move(b.text[0].x+10,b.text[0].y+5);return (await read()).box;});theme='light';
 result.off=await scenario('bing',{},async({read,move,js})=>{await js(`__handlers['acira:link-preview']({}, {on:false});true`);const b=await js(BOXES);await move(b.text[0].x+10,b.text[0].y+5);const s=await read();return {host:s.host,on:s.on};});
 result.privateTab=await scenario('duckduckgo',{answer:{allowed:false,on:true}},async({read,move,js})=>{const b=await js(BOXES);await move(b.text[0].x+10,b.text[0].y+5);const s=await read();return {host:s.host,on:s.on};});
 result.otherSite=await scenario('google',{address:'https://example.com/search?q=acira'},async({read,move,js})=>{const b=await js(BOXES);await move(b.text[0].x+10,b.text[0].y+5);const s=await read();return {host:s.host,invoked:s.invoked};});
 result.images=await scenario('google',{address:'https://www.google.com/search?q=acira&tbm=isch'},async({read})=>({invoked:(await read()).invoked}));
 process.stdout.write('RESULT '+JSON.stringify(result)+'\n');server.close();app.exit(0);
}
app.whenReady().then(main).catch(fail);
