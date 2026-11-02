import { useEffect,useState } from 'react';
import { runtime } from '../runtime/client';
import { Sparkles,SparklesOff } from './AppIcons';
import { PreviewIcon } from './PreviewIcon';

import { t } from '../i18n';
/** Optional toolbar button for AI-free mode (the profile's aiContent filter). As in the menu, the glyph says the state: the sparkles (the AI mark)
 * while AI is shown, the sparkle crossed out, pressed, while AI-free mode hides it (beta.7 drew Ads and trackers' own shield with a check when on).
 * The tooltip says what a click does. */
export function AiFreeButton({controlTitle}:{controlTitle:(label:string)=>string}){
 const [on,setOn]=useState<boolean|null>(null),[busy,setBusy]=useState(false);
 useEffect(()=>{let alive=true;const read=()=>runtime.service({type:'filters.profile-status'}).then(result=>{if(alive)setOn(!!result.filters?.aiContent);}).catch(()=>{});void read();const unsubscribe=runtime.subscribeBrowser?.(event=>{if(event.type==='filters-changed')void read();});return()=>{alive=false;unsubscribe?.();};},[]);
 const toggle=()=>{if(on===null||busy)return;setBusy(true);void runtime.service({type:'filters.profile-set',patch:{aiContent:!on}}).then(result=>setOn(!!result.filters?.aiContent)).catch(()=>{}).finally(()=>setBusy(false));};
 const label=on?'AI-free mode is on. AI answers and AI buttons on websites are hidden. Click to turn it off.':'AI-free mode is off. Click to hide AI answers and AI buttons on websites.';
 return <button type="button" className={`icon-button ${on?'active':''}`} aria-pressed={!!on} aria-label={on?t("main.aiFreeModeOn"):t("main.aiFreeModeOff")} title={controlTitle(label)} disabled={on===null||busy} onClick={toggle}>
  <PreviewIcon icon={on?SparklesOff:Sparkles} className="toolbar-icon" size={18}/>
 </button>;
}
