// Visible, isolated Mac window for CUA verification of actual native buttons.
import fs from 'node:fs/promises';import path from 'node:path';
import {startApp,httpFixture,sleep} from './d-harness.mjs';
const out=path.resolve(process.env.MAC_CONTROLS_OUT||'qa/artifacts/mac-window-controls-desktop');await fs.mkdir(out,{recursive:true});
let app,server;const events=[];
try {
 server=await httpFixture((_q,r)=>{r.setHeader('Content-Type','text/html;charset=utf-8');r.end('<title>Window controls verification</title><style>body{background:#e6eef6;font:28px system-ui;padding:60px;color:#183147}button{font:24px system-ui}</style><h1>Mac window controls</h1><p>Full · Compact · Seamless</p><button onclick="this.textContent=\'Page button works\'">Test page button</button>');});
 app=await startApp({root:path.resolve('.qa-profiles/mac-controls-desktop-'+Date.now()),main:path.resolve('qa/mac-window-controls-entry.cjs'),env:{ACIRA_BROWSER_TEST_HIDDEN:'0',ACIRA_QA_MAIN:path.join(path.resolve(process.argv[2]||'.'),'desktop/main.cjs')}});
 await app.context.route('https://**/*',r=>r.abort());
 await app.act({type:'settings.update',patch:{askBeforeClosing:false,reducedMotion:false,appearance:'light',interfaceScale:100,verticalTabs:false,windowView:'compact'}});
 await app.act({type:'ui.update',patch:{view:'compact'}});await app.act({type:'tab.navigate',url:'http://127.0.0.1:'+server.port+'/'});
 await app.main(({BaseWindow,app})=>{const w=BaseWindow.getAllWindows().find(w=>w.contentView.children.some(v=>v.webContents?.getURL()==='acira-browser-ui://ui/index.html'));global.__controlWindow=w;w.setBounds({x:200,y:120,width:1000,height:720});w.setTitle('Acira — window controls verification');w.show();w.focus();app.focus({steal:true});global.__controlEvents=[];for(const e of ['minimize','restore','enter-full-screen','leave-full-screen','close','closed'])w.on(e,()=>global.__controlEvents.push({event:e,at:Date.now()}));w.on('minimize',()=>setTimeout(()=>{if(!w.isDestroyed()){w.restore();w.focus();}},2000));});
 await fs.writeFile(path.join(out,'ready.json'),JSON.stringify({pid:app.app.process().pid,profile:app.root}));console.log('VISIBLE_READY');
 const until=Date.now()+600000;while(Date.now()<until&&!app.app.process().exitCode){try{const n=await app.main(({BaseWindow})=>{const w=global.__controlWindow;return {events:global.__controlEvents,fullscreen:w?.isFullScreen(),minimized:w?.isMinimized(),buttons:w?JSON.parse(global.__aciraWindowButtons(w.getNativeWindowHandle())):[]};});events.splice(0,events.length,...n.events);await fs.writeFile(path.join(out,'current.json'),JSON.stringify(n,null,2));}catch{break;}if(await fs.access(path.join(out,'done')).then(()=>true,()=>false))break;await sleep(500);}
}finally{await app?.close();await server?.close();await fs.writeFile(path.join(out,'events.json'),JSON.stringify(events,null,2));}
