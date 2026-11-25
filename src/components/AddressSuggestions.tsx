import { motion } from 'motion/react';
import { Fragment,useRef,type ReactNode } from 'react';
import type { AddressSuggestion } from '../ui/addressSuggestions';
import { suggestionChoices,motionIdOf,rowClickSwitchesTab,rowTopIn,groupStart,suggestionSite,readAlike,suggestionsListHeight,GROUP_HEIGHT,ROW_HEIGHT } from '../ui/suggestionRows';
import { useStoredSiteIcons } from '../ui/suggestionIcons';
import { useSuggestionMotion } from '../ui/suggestionMotion';
import './AddressSuggestions.css';
import { Equal,Command as CommandGlyph } from 'lucide-react';
import { Return,Search } from './AppIcons';
import { PreviewIcon } from './PreviewIcon';
import { SiteIdentityIcon } from './SiteIdentityIcon';

import { t } from '../i18n';

/* The row glyphs are the approved sample's own drawings, value for value (item17 AddressSuggestions.tsx; EXACT SAMPLE PARITY, 14 Nov): line-draw on the 16 grid,
   stroke 1.25, round caps and joins, the clock's ring with pathLength 1 and its two hands as the parts the CSS morph (AddressSuggestions.css, .sug-morph) winds into the x. */
const Svg = ({ children, className }: { children: ReactNode; className?: string }) => <svg className={className ? `${className} sug-glyph` : 'sug-glyph'} viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
/** History clock. With `morph`, hovering it turns it into the x: the ring un-draws and the two hands swing out into the two strokes of the x. */
const ClockGlyph = ({ morph = false }: { morph?: boolean }) => <Svg className={morph ? 'sug-clock sug-morph' : 'sug-clock'}><path className="r" pathLength={1} d="M8 2.25a5.75 5.75 0 1 1 0 11.5a5.75 5.75 0 1 1 0-11.5"/><path className="h1" d="M8 8L8 4.75"/><path className="h2" d="M8 8L10.25 9.5"/></Svg>;
const StarGlyph = () => <Svg><path d="M8 2.6l1.64 3.32 3.66.53-2.65 2.58.63 3.65L8 10.96l-3.28 1.72.63-3.65L2.7 6.45l3.66-.53z"/></Svg>;
const TabGlyph = () => <Svg><rect x="2.5" y="3.5" width="11" height="9" rx="1.75"/><path d="M2.5 6.5h11"/></Svg>;
const ArrowGlyph = () => <Svg><path d="M6 4.75h5.25V10M11.25 4.75 4.75 11.25"/></Svg>;
/** The popup's height for these rows: their slots and the list's padding. */
export const addressSuggestionsHeight=(items:number|readonly AddressSuggestion[])=>suggestionsListHeight(items);
function Match({text,query}:{text:string;query:string}){
 const match=query.trim(),index=match?text.toLocaleLowerCase().indexOf(match.toLocaleLowerCase()):-1;
 return index<0?<>{text}</>:<>{text.slice(0,index)}<strong className="sug-match">{text.slice(index,index+match.length)}</strong>{text.slice(index+match.length)}</>;
}
/** The row's leading picture: the site's own icon (the one Acira keeps on this computer, else its built-in mark, else the globe), or the mark of what the row is. */
function Lead({item,iconOf}:{item:AddressSuggestion;iconOf:(url:string)=>string|undefined}){
 return item.kind==='search'||item.kind==='suggestion'?<Search size={16}/>:item.kind==='answer'?<PreviewIcon icon={Equal}/>:item.kind==='command'?<PreviewIcon icon={CommandGlyph}/>:<SiteIdentityIcon url={item.url} favicon={iconOf(item.url)} size={16}/>;
}

/** The address field keeps keyboard focus; this list is also safe in a trusted native overlay. */
export function AddressSuggestions({items,activeIndex,query,onActiveIndexChange,onChoose,onRemove,reducedMotion,speed,listId='address-suggestions',iconScope=''}:{
 items:AddressSuggestion[];activeIndex:number;query:string;onActiveIndexChange:(index:number)=>void;onChoose:(item:AddressSuggestion,switchToTab?:boolean)=>void;
 onRemove:(id:string)=>void;reducedMotion:boolean;speed:number;listId?:string;/** the active profile's id: whose stored site icons the rows may wear */iconScope?:string;
}){
 const pointer=useRef<{x:number;y:number}|null>(null),list=useRef<HTMLUListElement|null>(null),duration=reducedMotion?0:.18/Math.max(.5,speed);
 const alike=readAlike(items),choices=suggestionChoices(),iconOf=useStoredSiteIcons(iconScope),start=groupStart(items),total=Math.max(1,items.length)*ROW_HEIGHT+(start>=0?GROUP_HEIGHT:0),selected=activeIndex>=0&&activeIndex<items.length;
 useSuggestionMotion(list,[...items.map((item,index)=>({id:motionIdOf(item),top:rowTopIn(items,index)})),...start>=0?[{id:'group:engine',top:start*ROW_HEIGHT}]:[]],{reduced:reducedMotion,speed});
 const removable=(item:AddressSuggestion)=>item.kind==='history'&&!!item.historyId;
 /** What a row is, for a screen reader: the types no longer print a word (13.6 dropped "From your history"; Beta 14 drops "Bookmark" and "Switch to tab" too). */
 const reading=(item:AddressSuggestion)=>item.kind==='history'||item.kind==='bookmark'||item.kind==='tab'||item.kind==='suggestion'?<span className="address-suggestions-a11y">{item.kind==='suggestion'?t('searchsuggest.fromService',{name:item.detail}):item.detail}</span>:null;
 const row=(item:AddressSuggestion,index:number)=>{
  const site=suggestionSite(item,alike.has(item.id));
  // The type is one quiet icon at the row's end. The history clock is also the remove button: under the pointer it turns into the x.
  const end=item.kind==='command'&&item.keys?<kbd className="sug-keys">{item.keys}</kbd>
   :removable(item)?<button type="button" className="sug-end sug-end-button" tabIndex={-1} aria-label={t("addresssuggestions.removeTitleFromHistory", { title: item.title })} title={t("addresssuggestions.removeFromHistoryShiftDelete")} onClick={event=>{event.stopPropagation();if(item.historyId)onRemove(item.historyId);}}><ClockGlyph morph/></button>
   :item.kind==='history'?<span className="sug-end"><ClockGlyph/></span>
   :item.kind==='bookmark'?<span className="sug-end" title={t('addresssuggestions.bookmark')}><StarGlyph/></span>
   :item.kind==='tab'?<button type="button" className="sug-end sug-end-button" aria-label={t("addresssuggestions.switchToExistingTabTitle", { title: item.title })} title={t("addresssuggestions.switchToThisTabShift")} aria-keyshortcuts="Shift+Enter" onClick={event=>{event.stopPropagation();onChoose(item,true);}}><span className="sug-swap"><TabGlyph/><ArrowGlyph/></span></button>
   :<span className="sug-end sug-enter"><Return size={16} aria-hidden="true" className="sug-glyph"/></span>;
  return <li key={item.id} className="address-suggestion" id={`${listId}-${index}`} role="option" aria-selected={index===activeIndex} data-row-id={motionIdOf(item)} data-k={item.kind} style={{height:ROW_HEIGHT}}
   onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()/* the field keeps focus, its draft and the open list */}
   onPointerMove={event=>{const previous=pointer.current;pointer.current={x:event.clientX,y:event.clientY};if(!previous||previous.x!==event.clientX||previous.y!==event.clientY)onActiveIndexChange(index);}}
   onClick={()=>onChoose(item,rowClickSwitchesTab(item,choices))}>
   <span className="address-suggestion-icon"><Lead item={item} iconOf={iconOf}/></span>
   <span className="sug-line"><span className="sug-title" dir="auto"><Match text={item.title} query={query}/></span>{site&&<span className="sug-site" dir="auto">{site}</span>}</span>{reading(item)}{end}
  </li>;
 };
 return <div className="address-suggestions" data-reduced={reducedMotion||undefined} onPointerLeave={()=>{pointer.current=null;}}>
  <motion.ul ref={list} id={listId} role="listbox" aria-label={t("app.addressSuggestions")} initial={false} animate={{height:total}} transition={{duration,ease:[.16,1,.3,1]}}>
   {selected&&<motion.li aria-hidden="true" data-motion-skip className="address-suggestion-selection" initial={false} animate={{y:rowTopIn(items,activeIndex),height:ROW_HEIGHT}} transition={{duration:reducedMotion?0:.14/Math.max(.5,speed),ease:[.16,1,.3,1]}}/>}
   {items.map((item,index)=>index===start?<Fragment key={item.id}><li aria-hidden="true" className="address-suggestion-group" data-row-id="group:engine" style={{height:GROUP_HEIGHT}}><span className="address-suggestion-group-label" dir="auto">{t('searchsuggest.groupLabel',{name:item.detail})}</span></li>{row(item,index)}</Fragment>:row(item,index))}
   {!items.length&&<li className="address-suggestion-empty">{t("addresssuggestions.enterAWebsiteOrSearch")}</li>}
  </motion.ul>
 </div>;
}
