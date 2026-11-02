import {useCallback,useEffect,useRef,useState} from 'react';
import {runtime} from '../runtime/client';
import type {ServiceResult,TabSession} from '../runtime/types';
import {Disclosure,SwitchRow} from '../components/PanelParts';
import {Activity,Globe2,Info,PanelTop} from '../components/AppIcons';
import {ProtectionIcon} from '../components/ProtectionIcon';
import '../styles/shields.css';

import { currentLocale,t } from '../i18n';
type Privacy=NonNullable<ServiceResult['privacy']>;
type Filters=NonNullable<ServiceResult['filters']>;
const count=new Intl.NumberFormat('en-US');
const reason=(error:unknown)=>error instanceof Error?error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''):'Could not change protection.';

/** Privacy as facts on the panel system: one row: the switch for this site with the blocked count; tapping the row opens the detail list. Counts come from the running blocker. */
export function ShieldsSummary({tab,blockingOnly=false,privateMode=false}:{tab:TabSession;blockingOnly?:boolean;privateMode?:boolean}){
 const [privacy,setPrivacy]=useState<Privacy>(),[filters,setFilters]=useState<Filters>(),[cookies,setCookies]=useState<'block'|'allow'>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[changed,setChanged]=useState(false);
 const generation=useRef(0),saving=useRef(false),requestVersion=useRef(0);
 const supported=tab.contentKind==='web'&&(!blockingOnly||/^https?:\/\//i.test(tab.url));
 const ready=supported&&!tab.loading&&!tab.error;
 const load=useCallback(()=>{
  let alive=true;
  const read=()=>{if(saving.current)return;const version=++requestVersion.current;void runtime.service({type:'privacy.status',tabId:tab.id}).then(result=>{if(alive&&version===requestVersion.current&&!saving.current){setPrivacy(result.privacy);setError(result.privacy?'':t('protection.unavailable'));}}).catch(()=>{if(alive&&version===requestVersion.current)setError(t('protection.unavailable'));});};
  read();
  const timer=blockingOnly?setInterval(read,1500):undefined;
  void runtime.service({type:'filters.status',tabId:tab.id}).then(result=>alive&&setFilters(result.filters)).catch(()=>undefined);
  if(!blockingOnly){
  void runtime.service({type:'network.status'}).then(result=>alive&&setCookies(result.network?.engine?.thirdPartyCookies==='unknown'?undefined:result.network?.engine?.thirdPartyCookies)).catch(()=>undefined);
  }
  return()=>{alive=false;clearInterval(timer);};
 },[tab.id,blockingOnly]);
 useEffect(()=>{generation.current++;saving.current=false;setBusy(false);setPrivacy(undefined);setFilters(undefined);setChanged(false);setError('');const cleanup=ready?load():undefined;return()=>{generation.current++;cleanup?.();};},[tab.id,tab.url,ready,load]);
 const change=async(blocking:boolean)=>{if(saving.current)return;const version=generation.current;requestVersion.current++;saving.current=true;setBusy(true);setError('');try{const result=await runtime.service({type:'privacy.set',tabId:tab.id,blocking,scope:'site'});if(version===generation.current){setPrivacy(result.privacy);setChanged(true);}}catch(problem){if(version===generation.current)setError(reason(problem));}finally{if(version===generation.current){saving.current=false;setBusy(false);}}};
 if(!supported)return blockingOnly?<div className="acira-menu-row acira-menu-row-fact" role="status"><Info size={16} className="acira-menu-icon"/><span className="acira-menu-title">{t('protection.openWebsite')}</span><span/></div>:null;
 const hosts=new Map<string,number>();for(const item of privacy?.details??[])hosts.set(item.hostname,(hosts.get(item.hostname)??0)+1);
 const top=[...hosts].sort((a,b)=>b[1]-a[1]).slice(0,6);
 const hiddenLabel=filters?.annoyances&&filters.aiContent?t("shieldssummary.bannersAndAiHidden"):filters?.aiContent?t("shieldssummary.aiAnswersHidden"):filters?.annoyances?t("shieldssummary.cookieBannersHidden"):'';
 const on=privacy?.blocking===true,banners=filters?.annoyances!==false,aiOn=filters?.aiContent===true,popupAds=filters?.popupAds!==false;
 const setFilter=async(patch:{aiContent?:boolean;annoyances?:boolean;popupAds?:boolean})=>{setBusy(true);setError('');try{const result=await runtime.service({type:'filters.set',tabId:tab.id,scope:'site',patch});setFilters(result.filters);if(!('popupAds' in patch))setChanged(true);}catch(problem){setError(reason(problem));}finally{setBusy(false);}};
 return <section className="shields" aria-label={t("shieldssummary.protectionOnThisSite")} aria-busy={busy} data-popup-pending={ready&&!error&&(!privacy||!blockingOnly&&!filters)||undefined}>
  {blockingOnly&&<div className="acira-menu-row acira-menu-row-identity protection-identity"><Globe2 size={16} className="acira-menu-icon"/><span className="acira-menu-title"><bdi>{new URL(tab.url).hostname}</bdi><span className="acira-menu-sub">{t(privateMode?'protection.temporary':'protection.saved')}</span></span><span/></div>}
  {blockingOnly&&<div className="acira-menu-sep" role="separator"/>}
  {blockingOnly?<><SwitchRow id={`blocking-${tab.id}`} icon={<ProtectionIcon size={16} className="acira-menu-icon"/>} label={t('protection.site')} checked={on} disabled={busy||!privacy||!ready} onChange={()=>void change(!on)}/><SwitchRow id={`popups-${tab.id}`} icon={<PanelTop size={16} className="acira-menu-icon"/>} label={t('protection.popupAds')} checked={popupAds&&on} disabled={busy||!filters||!ready||!on} onChange={()=>void setFilter({popupAds:!popupAds})}/><div className="acira-menu-sep" role="separator"/><div className="acira-menu-row acira-menu-row-fact" role="status"><Activity size={16} className="acira-menu-icon"/><span className="acira-menu-title">{privacy?t('protection.blocked',{count:(privacy.blocked??0).toLocaleString(currentLocale())}):!ready?t('site.afterLoad'):!error?t('protection.reading'):''}</span><span/></div>{top.length>0&&<Disclosure title={t('privacy.protection')}>{top.map(([host,n])=><div className="shields-host" key={host}><span><bdi>{host}</bdi></span><b>{n.toLocaleString(currentLocale())}</b></div>)}</Disclosure>}</>:<>
  <Disclosure className="shields-main" title={on?(privacy?`${t("privacy.protection")} · ${t("protection.blocked",{count:count.format(privacy.blocked??0)})}`:t("privacy.protection")):t("shieldssummary.protectionOffOnThisSite")}
   control={<button type="button" role="switch" aria-label={t("shieldssummary.protectionOnThisSite")} aria-checked={on} className="shields-switch" disabled={busy||!privacy||!ready} onClick={event=>{event.preventDefault();event.stopPropagation();void change(!on);}}><span aria-hidden="true"/></button>}>
   {hiddenLabel&&<div className="shields-host"><span>{hiddenLabel}</span><b>{count.format(filters?.hidden??0)}</b></div>}
   {cookies&&<div className="shields-host"><span>{t("privacy.thirdPartyCookies")}</span><b>{cookies==='block'?t("sitePermissions.blocked"):t("sitePermissions.allowed")}</b></div>}
   {top.map(([host,n])=><div className="shields-host" key={host}><span>{host}</span><b>{n}</b></div>)}
   {!hiddenLabel&&!cookies&&top.length===0&&<p>{t("shieldssummary.nothingBlockedYet")}</p>}
  </Disclosure>
  {filters?.aiSurface&&<SwitchRow id={`ai-${tab.id}`} label={t("shieldssummary.aiFreeModeOnThis")} checked={aiOn} disabled={busy||!filters||!ready} onChange={()=>void setFilter({aiContent:!aiOn})}/>}
  <SwitchRow id={`banners-${tab.id}`} label={t("shieldssummary.hideCookieBannersOnThis")} checked={banners} disabled={busy||!filters||!ready} onChange={()=>void setFilter({annoyances:!banners})}/>
  <SwitchRow id={`popups-${tab.id}`} label={t('protection.popupAds')} checked={popupAds&&on} disabled={busy||!filters||!ready||!on} onChange={()=>void setFilter({popupAds:!popupAds})}/>
  </>}
  {changed&&<div className="acira-menu-row acira-menu-row-fact" role="status"><span/><span className="acira-menu-title">{t("shieldssummary.reloadToApply")}</span><button type="button" className="shields-text" onClick={()=>void runtime.browserCommand({type:'reload',tabId:tab.id})}>{t("error.reload")}</button></div>}
  {error&&<p className="shields-error" role="alert">{error}</p>}
 </section>;
}
