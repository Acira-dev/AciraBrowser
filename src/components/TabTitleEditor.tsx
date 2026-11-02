import { useEffect,useLayoutEffect,useRef,useState,type CSSProperties,type ReactNode,type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { renameOutcome,TAB_NAME_MAX } from '../runtime/tabTitle';
import type { BrowserAction,TabSession } from '../runtime/types';
import '../styles/tab-rename.css';

import { t } from '../i18n';
/** Inline tab rename (Zen idea 10). The name lives on the tab (`customTitle`), so it survives restarts and shows in the
 * strip, the sidebar, the tab viewer and the hover card. One field: Enter saves, Esc cancels, empty puts the page's own
 * title back, and leaving the field saves (as in the Windows and macOS file managers). */

export const TAB_RENAME_EVENT='acira-tab-rename';

/** A tab as the strip or the sidebar draws it: its title may already be the custom name, so the page's own title rides along. */
export type ShownTab=TabSession&{pageTitle?:string};
const pageTitleOf=(tab:ShownTab)=>tab.pageTitle??tab.title;

/** Opens the rename field on the tab, wherever it is drawn (the strip or the sidebar). False when no row on screen can take it. */
export function requestTabRename(tabId:string):boolean{
 for(const node of document.querySelectorAll<HTMLElement>(`[data-tab-id="${CSS.escape(tabId)}"]`)){
  if(node.closest('[inert]')||!node.getClientRects().length)continue;
  const detail={handled:false};node.dispatchEvent(new CustomEvent(TAB_RENAME_EVENT,{detail}));
  if(detail.handled)return true;
 }
 return false;
}

/** Where a row's rename field is open: `inline` in place of its title, or `floating` over the tab when its title is not on
 * screen (a pinned or icon-only strip tab). `ref` is the title (or the row): the row is the nearest `data-tab-id`. */
export function useTabRename(ref:RefObject<HTMLElement|null>){
 const [mode,setMode]=useState<'inline'|'floating'|null>(null);
 useEffect(()=>{
  const node=ref.current?.closest<HTMLElement>('[data-tab-id]');if(!node)return;
  const open=(event:Event)=>{(event as CustomEvent<{handled:boolean}>).detail.handled=true;setMode(ref.current?.getClientRects().length?'inline':'floating');};
  node.addEventListener(TAB_RENAME_EVENT,open);return()=>node.removeEventListener(TAB_RENAME_EVENT,open);
 },[ref]);
 return [mode,setMode] as const;
}

/** The field itself. `onDone` runs once, however it ends. */
export function TabNameInput({tab,dispatch,onDone,className='',style}:{tab:ShownTab;dispatch:(action:BrowserAction)=>void;onDone:(saved:boolean)=>void;className?:string;style?:CSSProperties}){
 const input=useRef<HTMLInputElement>(null),done=useRef(false),page=pageTitleOf(tab);
 const [value,setValue]=useState(tab.customTitle||tab.title);
 useLayoutEffect(()=>{input.current?.focus({preventScroll:true});input.current?.select();},[]);
 const finish=(save:boolean)=>{
  if(done.current)return;done.current=true;
  const outcome=save?renameOutcome({title:page,customTitle:tab.customTitle},value):null;
  if(outcome!==null)dispatch({type:'tab.rename',id:tab.id,title:outcome});
  onDone(outcome!==null);
 };
 return <input ref={input} style={style} className={`tab-name-input ${className}`.trim()} aria-label={t('tabrename.fieldLabel')} placeholder={page} value={value} maxLength={TAB_NAME_MAX} spellCheck={false} autoComplete="off"
  onChange={event=>setValue(event.target.value)} onBlur={()=>finish(true)}
  onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()} onContextMenu={event=>event.stopPropagation()}
  onKeyDown={event=>{
   event.stopPropagation();if(event.nativeEvent.isComposing)return;
   if(event.key==='Enter'){event.preventDefault();finish(true);}
   else if(event.key==='Escape'){event.preventDefault();finish(false);}
  }}/>;
}

/** The strip's title (`.tab-title`). Double-click it, press F2 on the tab, or choose Rename tab to edit it in place. A tab
 * with no title on screen (pinned, or too narrow) renders this as an empty anchor and edits in a field over the tab. */
export function TabTitle({tab,dispatch,className,children}:{tab:ShownTab;dispatch:(action:BrowserAction)=>void;className:string;children?:ReactNode}){
 const ref=useRef<HTMLSpanElement>(null),[mode,setMode]=useTabRename(ref);
 const [box,setBox]=useState<DOMRect|null>(null);
 const done=()=>{setMode(null);setBox(null);requestAnimationFrame(()=>ref.current?.closest<HTMLElement>('[data-tab-id]')?.focus({preventScroll:true}));};
 useLayoutEffect(()=>{if(mode==='floating')setBox(ref.current?.closest<HTMLElement>('[data-tab-id]')?.getBoundingClientRect()??null);},[mode]);
 if(mode==='inline')return <span ref={ref} className={`${className} tab-title-editing`}><TabNameInput tab={tab} dispatch={dispatch} onDone={done}/></span>;
 const width=Math.min(240,Math.max(180,innerWidth-16)),left=box?Math.max(8,Math.min(innerWidth-width-8,box.left+box.width/2-width/2)):0;
 return <span ref={ref} className={className} onDoubleClick={event=>{event.preventDefault();event.stopPropagation();setMode(ref.current?.getClientRects().length?'inline':'floating');}}>{children}
  {mode==='floating'&&box&&createPortal(<TabNameInput tab={tab} dispatch={dispatch} onDone={done} className="tab-name-floating" style={{left,top:box.top+(box.height-28)/2,width}}/>,document.querySelector<HTMLElement>('.app')??document.body)}</span>;
}
