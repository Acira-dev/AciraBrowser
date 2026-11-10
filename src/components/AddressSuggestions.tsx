import { motion } from 'motion/react';
import { useRef } from 'react';
import { useListMotion } from '../ui/sharedMotion';
import type { AddressSuggestion } from '../ui/addressSuggestions';
import { addressDisplayUrl } from '../ui/addressSuggestions';
import './AddressSuggestions.css';
import { Equal,Command as CommandGlyph } from 'lucide-react';
import { Return,Search,X } from './AppIcons';
import { PreviewIcon } from './PreviewIcon';
import { SiteIdentityIcon } from './SiteIdentityIcon';

import { t } from '../i18n';
export const ADDRESS_SUGGESTION_ROW_HEIGHT=44;
export const addressSuggestionsHeight=(count:number)=>8+Math.max(1,count)*ADDRESS_SUGGESTION_ROW_HEIGHT;
function Match({text,query}:{text:string;query:string}){
 const match=query.trim(),index=match?text.toLocaleLowerCase().indexOf(match.toLocaleLowerCase()):-1;
 return index<0?<>{text}</>:<>{text.slice(0,index)}<strong>{text.slice(index,index+match.length)}</strong>{text.slice(index+match.length)}</>;
}

/** The address field keeps keyboard focus; this list is also safe in a trusted native overlay. */
export function AddressSuggestions({items,activeIndex,query,onActiveIndexChange,onChoose,onRemove,reducedMotion,speed,listId='address-suggestions'}:{
 items:AddressSuggestion[];activeIndex:number;query:string;onActiveIndexChange:(index:number)=>void;onChoose:(item:AddressSuggestion,switchToTab?:boolean)=>void;
 onRemove:(id:string)=>void;reducedMotion:boolean;speed:number;listId?:string;
}){
 const pointer=useRef<{x:number;y:number}|null>(null),list=useRef<HTMLUListElement|null>(null),duration=reducedMotion?0:.18/Math.max(.5,speed);
 // A's list motion (one system for every filtering list): rows that stay glide, new ones settle in, gone ones fade out.
 useListMotion(list,items.map(item=>item.id).join('|'),{frequent:true});
 return <div className="address-suggestions" onPointerLeave={()=>{pointer.current=null;}}>
  <motion.ul ref={list} id={listId} role="listbox" aria-label={t("app.addressSuggestions")} initial={false} animate={{height:Math.max(1,items.length)*ADDRESS_SUGGESTION_ROW_HEIGHT}} transition={{duration,ease:[.16,1,.3,1]}}>
   {activeIndex>=0&&activeIndex<items.length&&<motion.li aria-hidden="true" data-motion-skip className="address-suggestion-selection" initial={false} animate={{y:activeIndex*ADDRESS_SUGGESTION_ROW_HEIGHT}} transition={{duration:reducedMotion?0:.14/Math.max(.5,speed),ease:[.16,1,.3,1]}}/>}
   {items.map((item,index)=><li key={item.id} id={`${listId}-${index}`} className="address-suggestion" data-removable={item.kind==='history'&&item.historyId?'':undefined} data-kind={item.kind==="answer"||item.kind==="command"?item.kind:undefined} role="option" aria-selected={index===activeIndex}
     onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()/* the field keeps focus, its draft and the open list */} onPointerMove={event=>{const previous=pointer.current;pointer.current={x:event.clientX,y:event.clientY};if(!previous||previous.x!==event.clientX||previous.y!==event.clientY)onActiveIndexChange(index);}}
     onClick={()=>onChoose(item)}>
     <span className="address-suggestion-icon">{item.kind==='search'?<Search size={16}/>:item.kind==='answer'?<PreviewIcon icon={Equal}/>:item.kind==='command'?<PreviewIcon icon={CommandGlyph}/>:<SiteIdentityIcon url={item.url} size={16}/>}</span>
     <span className="address-suggestion-copy"><span dir="auto"><Match text={item.title} query={query}/></span><small dir="auto">{item.kind==='search'||item.kind==='answer'?item.detail:item.kind==='command'?t('addresssuggestions.command'):addressDisplayUrl(item.url)}</small></span>{item.kind==='command'&&item.keys&&<span className="address-suggestion-key">{item.keys}</span>}
     {item.kind==='tab'?<button type="button" className="address-suggestion-action" aria-label={t("addresssuggestions.switchToExistingTabTitle", { title: item.title })} title={t("addresssuggestions.switchToThisTabShift")} aria-keyshortcuts="Shift+Enter" onClick={event=>{event.stopPropagation();onChoose(item,true);}}>{t("addresssuggestions.switchToTab")}</button>:item.kind==='history'?<span className="address-suggestions-a11y">{item.detail}</span>/* 13.6: a history row no longer prints "From your history" beside its title (it took the room the title needed); a screen reader still hears it */:<span className="address-suggestion-source">{item.kind==='search'||item.kind==='answer'||item.kind==='command'?'':item.detail}</span>}
     {item.kind==='history'&&item.historyId?<button type="button" className="address-suggestion-remove" tabIndex={-1} aria-label={t("addresssuggestions.removeTitleFromHistory", { title: item.title })} title={t("addresssuggestions.removeFromHistoryShiftDelete")} onClick={event=>{event.stopPropagation();if(item.historyId)onRemove(item.historyId);}}><X size={15} aria-hidden="true"/></button>:<Return className="address-suggestion-enter" size={16} aria-hidden="true"/>}
    </li>)}
   {!items.length&&<li className="address-suggestion-empty">{t("addresssuggestions.enterAWebsiteOrSearch")}</li>}
  </motion.ul>
 </div>;
}
