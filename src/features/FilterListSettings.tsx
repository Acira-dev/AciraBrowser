import {useEffect,useRef,useState} from 'react';
import {runtime} from '../runtime/client';
import type {FilterListsStatus} from '../runtime/connectedServices';
import {SettingGroup,SettingNote,SettingRow} from './settings/controls';

import { t } from '../i18n';
export function FilterListSettings({profileId,privateMode=false}:{profileId:string;privateMode?:boolean}){
 const [status,setStatus]=useState<FilterListsStatus>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),generation=useRef(0);
 useEffect(()=>{const version=++generation.current;setStatus(undefined);setBusy(false);setError('');if(privateMode)return;void runtime.service({type:'filters.lists-status'}).then(result=>{if(version===generation.current)setStatus(result.filterLists);}).catch(error=>{if(version===generation.current)setError(error instanceof Error?error.message:t('filterlistsettings.statusUnavailable'));});return()=>{generation.current++;};},[profileId,privateMode]);
 const update=async(type:'filters.lists-update'|'filters.lists-rollback')=>{const version=generation.current;setBusy(true);setError('');try{const result=await runtime.service({type});if(version===generation.current)setStatus(result.filterLists);}catch(error){if(version===generation.current){setError(error instanceof Error?error.message:t('filterlistsettings.existingListActive'));const result=await runtime.service({type:'filters.lists-status'}).catch(()=>null);if(version===generation.current&&result)setStatus(result.filterLists);}}finally{if(version===generation.current)setBusy(false);}};
 return <SettingGroup title={t("privacy.protectionLists")}>
  <SettingNote>{t("filterlistsettings.bundledListsWorkOfflineAnd")}</SettingNote>
  {privateMode?<p className="st-muted">{t("filterlistsettings.manageListUpdatesFromAn")}</p>:<>
   <SettingRow id="filter-lists-update" title={t("core.updateListsNow")} detail={status?status.updatedAt?t('filterlistsettings.lastUpdate',{date:new Date(status.updatedAt).toLocaleString()}):t('filterlistsettings.usingBundled'):t('filterlistsettings.readingStatus')}><button type="button" className="st-button" aria-busy={busy} disabled={busy||!status} onClick={()=>void update('filters.lists-update')}>{busy?t('filterlistsettings.updating'):t("pw.frame.update")}</button></SettingRow>
   <SettingRow id="filter-lists-rollback" title={t("core.usePreviousLists")} detail={t('filterlistsettings.rollbackDetail')}><button type="button" className="st-button" disabled={busy||!status?.rollbackAvailable} onClick={()=>void update('filters.lists-rollback')}>{t("rewindpage.restore")}</button></SettingRow>
   <details id="filter-lists-sources" data-setting="filter-lists-sources" className="st-disclosure"><summary>{t("core.listSources")}</summary><ul className="st-source-list">{status?.lists.map(list=><li key={list.id}><strong>{list.title}</strong><span>{new URL(list.url).hostname} · {Math.round(list.bytes/1024).toLocaleString()} KB</span></li>)}</ul><p className="st-muted">{t("filterlistsettings.reloadWebsitesToApplyUpdated")}</p></details>
   {(error||status?.lastError)&&<p className="st-error" role="alert">{error||status?.lastError}</p>}
  </>}
 </SettingGroup>;
}
