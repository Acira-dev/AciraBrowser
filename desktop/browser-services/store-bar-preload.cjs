'use strict';
// Chrome Web Store detail pages only: draws the small "Add to Acira" bar (see extension-store-bar.cjs for the main-process side).
// The store's own button is disabled outside Chrome. The bar sends only the extension ID from the page address; the main process checks it against
// the top frame's address again, asks the same permission review as Settings → Extensions, and answers with the result.
const {ipcRenderer}=require('electron');
const pageAddress=()=>location.href;
const idFromAddress=address=>{try{const url=new URL(address);if(url.protocol!=='https:')return null;const ok=url.hostname==='chromewebstore.google.com'&&url.pathname.startsWith('/detail/')||url.hostname==='chrome.google.com'&&url.pathname.startsWith('/webstore/detail/');const last=url.pathname.split('/').filter(Boolean).at(-1)||'';return ok&&/^[a-p]{32}$/.test(last)?last:null;}catch{return null;}};
const STYLE=`:host{all:initial}
.bar{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147483647;box-sizing:border-box;display:flex;align-items:center;gap:14px;max-width:min(560px,calc(100vw - 32px));padding:10px 10px 10px 18px;border-radius:999px;font:13px/1.35 system-ui,'Segoe UI',sans-serif;color:var(--fg);background:var(--bg);border:1px solid var(--line);box-shadow:0 8px 28px rgba(0,0,0,.28)}
.text{display:flex;flex-direction:column;min-width:0}.name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.note{color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
button{all:unset;box-sizing:border-box;flex:none;cursor:pointer;padding:8px 16px;border-radius:999px;font-weight:600;color:var(--on);background:var(--accent)}button:hover{filter:brightness(1.08)}button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}button[disabled]{cursor:default;opacity:.6;filter:none}
.error{color:#d9534f}
:host{--bg:#fff;--fg:#17181a;--muted:#5d6168;--line:#d8dbe0;--accent:#17181a;--on:#fff}
@media (prefers-color-scheme:dark){:host{--bg:#222427;--fg:#eceef0;--muted:#a3a8af;--line:#3a3d42;--accent:#f2f3f5;--on:#17181a}}`;
const STATUS_WORDS={works:'Tested in Acira: works.',limited:'Tested in Acira: limited.',unsupported:'Tested in Acira: does not work.'};
const make=(tag,props={},...children)=>{const element=document.createElement(tag);Object.assign(element,props);for(const child of children)element.append(child);return element;};
if(window===window.top&&/^https:\/\/(?:chromewebstore|chrome)\.google\.com\//.test(pageAddress())){
 let host=null,shadow=null,current=null,state='add',message='',info=null,name='',retries=0,lastTry=0;
 const title=()=>document.title.replace(/\s*[-–—]\s*Chrome Web Store\s*$/i,'').trim()||'This extension';
 const remove=()=>{if(host){host.remove();host=null;shadow=null;}};
 function render(){
  if(!current||!info||!info.available){remove();return;}
  if(!document.documentElement)return;
  if(!host||!host.isConnected){host=make('acira-store-bar');host.id='acira-store-bar';shadow=host.attachShadow({mode:'open'});document.documentElement.append(host);}
  name=title();
  const installed=state==='added'||info.installed&&state==='add';
  const note=message||(installed?'Added to this Acira profile.':info.compat?[STATUS_WORDS[info.compat.status]||'',info.compat.note||''].filter(Boolean).join(' '):'Adds it to this Acira profile. You review its access first.');
  const label=installed?'Added to Acira':state==='adding'?'Adding…':state==='error'?'Try again':'Add to Acira';
  const button=make('button',{type:'button',textContent:label,disabled:installed||state==='adding'});
  button.addEventListener('click',()=>{if(button.disabled)return;state='adding';message='Review the access in the window that opened.';render();
   ipcRenderer.invoke('acira:store-install',{id:current}).then(result=>{if(result&&result.ok){state='added';message='';info={...info,installed:true};}else if(result&&result.cancelled){state='add';message='';}else{state='error';message=(result&&result.error)||'The extension was not added.';}render();}).catch(()=>{state='error';message='The extension was not added.';render();});});
  shadow.replaceChildren(make('style',{textContent:STYLE}),make('div',{className:'bar',role:'region',ariaLabel:'Acira extension install'},make('div',{className:'text'},make('span',{className:'name',textContent:name}),make('span',{className:'note'+(state==='error'?' error':''),textContent:note})),button));
 }
 // The browser may still be starting when the page asks (a restored tab); it answers retry, and the bar asks again every two seconds for a while.
 async function fetchInfo(){const id=current;lastTry=Date.now();retries++;try{info=await ipcRenderer.invoke('acira:store-status',{id});}catch{info=null;}if(id!==current)return;render();}
 async function sync(){
  const id=idFromAddress(pageAddress());
  if(id!==current){current=id;state='add';message='';info=null;retries=0;if(!id){remove();return;}await fetchInfo();return;}
  if(current&&info&&info.retry&&retries<20&&Date.now()-lastTry>=2000){await fetchInfo();return;}
  // The store page is a single-page app that can rebuild the document under us (a reload with the extension already installed does); put the bar back.
  if(current&&info&&info.available&&(!host||!host.isConnected||name!==title()))render();
 }
 void sync();setInterval(()=>{void sync();},700);
}
