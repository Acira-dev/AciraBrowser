import {useEffect,useRef,useState} from 'react';
import {runtime} from '../runtime/client';
import type {ProfileCleanupGate} from '../runtime/types';
import '../styles/profile-cleanup-integration.css';

import { t } from '../i18n';
/** A trusted recovery surface remains usable while native website views are held. */
export function ProfileCleanupRecovery({profileId,privateMode,onSettings}:{profileId:string;privateMode:boolean;onSettings?:()=>void}){
 const [gate,setGate]=useState<ProfileCleanupGate|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const generation=useRef(0),saving=useRef(false);
 useEffect(()=>{
  const version=++generation.current;let read=0;setGate(null);setError('');setBusy(false);saving.current=false;
  if(privateMode)return;
  const refresh=async()=>{const request=++read;try{const result=await runtime.service({type:'cleanup.gate'});if(!result.cleanupGate||result.cleanupGate.profileId!==profileId)throw Error('The native cleanup profile changed.');if(version===generation.current&&request===read){setGate(result.cleanupGate);setError('');}}catch(cause){if(version===generation.current&&request===read)setError(String(cause));}};
  void refresh();const unsubscribe=runtime.subscribeBrowser(event=>{if(event.type==='cleanup-state')void refresh();});
  return()=>{generation.current++;unsubscribe();};
 },[profileId,privateMode]);
 if(privateMode||gate?.ready&&!error||!gate&&!error)return null;
 const retry=async()=>{if(saving.current)return;saving.current=true;setBusy(true);const version=generation.current;try{const result=await runtime.service({type:'cleanup.recover'});if(!result.cleanupGate||result.cleanupGate.profileId!==profileId)throw Error('The native cleanup profile changed.');if(version===generation.current){setGate(result.cleanupGate);setError('');}}catch(cause){if(version===generation.current)setError(String(cause));}finally{if(version===generation.current){saving.current=false;setBusy(false);}}};
 return <section className={'profile-cleanup-recovery'+(onSettings?' profile-cleanup-page':'')} aria-label={t("profilecleanuprecovery.profileCleanupRecovery")} aria-busy={busy}>
  <div className="profile-cleanup-recovery-copy"><h2>{gate?.closing?t("profilecleanuprecovery.finishingProfileCleanup"):t("profilecleanuprecovery.finishCleanupBeforeWebsitesOpen")}</h2><p>{t("profilecleanuprecovery.aciraCouldNotFinishThis")}</p><p>{t("profilecleanuprecovery.closeWebsiteTabsAndPopup")}</p>
  {(error||gate?.error)&&<details><summary>{t("profilecleanuprecovery.cleanupDetails")}</summary><p>{error||gate?.error}</p></details>}
  <div className="profile-cleanup-recovery-actions"><button className="btn btn-primary" disabled={gate?.closing} aria-disabled={busy||gate?.closing} onClick={()=>void retry()}>{busy?t("profilecleanuprecovery.checkingCleanup"):t("profilecleanuprecovery.retryCleanup")}</button>{onSettings&&<button className="btn" disabled={busy||gate?.closing} onClick={onSettings}>{t("paletteresults.openSettings")}</button>}</div></div>
 </section>;
}
