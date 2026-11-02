import {useEffect,useRef,useState} from 'react';
import {Disclosure} from '../components/PanelParts';
import {runtime} from '../runtime/client';
import type {TabSession,ForgetSitePreview,ForgetSiteResult} from '../runtime/types';

import { t } from '../i18n';
export function ForgetSitePanel({tab}:{tab:TabSession}){
 const [preview,setPreview]=useState<ForgetSitePreview>(),[result,setResult]=useState<ForgetSiteResult>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),generation=useRef(0);
 useEffect(()=>{generation.current++;setPreview(undefined);setResult(undefined);setError('');setBusy(false);return()=>{generation.current++;};},[tab.id,tab.url,tab.loading,tab.error]);
 async function request(commit=false){const current=generation.current;setBusy(true);setError('');try{const value=await runtime.service({type:commit?'site.forget':'site.forget-preview',tabId:tab.id});if(current!==generation.current)return;if(commit){setResult(value.forgotten);if(!value.forgotten?.cancelled)setPreview(undefined);}else{setPreview(value.forgetPreview);setResult(undefined);}}catch(reason){if(current===generation.current)setError(reason instanceof Error?reason.message:'Site data could not be reviewed. Try again.');}finally{if(current===generation.current)setBusy(false);}}
 return <Disclosure className="site-forget-disclosure acira-nested" title={t("forgetsitepanel.forgetThisSite")}><p>{t("forgetsitepanel.removeThisSiteSHistory")}</p><button className="btn" disabled={busy||tab.loading||!!tab.error} onClick={()=>void request()}>{t("forgetsitepanel.reviewSiteData")}</button>
 {preview&&<div><p><strong><bdi>{preview.origin}</bdi></strong></p><p>{t("forgetsitepanel.counts1",{history:preview.counts.history,closedTabs:preview.counts.closedTabs,entries:preview.counts.closedHistoryEntries})}</p><p>{t("forgetsitepanel.counts2",{cookies:preview.counts.cookies,scope:`\u2068${preview.cookieScope}\u2069`,permissions:preview.counts.permissions})}</p><p>{t("forgetsitepanel.otherStorageAndCache")} <bdi>{preview.storageScope}</bdi>.</p><p>{preview.notice}</p><p>{t("forgetsitepanel.kept",{items:preview.preserved.join('; ')})}</p><button className="btn" disabled={busy} onClick={()=>void request(true)}>{t("forgetsitepanel.forgetSite")}</button></div>}
 {result?.cancelled&&<p role="status">{t("forgetsitepanel.nothingWasCleared")}</p>}{result&&!result.cancelled&&<div role="status"><p>{result.cleared?t("forgetsitepanel.siteDataAndLocalRecords"):t("forgetsitepanel.someSiteDataOrRecords")}</p>{result.results?.map((item,index)=><p key={index}>{item.category}: {item.status}{item.error?` · ${item.error}`:''}</p>)}{result.recoveryPaused&&<p>{t("site.recoveryPaused")}</p>}</div>}{error&&<p role="alert">{error}</p>}
 </Disclosure>;
}
