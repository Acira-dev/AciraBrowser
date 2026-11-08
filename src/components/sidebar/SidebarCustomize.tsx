import { useRef,useState,type KeyboardEvent,type PointerEvent } from 'react';
import { MOVABLE_SECTIONS,SECTION_NAMES,moveSection,sectionShown,toggleSection,type SectionId,type SectionLayout } from '../../ui/sidebarSections';

import { t } from '../../i18n';
/** Customize sidebar (Round 2): every section as a card with a switch; the movable ones drag by their card (or move
 * with Alt+Up/Down). Changes apply as you make them; the cards slide with the sidebar's FLIP (data-flip). */
export function SidebarCustomize({layout,onChange,onDone,favoritesPlace='top'}:{layout:SectionLayout;onChange:(next:SectionLayout)=>void;onDone:()=>void;/** Where the Favorites tiles sit (Settings > Tabs > Sidebar), for the card's caption. */favoritesPlace?:'top'|'bottom'}){
 const list=useRef<HTMLDivElement>(null),[dragging,setDragging]=useState<SectionId|null>(null);
 const latest=useRef(layout);latest.current=layout;
 const indexAt=(id:SectionId,y:number)=>{
  const box=list.current;if(!box)return -1;const top=box.getBoundingClientRect().top;
  // Layout positions (offsetTop), not painted ones: cards that are still sliding must not shuffle the target.
  return [...box.querySelectorAll<HTMLElement>('[data-section-move]')].filter(card=>card.dataset.sectionMove!==id&&card.offsetTop+card.offsetHeight/2<y-top).length;
 };
 const grab=(event:PointerEvent<HTMLDivElement>,id:SectionId)=>{
  if(event.button!==0||(event.target as HTMLElement).closest('button'))return;
  event.preventDefault();setDragging(id);
  const move=(next:globalThis.PointerEvent)=>{const moved=moveSection(latest.current,id,indexAt(id,next.clientY));if(moved!==latest.current)onChange(moved);};
  const end=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',end);window.removeEventListener('pointercancel',end);setDragging(null);};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',end);window.addEventListener('pointercancel',end);
 };
 const keys=(event:KeyboardEvent<HTMLDivElement>,id:SectionId)=>{
  if(!event.altKey||event.key!=='ArrowUp'&&event.key!=='ArrowDown')return;
  event.preventDefault();const at=layout.order.indexOf(id);onChange(moveSection(layout,id,at+(event.key==='ArrowUp'?-1:1)));
 };
 const card=(id:SectionId,movable:boolean)=>{const shown=sectionShown(layout,id),label=`sb-custom-${id}`;
  return <div key={id} className="sb-custom-card" data-flip={'cs:'+id} data-section-move={movable?id:undefined} data-dragging={dragging===id||undefined} data-off={!shown||undefined}
   tabIndex={movable?0:undefined} aria-label={movable?`${SECTION_NAMES[id]}. Alt+Up or Alt+Down to move`:undefined} onPointerDown={movable?event=>grab(event,id):undefined} onKeyDown={movable?event=>keys(event,id):undefined}>
   <span className="sb-custom-grip" aria-hidden="true">{movable&&<svg viewBox="0 0 12 12"><path d="M2 3.5h8M2 6h8M2 8.5h8"/></svg>}</span>
   <span className="sb-custom-name" id={label}>{SECTION_NAMES[id]}{!movable&&<small>{id==='favorites'?t(favoritesPlace==='bottom'?"sidebarcustomize.alwaysAtBottom":"sidebarcustomize.alwaysOnTop"):t("sidebarcustomize.withTabs")}</small>}</span>
   <button type="button" role="switch" aria-checked={shown} aria-labelledby={label} className="shields-switch" onClick={()=>onChange(toggleSection(layout,id))}><span aria-hidden="true"/></button>
  </div>;};
 return <div className="sb-custom" role="group" aria-label={t("sidebarcustomize.customizeSidebar")}>
  <div className="sb-custom-head" data-flip="cs:head"><span>{t("sidebarcustomize.customizeSidebar")}</span><button type="button" className="sb-custom-done" onClick={onDone}>{t("favoriteeditor.done")}</button></div>
  <div ref={list} className="sb-custom-list">{card('favorites',false)}{card('pinned',false)}{layout.order.filter(id=>MOVABLE_SECTIONS.includes(id)).map(id=>card(id,true))}</div>
  <p className="sb-custom-note" data-flip="cs:note">{t("sidebarcustomize.dragToReorderTurnedOff")}</p>
 </div>;
}
