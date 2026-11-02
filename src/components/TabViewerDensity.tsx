import '../styles/tab-viewer.css';
import type { ReactNode } from 'react';
import type { TabViewerDensity } from './TabResults';

import { t } from '../i18n';
/** The tab viewer's row size (founder, 25 Oct): Comfortable, the original viewer's two-line rows, or Compact, one line
 * per tab. Two small glyph buttons in the viewer's header; the same choice lives in Settings › Tabs. */
export function TabViewerDensityToggle({value,onChange}:{value:TabViewerDensity;onChange:(value:TabViewerDensity)=>void}){
 const option=(density:TabViewerDensity,label:string,glyph:ReactNode)=><button type="button" role="radio" aria-checked={value===density} tabIndex={value===density?0:-1} aria-label={label} title={label} data-active={value===density||undefined} onClick={()=>onChange(density)}>{glyph}</button>;
 return <div className="tab-viewer-density" role="radiogroup" aria-label={t("tabviewerdensity.rowSize")} onKeyDown={event=>{
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
  event.preventDefault();event.stopPropagation();
  const choices=['comfortable','compact'] as const,at=choices.indexOf(value);
  const index=event.key==='Home'?0:event.key==='End'?1:(at+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+choices.length)%choices.length;
  onChange(choices[index]);event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[index]?.focus();
 }}>
  {option('comfortable','Comfortable',<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="2" y="3" width="12" height="4" rx="1.5"/><rect x="2" y="9" width="12" height="4" rx="1.5"/></svg>)}
  {option('compact','Compact',<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="2" y="2.5" width="12" height="1.6" rx=".8"/><rect x="2" y="6" width="12" height="1.6" rx=".8"/><rect x="2" y="9.5" width="12" height="1.6" rx=".8"/><rect x="2" y="13" width="12" height="1.6" rx=".8"/></svg>)}
 </div>;
}
