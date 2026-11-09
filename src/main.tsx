import React,{ Component,type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { installDesignVariables } from './ui/designSystem';
import { installDisclosureMotion } from './ui/disclosureMotion';
import { initLocale, applyLanguageSetting, t } from './i18n';
import { installWindowFullscreen } from './ui/windowFullscreen';
import { planRecovery, readReloads, type RecoveryLog } from './ui/viewRecovery';
installDesignVariables();installDisclosureMotion();
// Only the window's own interface view (not the popup layer) speaks for the window: main takes the page views off it while its error screen is up.
const isWindowView=!new URLSearchParams(location.search).get('view');
const tellMain=(on:boolean)=>{if(!isWindowView)return;try{void import('./runtime/client').then(({runtime})=>runtime.browserCommand({type:'interface-error',tabId:'interface',on})).catch(()=>{});}catch{/* no window to tell */}};
const RELOADS_KEY='acira-ui-recovery';
let recoveryLog:RecoveryLog={retries:[],reloads:[]};
class AppErrorBoundary extends Component<{children:ReactNode},{message:string;attempt:number}>{
 state={message:'',attempt:0};
 static getDerivedStateFromError(error:Error){return {message:error.message};}
 // The browser's state lives in the main process, so nothing is lost by trying again. First the tree is mounted afresh in place (before anything is painted: no reload, no blank
 // view); a view that fails again reloads, twice a minute at most so one that cannot start does not loop; after that the error screen stays and main hides the pages over it.
 componentDidCatch(){
  let reloads:number[]=[];try{reloads=readReloads(sessionStorage.getItem(RELOADS_KEY));}catch{/* storage unavailable: the Reload view button remains */}
  const plan=planRecovery({retries:recoveryLog.retries,reloads},Date.now());recoveryLog={retries:plan.log.retries,reloads:plan.log.reloads};
  if(plan.step==='retry'){this.setState(state=>({message:'',attempt:state.attempt+1}));return;}
  if(plan.step==='stay')tellMain(true);
  if(plan.step==='reload'){try{sessionStorage.setItem(RELOADS_KEY,JSON.stringify(plan.log.reloads));}catch{/* storage unavailable */}setTimeout(()=>location.reload(),150);}
 }
 render(){return this.state.message?<div style={{height:'100%',display:'grid',placeItems:'center',background:'#f2f3f5',color:'#30343b',padding:40}}><div style={{maxWidth:480}}><img src="./acira-logo.svg" alt={t("browsersettings.acira")} width="150"/><h1 style={{fontSize:24,marginTop:28}}>{t("main.errorTitle")}</h1><p style={{margin:'16px 0',lineHeight:1.7}}>{t("main.errorBody")}</p><button className="btn" onClick={()=>location.reload()}>{t("main.reloadView")}</button> <details style={{marginTop:24,fontSize:12}}><summary>{t("main.errorDetails")}</summary><p>{this.state.message}</p></details></div></div>:<React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;}
}
document.documentElement.dataset.native=window.acira?'true':'false';
document.documentElement.dataset.platform=window.acira?.platform||(/Mac/.test(navigator.platform)?'darwin':'win32');
installWindowFullscreen();
performance.mark('acira-render-begin');
// The last language used is loaded before the first paint (English needs no wait), so nothing flashes in the wrong language.
void initLocale().catch(()=>undefined).then(()=>{ // Every view (the page, menus and popups in the overlay) follows the language setting on its own.
  const watch=(raw:{settings?:{language?:string}}|null)=>{if(raw&&raw.settings)void applyLanguageSetting(raw.settings.language);};
  window.acira?.subscribe?.(watch as never);void window.acira?.getSnapshot?.().then(watch as never);}).then(()=>import('./App')).then(async({default:App})=>{await import('./allStyles');createRoot(document.getElementById('root')!).render(<React.StrictMode><AppErrorBoundary><App/></AppErrorBoundary></React.StrictMode>);});
requestAnimationFrame(()=>requestAnimationFrame(()=>performance.mark('acira-first-frame')));

// The study owns its materials in frost-preview.css. The original experience
// skin changes geometry as well as paint and must not compete with that layer.


// One button component for every surface; loads after the study so it settles every older button look.
// Subtitles and ledes: the subtitle weight and tracking, in Inter like the titles above them.
// Panels, popovers and menus: one rhythm, rows on the glass, fade-ended separators between groups only.
