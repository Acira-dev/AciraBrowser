import React,{ Component,type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { installDesignVariables } from './ui/designSystem';
import { installDisclosureMotion } from './ui/disclosureMotion';
import { initLocale, applyLanguageSetting, t } from './i18n';
installDesignVariables();installDisclosureMotion();
class AppErrorBoundary extends Component<{children:ReactNode},{message:string}>{
 state={message:''};
 static getDerivedStateFromError(error:Error){return {message:error.message};}
 // The browser's state lives in the main process, so reloading the view loses nothing. Twice a minute at most, so a view that cannot start does not loop.
 componentDidCatch(){try{const key='acira-ui-recovery',now=Date.now(),seen=(JSON.parse(sessionStorage.getItem(key)||'[]') as number[]).filter(time=>now-time<60000);if(seen.length<2){seen.push(now);sessionStorage.setItem(key,JSON.stringify(seen));setTimeout(()=>location.reload(),150);}}catch{/* storage unavailable: the Reload view button remains */}}
 render(){return this.state.message?<div style={{height:'100%',display:'grid',placeItems:'center',background:'#f2f3f5',color:'#30343b',padding:40}}><div style={{maxWidth:480}}><img src="./acira-logo.svg" alt={t("browsersettings.acira")} width="150"/><h1 style={{fontSize:24,marginTop:28}}>{t("main.errorTitle")}</h1><p style={{margin:'16px 0',lineHeight:1.7}}>{t("main.errorBody")}</p><button className="btn" onClick={()=>location.reload()}>{t("main.reloadView")}</button> <details style={{marginTop:24,fontSize:12}}><summary>{t("main.errorDetails")}</summary><p>{this.state.message}</p></details></div></div>:this.props.children;}
}
document.documentElement.dataset.native=window.acira?'true':'false';
document.documentElement.dataset.platform=window.acira?.platform||(/Mac/.test(navigator.platform)?'darwin':'win32');
performance.mark('acira-render-begin');
// The last language used is loaded before the first paint (English needs no wait), so nothing flashes in the wrong language.
void initLocale().catch(()=>undefined).then(()=>{ // Every view (the page, menus and popups in the overlay) follows the language setting on its own.
  const watch=(raw:{settings?:{language?:string}}|null)=>{if(raw&&raw.settings)void applyLanguageSetting(raw.settings.language);};
  window.acira?.subscribe?.(watch as never);void window.acira?.getSnapshot?.().then(watch as never);}).then(()=>import('./App')).then(async({default:App})=>{await import('./allStyles');createRoot(document.getElementById('root')!).render(<React.StrictMode><AppErrorBoundary><App/></AppErrorBoundary></React.StrictMode>);});
requestAnimationFrame(()=>requestAnimationFrame(()=>performance.mark('acira-first-frame')));

// The study owns its materials in frost-preview.css. The original experience
// skin changes geometry as well as paint and must not compete with that layer.


// One button component for every surface; loads after the study so it settles every older button look.
// Subtitles and ledes in IBM Plex Sans, under the Inter display titles.
// Panels, popovers and menus: one rhythm, rows on the glass, fade-ended separators between groups only.
