import { useLayoutEffect,useRef,type RefObject } from 'react';

/** Where keyboard focus goes when a menu that drills into sections (Change layout ›, Move to tab group ›) changes section: into a section it lands on
 *  the first row (the back row), and leaving a section it returns to the row that opened it, found by its text. Same behaviour as TabGroupControls. */
export function sectionFocusTarget<T extends {textContent:string|null}>(rows:readonly T[],section:string|null,previous:string|null,labels:Readonly<Record<string,string>>):T|undefined {
 if(section)return rows[0];
 return previous?rows.find(row=>row.textContent?.trim()===labels[previous]):undefined;
}

/** Moves focus on every section change of a menu (not on its first render): `labels` are the rows that open each section, in the active language. */
export function useSectionFocus<S extends string>(menu:RefObject<HTMLElement|null>,section:S|null,labels:Readonly<Record<S,string>>):void {
 const previous=useRef<S|null>(null);
 useLayoutEffect(()=>{
  const before=previous.current;previous.current=section;
  if(!section&&!before)return;
  const rows=[...menu.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]')||[]];
  sectionFocusTarget(rows,section,before,labels)?.focus({preventScroll:true});
 },[section]);
}
