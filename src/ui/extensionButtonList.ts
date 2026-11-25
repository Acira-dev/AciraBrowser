/**
 * The extension buttons of one place (the toolbar, the sidebar's row, the manager): the engine's own <browser-action-list> (electron-chrome-extensions) and the dressing Acira
 * puts over its buttons.
 *
 * The engine's list fills itself in steps, none of them in the frame that creates it: it asks the main process for its state (an IPC round trip), adds one button per extension,
 * and each button loads its icon on the next frame from a protocol served by the main process (crx://extension-icon). A list built from nothing is therefore empty, then a row of
 * blank buttons, then icons one by one; with a busy main process (a heavy page, many extensions) that took 30 to 120 ms. The interface used to build a new list at every mount of the
 * row and at every change of the active tab, so each tab switch blinked the icons, and a sidebar that was revealed mounted its row empty in the very frame the slide's new picture
 * is taken: the tab list sat 35 to 70 px too high, then jumped down while icons popped in over the slide (Beta 14 item AD1, "icons that do not move with the sidebar").
 *
 * Here a list is built once and lives on: a change of tab or of the pinned list is applied to the list that is there (its `tab` attribute, which the engine follows by itself,
 * and which buttons show, in which order), and a place that comes and goes (the sidebar's row: the whole sidebar is replaced by an empty column while it is hidden) names itself
 * (`keepAs`), so its list is taken off the page when the place goes and put back, with its buttons and their icons, when the place comes back, in the same commit.
 */
import type {MoreRow} from './extensionMoreTarget';
import {motionSpeed} from './sharedMotion';
import {linePace} from './lineMotion';
export interface ActionState{id:string;title?:string;text?:string;color?:string;textColor?:string;enabled?:boolean;tabs?:Record<string,{title?:string;text?:string;enabled?:boolean;color?:string;textColor?:string}>}
/** The engine's toolbar bridge (electron-chrome-extensions/browser-action), exposed to the interface by the preload. */
export interface ActionBridge{getAction(id:string):ActionState|undefined;addEventListener(name:string,listener:()=>void):void;removeEventListener(name:string,listener:()=>void):void;activate(partition:string,details:Record<string,unknown>):Promise<unknown>}
export const bridge=():ActionBridge|undefined=>(window as unknown as {browserAction?:ActionBridge}).browserAction;
const DEFAULT_BADGE='#666';
/** Lists of places that come and go, at most this many (a place and a partition each: the profiles of the window and the private session). */
const MAX_KEPT=8;

/** What the list shows: the page it is for (the engine's `tab` attribute, a webContents id), which buttons, and in which order. */
export interface ButtonWish{tab:number;pinned:ReadonlySet<string>;rank:ReadonlyMap<string,string>}
export interface ButtonList{
 /** The page, the pinned list or the order changed: applied to the list that is there. */
 wish(next:ButtonWish):void;
 /** The place does not want its buttons any more: a list of a named place is taken off the page and kept, any other is dropped. */
 release():void;
}
interface Entry{
 key:string|null;partition:string;list:HTMLElement|null;observer:MutationObserver|null;wish:ButtonWish|null;frame:number;
 /** The handle that has the list now; a handle that is not the owner (its place was taken over) changes nothing. */
 owner:object|null;subscribed:boolean;sync:()=>void;dress:()=>void;later:()=>void;
}
const entries=new Map<string,Entry>();
/** Whether each button was shown by the last sync: only a change from hidden to shown plays the fade. */
const shownBefore=new WeakMap<Element,boolean>();
function fadeIn(button:HTMLElement):void{
 const pace=linePace(motionSpeed());
 if(!pace||typeof button.animate!=='function')return;
 button.animate([{opacity:0},{opacity:1}],{duration:150*pace,easing:'ease-out'});
}

function makeEntry(key:string|null,partition:string):Entry{
 const entry:Entry={key,partition,list:null,observer:null,wish:null,frame:0,owner:null,subscribed:false,
  // The engine adds the buttons in the order its extensions first spoke, which races: the buttons follow the list's order (the order they were added).
  sync(){
   const wish=entry.wish;
   for(const button of entry.list?.shadowRoot?.querySelectorAll<HTMLButtonElement>('button.action')||[]){
    const visible=Boolean(wish?.pinned.has(button.id)),display=visible?'':'none',order=wish?.rank.get(button.id)??'',before=shownBefore.get(button);
    shownBefore.set(button,visible);
    if(button.hidden===visible)button.hidden=!visible;if(button.style.display!==display)button.style.display=display;
    // A button that comes back from the "more" list (the sidebar was widened) fades in; one that goes behind it simply makes room for the "more" button, which fades in at its place.
    if(visible&&before===false)fadeIn(button);
    if(button.style.order!==order)button.style.order=order;
   }
   entry.dress();
  },
  // The engine's button draws a badge in white on the extension's colour and knows nothing of a disabled action (action.disable) or a text colour
  // (action.setBadgeTextColor): the state it receives carries them, the buttons are dressed here. Values are written only when they differ.
  dress(){
   const put=(element:HTMLElement,property:'color'|'backgroundColor'|'opacity'|'filter'|'cursor',value:string)=>{if(element.style[property]!==value)element.style[property]=value;};
   const tabKey=String(entry.wish?.tab??'');
   for(const button of entry.list?.shadowRoot?.querySelectorAll<HTMLButtonElement>('button.action')||[]){
    const own=bridge()?.getAction(button.id)?.tabs?.[tabKey],disabled=own?.enabled===false;
    put(button,'opacity',disabled?'.4':'');put(button,'filter',disabled?'grayscale(1)':'');put(button,'cursor',disabled?'default':'');
    if(disabled)button.setAttribute('aria-disabled','true');else button.removeAttribute('aria-disabled');
    const badge=button.querySelector<HTMLElement>('.badge');
    if(badge){put(badge,'color',own?.textColor||'#fff');put(badge,'backgroundColor',own?.color&&own.color!=='rgba(0, 0, 0, 0)'?own.color:DEFAULT_BADGE);}
   }
  },
  later(){cancelAnimationFrame(entry.frame);entry.frame=requestAnimationFrame(()=>{entry.frame=requestAnimationFrame(entry.dress);});},
 };
 return entry;
}

function build(entry:Entry):HTMLElement{
 const list=document.createElement('browser-action-list');
 list.setAttribute('partition',entry.partition);list.setAttribute('alignment','bottom right');
 entry.list=list;
 const root=list.shadowRoot;
 if(root){entry.observer=new MutationObserver(entry.sync);entry.observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class']});}
 return list;
}

function place(entry:Entry,host:HTMLElement):void{
 const list=entry.list||build(entry),tab=String(entry.wish!.tab);
 // The tab is set before the list is on the page: the engine asks for its state once, for the right page.
 if(list.getAttribute('tab')!==tab)list.setAttribute('tab',tab);
 if(list.parentNode!==host)host.prepend(list);   // first: what the component draws after the list (the "more" button) stays after it
 entry.sync();
 if(!entry.subscribed){bridge()?.addEventListener('update',entry.later);entry.subscribed=true;}
}

function stop(entry:Entry):void{
 cancelAnimationFrame(entry.frame);entry.frame=0;
 if(entry.subscribed){bridge()?.removeEventListener('update',entry.later);entry.subscribed=false;}
 entry.list?.remove();
}

function dispose(entry:Entry):void{
 stop(entry);
 entry.observer?.disconnect();entry.observer=null;entry.list=null;
 if(entry.key&&entries.get(entry.key)===entry)entries.delete(entry.key);
}

/** Names of the lists that are kept, for tests and for the one place that forgets them (a profile that went away). */
export function keptButtonLists():string[]{return [...entries.keys()];}
export function forgetButtonLists():void{for(const entry of [...entries.values()])if(!entry.owner)dispose(entry);}

/**
 * Puts the buttons of `partition` into `host`. The element is made and put there at once when the engine's element is defined (the interface's preload defines it before the first
 * paint); in the one case it is not yet, the list follows when it is.
 */
export function openButtonList(options:{host:HTMLElement;partition:string;/** The place's name when the place comes and goes: its list is kept while the place is away. */keepAs?:string;wish:ButtonWish}):ButtonList{
 const key=options.keepAs?`${options.keepAs}|${options.partition}`:null;
 let entry=key?entries.get(key):undefined;
 if(!entry){entry=makeEntry(key,options.partition);if(key){entries.set(key,entry);for(const old of [...entries.values()]){if(entries.size<=MAX_KEPT)break;if(old!==entry&&!old.owner)dispose(old);}}}
 const mine=entry,token={};
 // A list taken over from a place that has not let go yet (two copies of one place in a commit): the old owner's release does nothing.
 mine.owner=token;mine.wish=options.wish;
 let waiting=false;
 const put=()=>{waiting=false;if(mine.owner===token)place(mine,options.host);};
 if(customElements.get('browser-action-list'))put();
 else{waiting=true;void customElements.whenDefined('browser-action-list').then(()=>{if(waiting)put();});}
 return {
  wish(next){if(mine.owner!==token)return;mine.wish=next;if(customElements.get('browser-action-list'))put();},
  release(){
   waiting=false;
   if(mine.owner!==token)return;
   mine.owner=null;
   if(mine.key)stop(mine);else dispose(mine);
  },
 };
}

/** What the "more" list shows of each extension behind it: the engine's state for the page (the per-page values over the extension's own), the way its button reads it. */
export function moreRows(ids:readonly string[],tab:number):MoreRow[]{
 return ids.map(id=>{
  const action=bridge()?.getAction(id),own=action?.tabs?.[String(tab)],info={...own,...action};
  return {id,title:typeof info.title==='string'&&info.title?info.title:id,text:typeof info.text==='string'?info.text:'',color:typeof info.color==='string'?info.color:'',textColor:typeof own?.textColor==='string'?own.textColor:typeof info.textColor==='string'?info.textColor:'',enabled:own?.enabled!==false};
 });
}
