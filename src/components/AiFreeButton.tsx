import { useEffect,useState } from 'react';
import { runtime } from '../runtime/client';

import { t } from '../i18n';
/** Optional toolbar button for AI-free mode (the profile's aiContent filter). Outline shield when off, filled with a check when on; the tooltip says what a click does. */
export function AiFreeButton({controlTitle}:{controlTitle:(label:string)=>string}){
 const [on,setOn]=useState<boolean|null>(null),[busy,setBusy]=useState(false);
 useEffect(()=>{let alive=true;const read=()=>runtime.service({type:'filters.profile-status'}).then(result=>{if(alive)setOn(!!result.filters?.aiContent);}).catch(()=>{});void read();const unsubscribe=runtime.subscribeBrowser?.(event=>{if(event.type==='filters-changed')void read();});return()=>{alive=false;unsubscribe?.();};},[]);
 const toggle=()=>{if(on===null||busy)return;setBusy(true);void runtime.service({type:'filters.profile-set',patch:{aiContent:!on}}).then(result=>setOn(!!result.filters?.aiContent)).catch(()=>{}).finally(()=>setBusy(false));};
 const label=on?'AI-free mode is on. AI answers and AI buttons on websites are hidden. Click to turn it off.':'AI-free mode is off. Click to hide AI answers and AI buttons on websites.';
 return <button type="button" className={`icon-button ${on?'active':''}`} aria-pressed={!!on} aria-label={on?t("main.aiFreeModeOn"):t("main.aiFreeModeOff")} title={controlTitle(label)} disabled={on===null||busy} onClick={toggle}>
  <svg width="18" height="18" viewBox="0 0 16 16" fill={on?'currentColor':'none'} fillOpacity={on?0.18:0} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true"><path d="M8 1.8 13 3.6v4.1c0 3-2 5.2-5 6.5-3-1.3-5-3.5-5-6.5V3.6z"/>{on&&<path d="m5.6 8 1.7 1.7 3.1-3.3"/>}</svg>
 </button>;
}
