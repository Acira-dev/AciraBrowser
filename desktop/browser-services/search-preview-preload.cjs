'use strict';
// R4-58 · Search results: hovering (or keyboard-focusing) a result shows a small "Preview" chip beside its title, and one click
// opens Peek for that result instead of leaving the results. Content script for the top frame of ordinary profile sessions
// (session.registerPreloadScript; isolated world). Outside the result pages of the engines below it does nothing at all. On a
// result page it asks the browser once whether previews are on (never in private or Tor tabs). The chip is one element on
// <html> with a closed shadow root, placed absolutely (nothing in the page moves), made on the first hover. Nothing is fetched
// and nothing is sent anywhere until the user clicks it: then only the result's address and box go to the browser.
const {ipcRenderer}=require('electron');
const pageAddress=()=>location.href;

/** Result pages Acira knows. `title` finds a result's title link; `block` is the whole result (hovering anywhere in it shows the
 * chip). The generic part (a heading link inside the main column) keeps working when an engine renames its classes. */
const GENERIC='main a[href]:has(h2,h3),main h2 a[href],main h3 a[href],[role="main"] a[href]:has(h2,h3),[role="main"] h2 a[href],[role="main"] h3 a[href]';
const ENGINES=[
 {id:'google',host:/(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/,path:/^\/search$/,title:'#rso a[href]:has(h3),#botstuff a[href]:has(h3)',block:'#rso .MjjYud,#rso .g,#rso .tF2Cxc,#rso [data-hveid]'},
 {id:'bing',host:/(^|\.)bing\.com$/,path:/^\/search$/,title:'#b_results li.b_algo h2 a[href]',block:'#b_results li.b_algo'},
 {id:'duckduckgo',host:/^(html\.|lite\.)?duckduckgo\.com$/,path:/^\/(html\/?|lite\/?)?$/,title:'a[data-testid="result-title-a"],.result a.result__a',block:'article[data-testid="result"],li[data-layout="organic"],.result'},
 {id:'brave',host:/^search\.brave\.com$/,path:/^\/search$/,title:'#results .snippet[data-type="web"] a[href]:has(.title),#results .snippet a.heading-serpresult',block:'#results .snippet'},
 {id:'startpage',host:/^(www\.)?startpage\.com$/,path:/^\/(sp|do)\/search$|^\/search$/,title:'.result a.result-title,.result a.result-link,.w-gl__result a.w-gl__result-title',block:'.w-gl__result,.result'},
 {id:'ecosia',host:/^(www\.)?ecosia\.org$/,path:/^\/search$/,title:'a[data-test-id="result-link"],.result__title a[href],a.result__link',block:'[data-test-id="mainline-result-web"],article.result,.result'},
];
/** Which engine's result page an address is, or null. Local fixture pages (http://127.0.0.1/acira-serp/<engine>/…) are only
 * answered by the browser in an isolated test profile. Image results are not pages to preview. Pure. */
function engineOf(address){
 try{
  const url=new URL(address),fixture=url.protocol==='http:'&&url.hostname==='127.0.0.1'&&/^\/acira-serp\/([a-z]+)\//.exec(url.pathname);
  if(fixture){const engine=ENGINES.find(e=>e.id===fixture[1]);return engine?{...engine,fixture:true}:null;}
  if(url.protocol!=='https:')return null;
  const engine=ENGINES.find(e=>e.host.test(url.hostname)&&e.path.test(url.pathname));
  if(!engine||!url.searchParams.get('q')&&!url.searchParams.get('query'))return null;
  if(engine.id==='google'&&(url.searchParams.get('tbm')==='isch'||url.searchParams.get('udm')==='2'))return null;
  return engine;
 }catch{return null;}
}
const web=value=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&value.length<=4096?url.href:null;}catch{return null;}};
const base64url=text=>{try{const plain=text.replace(/-/g,'+').replace(/_/g,'/');return decodeURIComponent(escape(atob(plain+'='.repeat((4-plain.length%4)%4))));}catch{return null;}};
/** The page a result really goes to: the engines' own click-through addresses (Google /url?q=, Bing /ck/a?u=a1…, DuckDuckGo
 * /l/?uddg=) are opened at their destination, so the preview never visits the engine's redirect. Pure. */
function resultTarget(href,pageHost=''){
 const url=web(href);if(!url)return null;
 const u=new URL(url),host=u.hostname.replace(/^www\./,'');
 if(/(^|\.)google\.[a-z.]+$/.test(host)&&u.pathname==='/url')return web(u.searchParams.get('q')||u.searchParams.get('url')||'');
 if(/(^|\.)bing\.com$/.test(host)&&u.pathname==='/ck/a'){const v=u.searchParams.get('u')||'';return v.startsWith('a1')?web(base64url(v.slice(2))||''):null;}
 if(/(^|\.)duckduckgo\.com$/.test(host)&&u.pathname==='/l/')return web(u.searchParams.get('uddg')||'');
 // A link to the engine's own pages (more results, maps, settings) is not a result.
 const page=String(pageHost).replace(/^www\./,'');if(page&&(host===page||host.endsWith('.'+page)||page.endsWith('.'+host)))return null;
 return url;
}
const STYLE=`:host{all:initial;position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;contain:layout style}
:host{--glass:rgb(255 255 255/.86);--hover:rgb(244 245 247/.96);--line:rgb(0 0 0/.09);--ink:rgb(29 31 36/.90);--ring:#2563eb;--highlight:inset 0 1px 0 rgb(255 255 255/.7);
 --shadow:0 1px 2px rgb(0 0 0/.06),0 4px 12px -2px rgb(0 0 0/.10),0 12px 28px -12px rgb(0 0 0/.14)}
:host([data-dark]){--glass:rgb(40 40 44/.80);--hover:rgb(52 52 57/.92);--line:rgb(255 255 255/.12);--ink:rgb(237 237 239/.92);--ring:#6ea8ff;--highlight:inset 0 1px 0 rgb(255 255 255/.06);
 --shadow:0 0 0 1px rgb(0 0 0/.35),0 1px 2px rgb(0 0 0/.24),0 6px 16px -4px rgb(0 0 0/.36)}
button{all:unset;box-sizing:border-box;position:absolute;left:0;top:0;display:flex;align-items:center;gap:5px;height:24px;padding:0 9px 0 7px;border-radius:6px;
 font:500 12px/1 Geist,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;letter-spacing:.005em;white-space:nowrap;color:var(--ink);background:var(--glass);
 -webkit-backdrop-filter:blur(16px) saturate(1.4);backdrop-filter:blur(16px) saturate(1.4);box-shadow:0 0 0 1px var(--line),var(--highlight),var(--shadow);
 cursor:pointer;pointer-events:none;opacity:0;scale:.94;transform-origin:0 50%;
 transition:opacity calc(110ms*var(--m,1)) cubic-bezier(.2,0,0,1),scale calc(170ms*var(--m,1)) cubic-bezier(.23,1,.32,1),background-color 120ms cubic-bezier(.2,0,0,1)}
button.on{opacity:1;scale:1;pointer-events:auto}
button:hover{background:var(--hover)}
button:active{scale:.97}
button:focus-visible{outline:2px solid var(--ring);outline-offset:2px}
svg{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
@media (forced-colors:active){button{border:1px solid ButtonText;background:ButtonFace;color:ButtonText}}`;
// The Peek glyph: a card opening out of a page (the same frame-over-page idea as the Peek card), 16-unit grid.
const SVG='http://www.w3.org/2000/svg';
const icon=()=>{const svg=document.createElementNS(SVG,'svg');svg.setAttribute('viewBox','0 0 16 16');svg.setAttribute('aria-hidden','true');
 const rect=document.createElementNS(SVG,'rect');for(const [k,v] of [['x','2.25'],['y','3.25'],['width','11.5'],['height','9.5'],['rx','1.75']])rect.setAttribute(k,v);
 const lines=document.createElementNS(SVG,'path');lines.setAttribute('d','M5.5 6.25h5M5.5 8.75h3');svg.append(rect,lines);return svg;};
const luminance=color=>{const m=/rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?/.exec(color||'');if(!m||m[4]!==undefined&&Number(m[4])<.5)return null;return (.2126*m[1]+.7152*m[2]+.0722*m[3])/255;};

const engine=typeof window!=='undefined'&&window===window.top?engineOf(pageAddress()):null;
// Once per document, even if a session registered the script twice (the flag lives in this isolated world, not the page's).
if(engine&&!globalThis.__aciraSearchPreview){
 globalThis.__aciraSearchPreview=true;
 let allowed=false,on=false,words={preview:'Preview'},host=null,chip=null,current=null,hideTimer=0,frame=0,width=0,motion=1;
 const pageHost=(()=>{try{return new URL(pageAddress()).hostname;}catch{return '';}})();
 const dark=()=>{for(const node of [document.body,document.documentElement]){if(!node)continue;const value=luminance(getComputedStyle(node).backgroundColor);if(value!==null)return value<.45;}return matchMedia('(prefers-color-scheme: dark)').matches;};
 const titleOf=link=>link.querySelector('h3,h2,.title,[role="heading"]')||link;
 /** The title's text as laid out (a heading is as wide as the column; its words are not): the line boxes of its text. */
 const lines=node=>{try{const range=document.createRange();range.selectNodeContents(node);const list=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0);if(list.length)return list;}catch{}return [...node.getClientRects()].filter(r=>r.width>0&&r.height>0);};
 const union=list=>{const left=Math.min(...list.map(r=>r.left)),top=Math.min(...list.map(r=>r.top)),right=Math.max(...list.map(r=>r.right)),bottom=Math.max(...list.map(r=>r.bottom));return {left,top,right,bottom,width:right-left,height:bottom-top};};
 /** The result under a node: its title link, the whole result block, and where it goes. */
 function resultAt(node){
  if(!(node instanceof Element)||node===host)return null;
  // The nearest block that has a title (Google nests blocks: a sitelink row is one too).
  let block=node.closest(engine.block);while(block&&!block.querySelector(engine.title))block=block.parentElement?.closest(engine.block)||null;
  const link=block?.querySelector(engine.title)||node.closest(engine.title)||node.closest(GENERIC);
  if(!link||!(link instanceof HTMLAnchorElement))return null;
  const url=resultTarget(link.href,engine.fixture?'':pageHost);if(!url)return null;
  return {link,block:block||link,url,title:titleOf(link)};
 }
 function make(){
  if(host?.isConnected)return;
  host=document.createElement('acira-preview');const shadow=host.attachShadow({mode:'closed'});
  const style=document.createElement('style');style.textContent=STYLE;
  // Built node by node: result pages that enforce Trusted Types refuse innerHTML strings.
  chip=document.createElement('button');chip.type='button';chip.tabIndex=-1;chip.append(icon());const label=document.createElement('span');label.textContent=words.preview;chip.append(label);
  shadow.append(style,chip);width=0;host.style.setProperty('--m',String(motion));
  chip.addEventListener('click',event=>{if(!event.isTrusted||!current)return;event.preventDefault();event.stopPropagation();open(current);});
  chip.addEventListener('keydown',event=>{
   if(!current)return;
   if(event.key==='Escape'){event.preventDefault();const link=current.link;hide(true);link.focus({preventScroll:true});}
   // Tab moves on from the result as if the chip were right after its title; Shift+Tab goes back to the title.
   else if(event.key==='Tab'){const link=current.link;link.focus({preventScroll:true});if(event.shiftKey)event.preventDefault();}
  });
  chip.addEventListener('pointerenter',()=>clearTimeout(hideTimer));chip.addEventListener('pointerleave',event=>{if(!current?.block.contains(event.relatedTarget))later();});
  (document.documentElement||document).append(host);
 }
 /** Beside the end of the title's last line, centred on it; kept inside the window. */
 function place(){
  if(!current||!chip)return;
  if(!current.link.isConnected){hide(true);return;}
  const boxes=lines(current.title);if(!boxes.length){hide(true);return;}
  const bottom=Math.max(...boxes.map(r=>r.bottom)),last=union(boxes.filter(r=>r.bottom>bottom-r.height/2));
  width||=chip.offsetWidth||84;
  const x=Math.max(8,Math.min(innerWidth-width-8-(innerWidth-document.documentElement.clientWidth),last.right+8)),y=last.top+(last.height-24)/2;
  chip.style.translate=`${Math.round(x+scrollX)}px ${Math.round(y+scrollY)}px`;
 }
 function show(result){
  if(!allowed||!on)return;clearTimeout(hideTimer);make();
  if(dark())host.setAttribute('data-dark','');else host.removeAttribute('data-dark');
  const same=current?.link===result.link;current=result;
  chip.setAttribute('aria-label',`${words.preview}: ${(result.title.textContent||'').trim().slice(0,120)}`);
  if(!same&&chip.classList.contains('on')){chip.style.transition='none';place();void chip.offsetWidth;chip.style.transition='';}else place();
  chip.classList.add('on');
 }
 function hide(now=false){clearTimeout(hideTimer);if(!chip)return;if(!now&&chip.matches(':focus'))return;chip.classList.remove('on');current=null;}
 const later=()=>{clearTimeout(hideTimer);hideTimer=setTimeout(()=>hide(),160);};
 function open(result){
  const boxes=lines(result.title),box=boxes.length?union(boxes):result.title.getBoundingClientRect(),rect=box.width>0&&box.height>0?{x:Math.round(box.left),y:Math.round(box.top),width:Math.round(box.width),height:Math.round(box.height)}:undefined;
  ipcRenderer.send('acira:page-peek-link',{url:result.url,x:Math.round(box.left+box.width/2),y:Math.round(box.top+box.height/2),...(rect?{rect}:{})});
  // A preview returns to its source link. Do not leave keyboard focus on the hidden chip:
  // a later pointer hover would otherwise keep it pinned after the pointer leaves the result.
  if(chip?.matches(':focus'))result.link.focus({preventScroll:true});
  hide(true);
 }
 const options={capture:true,passive:true};
 document.addEventListener('pointerover',event=>{if(!allowed||!on||event.pointerType==='touch')return;if(host&&event.composedPath().includes(host)){clearTimeout(hideTimer);return;}const result=resultAt(event.target);if(result)show(result);else if(current)later();},options);
 document.addEventListener('pointerout',event=>{if(current&&!event.relatedTarget)later();},options);
 document.addEventListener('focusin',event=>{if(!allowed||!on||event.target===host)return;const result=event.target instanceof HTMLAnchorElement?resultAt(event.target):null;if(result&&result.link===event.target)show(result);},options);
 document.addEventListener('focusout',event=>{if(current&&event.target===current.link&&event.relatedTarget!==host)later();},options);
 // Tab from a result's title reaches its chip first.
 document.addEventListener('keydown',event=>{if(event.key==='Tab'&&!event.shiftKey&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&current&&event.target===current.link&&chip?.classList.contains('on')){event.preventDefault();chip.focus({preventScroll:true});}},{capture:true});
 const follow=()=>{if(!current||frame)return;frame=requestAnimationFrame(()=>{frame=0;place();});};
 addEventListener('scroll',follow,options);addEventListener('resize',follow,{passive:true});
 addEventListener('pagehide',()=>{hide(true);host?.remove();host=null;chip=null;});
 ipcRenderer.on('acira:link-preview',(_event,value)=>{on=value?.on!==false;if(!on)hide(true);});
 ipcRenderer.invoke('acira:search-preview',{fixture:engine.fixture===true}).then(answer=>{
  allowed=answer?.allowed===true;on=answer?.on!==false;if(typeof answer?.labels?.preview==='string'&&answer.labels.preview)words={preview:answer.labels.preview};
  // Premium, Fast or Off, as everywhere in Acira (R3-17); Off and reduced motion show and hide the chip at once.
  motion=answer?.speed==='off'?0:answer?.speed==='fast'?1:1.7;host?.style.setProperty('--m',String(motion));
 },()=>{allowed=false;});
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={engineOf,resultTarget,ENGINES,GENERIC};
