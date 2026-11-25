import type { ReactNode } from 'react';
import type { BrowserMenuIcon } from '../BrowserMenu';
import { Eye,SlidersHorizontal } from '../AppIcons';
import { requestSidebar,SECTION_NAMES,sectionLocked,type SectionId } from '../../ui/sidebarSections';

import { t } from '../../i18n';
type Row=(label:string,Icon:BrowserMenuIcon,action:()=>void,hint?:string)=>ReactNode;
const sep=<hr className="acira-menu-sep"/>;

/** The two rows that end every sidebar section's right-click menu, so the way to hide a section or change the sidebar is found
 * where the section is: Hide this section (it goes at once) and Customize sidebar… (the sections' own editor, where it comes back).
 * Both are asked of the sidebar of this window (ui/sidebarSections.ts requestSidebar), which acts with its own stores. */
export function sectionActions(row:Row,windowId:string|undefined,section:SectionId,close:()=>void):ReactNode{
 const ask=(request:Parameters<typeof requestSidebar>[1])=>()=>{requestSidebar(windowId,request);close();};
 return <>
  {!sectionLocked(section)&&row(t("sidebarmenu.hideSection"),Eye,ask({kind:'hide',section}))}
  {row(t("sidebarmenu.customize"),SlidersHorizontal,ask({kind:'customize'}))}
 </>;
}

/** The right-click menu of a section that has no menu of its own (Downloads, History, Reading list, Favorites' free space): just those two rows. */
export function SectionMenu({row,windowId,section,close,before}:{row:Row;windowId?:string;section:SectionId;close:()=>void;/** Rows of this section's own, above the two common ones (Favorites: "Favorites' tabs in the tab list", Beta 14, H: easy to find where the Favorites are). */before?:ReactNode}){
 return <div role="group" aria-label={SECTION_NAMES[section]}>{before&&<>{before}{sep}</>}{sectionActions(row,windowId,section,close)}</div>;
}
export {sep as sectionSeparator};
