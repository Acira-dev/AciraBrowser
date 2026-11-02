import {useEffect,useState} from 'react';
import {runtime} from '../runtime/client';import type {CertificateStatus} from '../runtime/types';
import {revokeException} from '../ui/certificateOverride';
import '../styles/site-information.css';
import { t } from '../i18n';
export function useCertificateStatus(tabId:string,url:string){
 const [status,setStatus]=useState<CertificateStatus>();
 useEffect(()=>{let alive=true;setStatus(undefined);void runtime.service({type:'certificates.status',tabId}).then(result=>{if(alive)setStatus(result.certificate);}).catch(()=>{});const unsubscribe=runtime.subscribeBrowser(event=>{if(event.type==='certificate-state'&&event.tabId===tabId)setStatus(event.status);});return()=>{alive=false;unsubscribe();};},[tabId,url]);return status;
}
export function CertificateIndicator({tabId,url,onOpen}:{tabId:string;url:string;onOpen:()=>void}){const status=useCertificateStatus(tabId,url);return status?.exception?<button type="button" className="certificate-indicator" aria-label={t("certificatenotice.temporaryCertificateExceptionReviewConnection")} title={t("certificatenotice.identityNotVerifiedTemporaryException")} onClick={onOpen}>{t("certificatenotice.notVerified")}</button>:null;}
const until=(expiresAt:number)=>new Date(expiresAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
/** Shown in the site panel while an exception exists: what was allowed, until when, and a way to end it. */
export function CertificateNotice({tabId,url}:{tabId:string;url:string}){
 const status=useCertificateStatus(tabId,url),[busy,setBusy]=useState(false),[error,setError]=useState('');
 if(!status?.exception)return null;
 return <div className="certificate-notice" role="status">
  <strong>{t("certificatenotice.thisSiteSIdentityIsn")}</strong>
  <p>{t("certificatenotice.exceptionNote", { until: until(status.exception.expiresAt) })}</p>
  <button type="button" className="btn" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await revokeException(tabId);}catch(reason){setError(reason instanceof Error?reason.message:'The exception could not be removed.');}finally{setBusy(false);}}}>{t("certificatenotice.removeException")}</button>
  {error&&<p className="certificate-notice-error" role="alert">{error}</p>}
 </div>;
}
