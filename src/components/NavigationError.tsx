import {useEffect,useId,useRef,useState,type CSSProperties} from 'react';
import {runtime} from '../runtime/client';import {useT} from '../i18n';import {settingsTargetAction} from '../ui/settingsView';import type {CertificateStatus,TabSession} from '../runtime/types';import type {ThreatStatus} from '../runtime/nativeNetwork';
import {describeDestination,formatFingerprint,navigationFailure,type FailureKind} from '../ui/navigationFailure';
import {canOfferContinue,continueAnyway,exceptionMinutes} from '../ui/certificateOverride';
import {CrossMark} from './CheckMark';
import {OfflineGame} from './offline-game/OfflineGame';
import '../styles/neutral-primary.css';
import '../styles/error-page.css';

const typing=()=>{const active=document.activeElement as HTMLElement|null;return Boolean(active&&(active.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)));};
const message=(reason:unknown,fallback:string)=>reason instanceof Error&&reason.message?reason.message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/,''):fallback;
/** Origin and path only: query strings and fragments are long, personal and not what the person needs to read. */
const shortAddress=(url:string,fallback:string)=>{try{const parsed=new URL(url);const base=parsed.origin+(parsed.pathname==='/'?'':parsed.pathname);return parsed.search||parsed.hash?base+'…':base||fallback;}catch{return fallback;}};
/** Stagger for the arrival reveal, in milliseconds. */
const delay=(ms:number)=>({'--ne-d':`${ms}ms`}) as CSSProperties;

export function NavigationError({tab,onEditAddress,onReport,reducedMotion=false}:{tab:TabSession;onNavigate?:(url:string)=>void;onEditAddress?:()=>void;onReport?:()=>void;reducedMotion?:boolean}){
 const t=useT();
 const destination=describeDestination(tab.url),crashed=/^The page stopped responding/.test(tab.error||''),failure=crashed?{...navigationFailure('',destination),code:'RENDERER_GONE',title:t('error.crashTitle'),message:t('error.crashMessage'),kind:'other' as FailureKind,detail:undefined,steps:[],retryable:true}:navigationFailure(tab.error||'',destination),id=useId(),certificateError=failure.kind==='certificate';
 const [certificate,setCertificate]=useState<CertificateStatus>(),[busy,setBusy]=useState(false),[problem,setProblem]=useState(''),[,tick]=useState(0),primary=useRef<HTMLButtonElement>(null),reloaded=useRef(false),[copied,setCopied]=useState(false),[trying,setTrying]=useState(false),[armed,setArmed]=useState(false),seenAt=useRef(new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit',second:'2-digit'})).current;
 const backAvailable=tab.canGoBack||tab.historyIndex>0;
 const [threat,setThreat]=useState<ThreatStatus|null>(null),blockedByClient=/BLOCKED_BY_CLIENT/.test(failure.code);
 // Native knows whether the block came from the phishing and malware lists; this page only reads it.
 useEffect(()=>{setThreat(null);setArmed(false);if(!blockedByClient)return;let alive=true;void runtime.service({type:'threats.status',tabId:tab.id}).then(result=>{if(alive)setThreat(result.threat||null);}).catch(()=>{});return()=>{alive=false;};},[tab.id,tab.error,tab.url,blockedByClient]);
 // Native owns the certificate decision; this page only reads the warning for this document and re-reads when it changes.
 useEffect(()=>{if(!certificateError)return;let alive=true;setCertificate(undefined);void runtime.service({type:'certificates.status',tabId:tab.id}).then(result=>{if(alive)setCertificate(result.certificate);}).catch(()=>{});const unsubscribe=runtime.subscribeBrowser(event=>{if(event.type==='certificate-state'&&event.tabId===tab.id)setCertificate(event.status);});return()=>{alive=false;unsubscribe();};},[tab.id,tab.error,tab.url,certificateError]);
 // The warning ticket is short-lived; stop offering Continue the moment it lapses instead of failing on click.
 useEffect(()=>{const expires=certificate?.failure?.expiresAt;if(!expires)return;const timer=setTimeout(()=>tick(value=>value+1),Math.max(0,expires-Date.now())+50);return()=>clearTimeout(timer);},[certificate?.failure?.expiresAt]);
 // The safest next step holds focus (without a ring until the keyboard is used), unless the person is typing elsewhere.
 useEffect(()=>{if(!typing())primary.current?.focus({preventScroll:true,focusVisible:false} as FocusOptions);},[]);
 // Offline pages try again by themselves: when the network returns, and on a gentle backoff (5s, 10s, 20s ... up to a minute, six tries).
 useEffect(()=>{if(failure.kind!=='offline')return;let tries=0,timer=0,last=0;const go=()=>{if(Date.now()-last<2000)return;last=Date.now();void runtime.browserCommand({type:'reload',tabId:tab.id});};const schedule=()=>{if(tries>=6)return;timer=window.setTimeout(()=>{if(navigator.onLine)go();schedule();},Math.min(60000,5000*2**tries++));};window.addEventListener('online',go);schedule();return()=>{window.clearTimeout(timer);window.removeEventListener('online',go);};},[failure.kind,tab.id]);
 const goBack=()=>{if(backAvailable)void runtime.browserCommand({type:'back',tabId:tab.id});else void runtime.dispatch({type:'tab.navigate',tabId:tab.id,url:'acira://new'});},retry=()=>{setTrying(true);void runtime.browserCommand({type:'reload',tabId:tab.id}).finally(()=>setTimeout(()=>setTrying(false),900));};
 const offer=certificateError&&canOfferContinue(certificate,tab.error,tab.url)?certificate:undefined;
 const proceed=async()=>{if(!offer)return;setBusy(true);setProblem('');try{await continueAnyway(tab.id,offer.failure.ticketId);}catch(reason){setProblem(message(reason,t('error.warningChanged')));}finally{setBusy(false);}};
 const proceedThreat=async()=>{setBusy(true);setProblem('');try{await runtime.service({type:'threats.continue',tabId:tab.id});await runtime.browserCommand({type:'reload',tabId:tab.id});}catch(reason){setProblem(message(reason,'The warning changed. Reload the page to see it again.'));}finally{setBusy(false);}};
 const fingerprint=formatFingerprint(certificate?.failure?.fingerprint),fingerprintGroups=fingerprint?fingerprint.replace(/:/g,'').match(/.{1,4}/g)!.join(' '):'';
 const threatError=Boolean(threat),goBackFirst=certificateError||threatError,showBack=backAvailable||threatError,editable=Boolean(onEditAddress);
 const technical=crashed?[[t('error.tech.reason'),(tab.error||'').replace(/^The page stopped responding:\s*/,'')||t('error.tech.crashed')],[t('error.tech.time'),seenAt]] as [string,string][]:[[t('error.tech.url'),shortAddress(tab.url,destination.address)],[t('error.tech.error'),`${failure.code}${failure.number!==undefined?` (${failure.number})`:''}`],[t('error.tech.host'),destination.host],...(threat?[[t('error.tech.blockedBy'),threat.list]]:[]),...(destination.port?[[t('error.tech.port'),destination.port]]:[]),...(failure.code==='NAVIGATION_FAILED'&&tab.error?[[t('error.tech.message'),tab.error]]:[]),...(fingerprintGroups?[['SHA‑256',fingerprintGroups]]:[]),[t('error.tech.time'),seenAt]] as [string,string][];
 const copy=()=>{const text=technical.map(([label,value])=>`${label}: ${value}`).join('\n');void navigator.clipboard?.writeText(text).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1400);}).catch(()=>{});};
 return <article className="navigation-error" aria-labelledby={id} data-failure-kind={failure.kind} data-motion={reducedMotion?'reduced':undefined}>
  <div className="ne-body">
  <div className="ne-glyph" data-danger={certificateError||threatError||undefined} aria-hidden="true"><CrossMark size={16}/></div>
  <div id={id} className="display-page ne-title" role="heading" aria-level={1}>{threat?threat.title:failure.title}</div>
  <p className="lede ne-message">{threat?threat.cause:failure.message}</p>{failure.kind==='offline'&&<p className="ne-note ne-waiting" role="status">{t('error.offlineWaiting')}</p>}
  <dl className="ne-tech" aria-label={t('error.technicalDetails')}>{technical.map(([label,value])=><div key={label}><dt>{label}</dt><dd><bdi>{value}</bdi></dd></div>)}<button type="button" className="ne-copy" aria-label={t('error.copyTechnical')} onClick={copy}>{copied?t('error.copied'):t('error.copy')}</button></dl>
  <div className="ne-actions">
   {goBackFirst?<><button ref={primary} type="button" className="ne-button" data-primary onClick={goBack}>{t('error.goBack')}</button>{!threatError&&<button type="button" className="ne-button" onClick={retry} disabled={trying}>{trying?t('error.trying'):crashed?t('error.reload'):t('error.tryAgain')}</button>}</>:<><button ref={primary} type="button" className="ne-button" data-primary onClick={retry} disabled={trying} aria-busy={trying}>{trying?t('error.trying'):crashed?t('error.reload'):t('error.tryAgain')}</button>{showBack&&<button type="button" className="ne-button" onClick={goBack}>{t('error.goBack')}</button>}</>}
   {/PROXY_/.test(failure.code)&&<button type="button" className="ne-button" onClick={()=>{void runtime.dispatch(settingsTargetAction({type:'tab.new',url:'acira://settings'},{section:'Privacy',setting:'proxy'}));}}>{t('error.checkProxy')}</button>}
   {editable&&<button type="button" className="ne-button" data-quiet onClick={onEditAddress}>{t('error.editAddress')}</button>}
  </div>
  {certificateError&&offer&&<div className="ne-unsafe">
   {!armed?<button type="button" className="ne-link" data-danger onClick={()=>setArmed(true)}>{t('error.cert.continue')}</button>:<div role="group" aria-label={t('error.cert.group')}>
    <p>{t('error.cert.warning',{host:`\u2068${destination.host}\u2069`})}</p>
    <p className="ne-note">{t('error.cert.applies',{minutes:exceptionMinutes})}</p>
    <button type="button" className="ne-button" data-danger disabled={busy} onClick={()=>void proceed()}><span>{t('error.proceed',{host:`\u2068${destination.hostPort}\u2069`})}</span></button>
   </div>}
  </div>}
  {certificateError&&!offer&&certificate&&<p className="ne-note ne-unsafe">{certificate.failure?t('error.cert.noBypass'):t('error.cert.expired')}</p>}
  {threat&&<div className="ne-unsafe">
   {!armed?<button type="button" className="ne-link" data-danger onClick={()=>setArmed(true)}>{t('error.threat.continue')}</button>:<div role="group" aria-label={t('error.threat.group')}>
    <p>{threat.kind==='malware'?t('error.threat.malwareWarning'):t('error.threat.phishingWarning')}</p>
    <p className="ne-note">{t('error.threat.note')}</p>
    <button type="button" className="ne-button" data-danger disabled={busy} onClick={()=>void proceedThreat()}><span>{t('error.proceed',{host:`\u2068${destination.hostPort}\u2069`})}</span></button>
   </div>}
  </div>}
  {problem&&<div className="ne-problem" role="alert">{problem}</div>}
  {failure.kind==='offline'&&<OfflineGame reducedMotion={reducedMotion}/>}
  {(failure.detail||failure.steps.length>0||threat)&&<details className="ne-details">
   <summary><span>{t('error.moreInfo')}</span></summary>
   {threat&&<><p className="ne-detail">{threat.detail}</p><p className="ne-detail">{t('error.threat.source',{list:threat.list})}</p>{/* "Report a problem with this site" on Page information, already set to "Blocked by mistake" (SiteReport.tsx) */onReport&&<p className="ne-detail"><button type="button" className="ne-link" onClick={onReport}>{t('report.safeLink')}</button></p>}</>}
   {failure.detail&&<p className="ne-detail">{failure.detail}</p>}
   {certificate?.failure&&!certificate.failure.canContinue&&<p className="ne-detail">{certificate.failure.reason}</p>}
   {failure.steps.length>0&&!threat&&<><p className="ne-try">{t('error.whatYouCanDo')}</p><ul>{failure.steps.map(step=><li key={step}>{step}</li>)}</ul></>}
  </details>}
  </div>
 </article>;
}
