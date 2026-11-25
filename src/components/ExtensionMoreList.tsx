import {useMemo} from 'react';
import '../styles/extension-more.css';
import {peekMoreTarget,type MoreRow,type MoreTarget} from '../ui/extensionMoreTarget';
import {bridge} from '../ui/extensionButtonList';
import {t} from '../i18n';

/** The engine's icon of an extension for a page (the address its own buttons use: electron-chrome-extensions browser-action.js `updateIcon`). */
export const iconAddress=(id:string,partition:string,tab:number):string=>`crx://extension-icon/${id}/32/2?${new URLSearchParams({tabId:String(tab),partition})}`;

const DEFAULT_BADGE='#666';
/** Runs an extension as its button would: the engine's own activation (the click opens its popup, the right click gives its menu), from the "more" button's box, then the list closes. */
export function runExtension(target:MoreTarget,row:MoreRow,eventType:'click'|'contextmenu',close:()=>void):void{
 void bridge()?.activate(target.partition,{eventType,extensionId:row.id,tabId:target.tab,alignment:'bottom right',anchorRect:target.anchor});
 close();
}
/**
 * Beta 14: the extensions that do not fit the sidebar row's one line, as a list: each with its icon, its name and its badge. A click runs it exactly as its button would (the
 * engine's own `activate`, with the "more" button's box as the anchor: its popup opens from where the list was); a right click gives the same menu as the button (Unpin, Manage...).
 * Drawn in the popup layer like Acira's other menus (its rows are the menu rows), the content of the `extension-more` popup (App.tsx).
 */
export function ExtensionMoreList({close,target=peekMoreTarget()}:{close:()=>void;target?:MoreTarget|null}){
 const rows=useMemo(()=>target?.rows??[],[target]);
 if(!target||!rows.length)return <div className="extension-more-empty" role="status">{t('browserextensionactions.moreExtensions')}</div>;
 const run=(row:MoreRow,eventType:'click'|'contextmenu')=>runExtension(target,row,eventType,close);
 return <div className="extension-more-list" role="menu" aria-label={t('browserextensionactions.moreExtensions')}>{rows.map(row=>
  <button key={row.id} type="button" role="menuitem" className="menu-row extension-more-row" data-extension-id={row.id} aria-disabled={row.enabled?undefined:true} title={row.title}
   onClick={()=>run(row,'click')} onContextMenu={event=>{event.preventDefault();run(row,'contextmenu');}}>
   <img className="menu-ext-icon" src={iconAddress(row.id,target.partition,target.tab)} alt="" width={16} height={16} draggable={false}/>
   <span className="extension-more-name">{row.title}</span>
   {row.text&&<small className="extension-more-badge" style={{color:row.textColor||'#fff',backgroundColor:row.color&&row.color!=='rgba(0, 0, 0, 0)'?row.color:DEFAULT_BADGE}}>{row.text}</small>}
  </button>)}</div>;
}
