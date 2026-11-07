import {ProfileCleanupSettings} from './profile-privacy/ProfileCleanupSettings';
import {ProfileCleanupRecovery} from './ProfileCleanupRecovery';
import {profileCleanupClient} from '../ui/profileCleanupClient';
import {SiteInformation} from './SiteInformation';
import {ShieldsSummary} from './ShieldsSummary';
import {isTorWindow} from './tor/torClient';
import {Disclosure} from '../components/PanelParts';
import {FilterListSettings} from './FilterListSettings';
import {ContentFilterControls} from './ContentFilters';
import {CertificateNotice} from '../components/CertificateNotice';
import {useEffect,useState} from 'react';
import type {BrowserSnapshot,ServiceResult} from '../runtime/types';
import {runtime} from '../runtime/client';
import {SettingGroup,SettingRow,Switch} from './settings/controls';
import { t as tr } from '../i18n';
export {ImportPanel} from './import-export/ImportPanel';
export function SiteControls({state}:{state:BrowserSnapshot}){
 const [privacy,setPrivacy]=useState<ServiceResult['privacy']>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[changed,setChanged]=useState(false),tab=state.tabs.find(t=>t.id===state.activeTabId)!;
 useEffect(()=>{let alive=true;setPrivacy(undefined);setChanged(false);setError('');if(tab.loading||tab.error)return;void runtime.service({type:'privacy.status',tabId:tab.id}).then(result=>{if(alive)setPrivacy(result.privacy);}).catch(e=>alive&&setError(String(e)));return()=>{alive=false;};},[tab.id,tab.url,tab.loading,tab.error]);
 const set=async(blocking:boolean,scope:'site'|'temporary')=>{setBusy(true);setError('');try{const result=await runtime.service({type:'privacy.set',tabId:tab.id,blocking,scope});setPrivacy(result.privacy);setChanged(true);}catch(e){setError(String(e));}finally{setBusy(false);}};
 return <section className="site-controls" aria-label={tr("browserdata.siteControls")}><CertificateNotice tabId={tab.id} url={tab.url}/><ShieldsSummary tab={tab} tor={isTorWindow(state)||tab.privacy==='tor'}/>{tab.contentKind==="web"&&<hr className="acira-menu-sep"/>}<SiteInformation tab={tab}/><Disclosure className="site-content-filters" title={tr("cf.title")}><ContentFilterControls state={state} scope="site"/></Disclosure>{error&&<p role="alert">{error}</p>}</section>;
}
export function ProfilePrivacy({state}:{state:BrowserSnapshot}){
 const [enabled,setEnabled]=useState<boolean>(),[busy,setBusy]=useState(true),[error,setError]=useState('');
 useEffect(()=>{let alive=true;setBusy(true);setEnabled(undefined);setError('');void runtime.service({type:'privacy.status',tabId:state.activeTabId}).then(result=>{if(alive)setEnabled(result.privacy?.profileBlocking??result.privacy?.blocking??true);}).catch(e=>alive&&setError(String(e))).finally(()=>alive&&setBusy(false));return()=>{alive=false;};},[state.activeBrowserProfileId]);
 return <><SettingGroup title={tr("setup.summary.protection")}><SettingRow id="block-ads-trackers" title={tr("setup.block.title")} detail={tr("browserdata.blockDetail")}><Switch label={tr("setup.block.title")} checked={enabled??false} disabled={busy||enabled===undefined} onChange={async()=>{setBusy(true);try{const result=await runtime.service({type:'privacy.set',tabId:state.activeTabId,blocking:!enabled,scope:'profile'});setEnabled(result.privacy?.blocking??!enabled);}catch(e){setError(String(e));}finally{setBusy(false);}}}/></SettingRow></SettingGroup><ProfileCleanupRecovery profileId={state.activeBrowserProfileId} privateMode={state.browserProfiles.some(profile=>profile.private)}/><ProfileCleanupSettings client={profileCleanupClient} profileId={state.activeBrowserProfileId} profileName={state.browserProfiles.find(profile=>profile.id===state.activeBrowserProfileId)?.name} privateMode={state.browserProfiles.some(profile=>profile.private)}/><ContentFilterControls state={state}/><FilterListSettings profileId={state.activeBrowserProfileId} privateMode={state.browserProfiles.some(profile=>profile.id===state.activeBrowserProfileId&&profile.private)}/>{error&&<p className="st-error" role="alert">{error}</p>}</>;
}
