import { useEffect,useRef,useState } from 'react';
import { runtime } from '../runtime/client';
import type { ExtensionRequest,ExtensionsSnapshot,TabSession } from '../runtime/types';
import {BrowserExtensionActions} from './BrowserExtensionActions';
import {useExtensionToolbar} from '../ui/useExtensionToolbar';
import { FolderOpen,RefreshCw,Trash2 } from './AppIcons';
import './ExtensionManager.css';
import { ExtensionsIcon } from './ToolbarIcon';
import {ActionRow,Disclosure} from './PanelParts';
import {MenuFormFlyout} from './MenuFormFlyout';

import { t } from '../i18n';
const compatWord=(status:string)=>status==='works'?t('extensionmanager.testedWorks'):status==='limited'?t('extensionmanager.testedLimited'):t('extensionmanager.testedUnsupported');
/** Installed extensions first, a "Get extensions" link to the Chrome Web Store, and local-folder loading tucked under Developer. */
export function ExtensionManager({profileId,profileName,tab,privateMode=false,onGetExtensions,onKeyboardShortcuts,panel=false}:{profileId:string;profileName:string;tab?:TabSession;privateMode?:boolean;onGetExtensions?:()=>void;onKeyboardShortcuts?:()=>void;panel?:boolean}){
 const [snapshot,setSnapshot]=useState<ExtensionsSnapshot|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [storeInput,setStoreInput]=useState(''),[storeError,setStoreError]=useState(''),target=useExtensionToolbar(tab||null);
 const currentProfile=useRef(profileId);currentProfile.current=profileId;
 const requestVersion=useRef(0);
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 async function request(command:ExtensionRequest){const version=++requestVersion.current;const current=()=>mounted.current&&currentProfile.current===command.profileId&&version===requestVersion.current;setBusy(true);setError('');setStoreError('');try{const result=await runtime.extensions(command);if(current()){setSnapshot(result);if(command.type==='install')setStoreError(result.error||'');return result;}}catch(error){if(current())(command.type==='install'?setStoreError:setError)(error instanceof Error?error.message:t('ext.errorRead'));}finally{if(current())setBusy(false);}}
 useEffect(()=>{setSnapshot(null);setStoreInput('');setStoreError('');setError('');if(!privateMode)void request({type:'list',profileId});},[profileId,privateMode]);
 if(privateMode)return <section className="extension-manager" aria-label={t("extensionmanager.extensionsManager")}>{target?.supported&&target.actionIds.length>0&&<div className="extension-popup-actions"><span>{t("extensionmanager.openAnExtension")}</span><BrowserExtensionActions limit={100} target={{...target,pinnedIds:target.actionIds}}/></div>}<p>{t("extensionmanager.extensionsAreOffInPrivate")}</p></section>;
 const ready=Boolean(snapshot?.supported);
 const addFromLink=()=>{if(busy||!ready)return;const raw=storeInput.trim();let id=/^[a-p]{32}$/.test(raw)?raw:'';if(!id)try{const url=new URL(raw);if(url.protocol==='https:'&&url.hostname==='chromewebstore.google.com'&&!url.username&&!url.password)id=url.pathname.match(/\/([a-p]{32})\/?$/)?.[1]||'';}catch{}if(!id){setStoreError(t('ext.errorPaste'));return;}void request({type:'install',profileId,extensionId:id});};
 if(panel){
  // The toolbar popup: rows of the one panel system (panels.css). No title bar; text on x = 36; groups split by one fade-ended divider.
  // R3-38: inside a secured workspace no extension runs (main loads none into its session and lets none see its tabs): the list says so.
  const list=snapshot?.extensions??[],note=error||snapshot?.error||'',secured=tab?.privacy==='secured';
  return <section className="extension-panel" aria-label={t("browsermenu.extensions")} aria-busy={busy} data-popup-pending={!snapshot&&!error||undefined}>
   {target?.supported&&target.actionIds.length>0&&<><div className="acira-menu-label">{t("main.open")}</div><div className="extension-panel-actions"><BrowserExtensionActions limit={100} target={{...target,pinnedIds:target.actionIds}}/></div><hr className="acira-menu-sep"/></>}
   {secured&&<p className="extension-panel-note" role="status" data-secured="">{t("extensionmanager.securedOff")}</p>}
   {note&&<p className="extension-panel-note" role="alert">{note}</p>}
   {!snapshot&&!error&&<p className="extension-panel-note" role="status">{t("extensionmanager.readingExtensions")}</p>}
   {snapshot&&!list.length&&<div className="acira-menu-row acira-menu-row-identity"><ExtensionsIcon size={16} className="acira-menu-icon"/><span className="acira-menu-title">{t("extensionmanager.noExtensionsYet")}<span className="acira-menu-sub">{t("extensionmanager.addThemFromTheChrome")}</span></span><span/></div>}
   {list.map(extension=><Disclosure key={extension.id} className="acira-extension" icon={<ExtensionsIcon size={16} className="acira-menu-icon"/>} title={extension.name} sub={t('extensionmanager.versionStatus',{version:extension.version,status:secured&&extension.enabled?t('extensionmanager.unavailableHere'):extension.status==='loaded'?t('extensionmanager.on'):extension.status==='disabled'?t('extensionmanager.off'):t('extensionmanager.unavailable')})+(extension.compat?' · '+compatWord(extension.compat.status):'')}>
    <ActionRow label={extension.enabled?t("extensionmanager.turnOff"):t("antiTracking.turnOn")} disabled={busy} onClick={()=>void request({type:extension.enabled?'disable':'enable',profileId,extensionId:extension.id})}/>
    {extension.hasAction&&<ActionRow label={extension.pinned?t("extensionmanager.unpinFromToolbar"):t("extensionmanager.pinToToolbar")} disabled={busy||!extension.enabled} onClick={()=>void request({type:'pin',profileId,extensionId:extension.id,pinned:!extension.pinned})}/>}
    <ActionRow label={extension.source==='Chrome Web Store'?t("extensionmanager.checkForUpdate"):t("error.reload")} disabled={busy||!extension.enabled} onClick={()=>void request({type:extension.source==='Chrome Web Store'?'update':'reload',profileId,extensionId:extension.id})}/>
    <ActionRow label={t("acirasidebar.remove")} danger disabled={busy} onClick={()=>void request({type:'remove',profileId,extensionId:extension.id})}/>
    <Disclosure className="acira-nested" title={t("extensionmanager.whatItCanAccess")}>{(extension.access??extension.permissions).length?<ul>{(extension.access??extension.permissions).map(line=><li key={line}>{line}</li>)}</ul>:<p>{t("extensionmanager.itAsksForNoSpecial")}</p>}<p>{t("extensionmanager.itCannotOpenFilesOn")}</p></Disclosure>
    {extension.compat&&<p className="extension-panel-note" data-compat={extension.compat.status}>{t("extensionmanager.compatInAcira", { status: compatWord(extension.compat.status) })} {extension.compat.note}</p>}
    {extension.error&&<p className="extension-panel-note">{extension.error}</p>}
    {extension.supportWarnings?.map(warning=><p className="extension-panel-note" key={warning}>{warning}</p>)}
   </Disclosure>)}
   <hr className="acira-menu-sep"/>
   {onGetExtensions&&<ActionRow label={t("extensionmanager.getExtensions")} onClick={onGetExtensions}/>}
   <MenuFormFlyout title={t("extensionmanager.addFromAWebStore")}>
    {close=><form className="menu-form-fields" aria-busy={busy} onSubmit={event=>{event.preventDefault();addFromLink();}}>
     <label>{t("extensionmanager.chromeWebStoreLink")}<input autoFocus value={storeInput} maxLength={4096} placeholder="https://chromewebstore.google.com/…" spellCheck={false} autoComplete="off" aria-invalid={!!storeError||undefined} aria-describedby={storeError?'extension-link-error':undefined} onChange={event=>{setStoreInput(event.target.value);setStoreError('');}} disabled={busy||!ready}/></label>
     {storeError&&<p id="extension-link-error" className="menu-form-error" role="alert">{storeError}</p>}
     {!ready&&<p role="status">{snapshot?.supportNote||t("extensionmanager.readingExtensions")}</p>}
     {busy&&<p role="status">{t("extensionmanager.pleaseWait")}</p>}
     <div className="menu-form-actions"><button type="button" className="acira-button" onClick={close}>{t("dialog.cancel")}</button><button type="submit" className="acira-button acira-button-primary" disabled={busy||!ready||!storeInput.trim()}>{busy?t("extensionmanager.pleaseWait"):t("searchEngines.add")}</button></div>
    </form>}
   </MenuFormFlyout>
   {onKeyboardShortcuts&&<ActionRow label={t("nativeCore.keyboardShortcuts")} onClick={onKeyboardShortcuts}/>}
   <MenuFormFlyout title={t("extensionmanager.developerToolsLoadAnUnpacked")}>{close=><><p>{t("extensionmanager.loadAnExtensionYouAre")}</p>{error&&<p className="menu-form-error" role="alert">{error}</p>}<div className="menu-form-actions"><button type="button" className="acira-button" onClick={close}>{t("dialog.cancel")}</button><button type="button" className="acira-button acira-button-primary" disabled={busy||!ready} onClick={()=>void request({type:'load',profileId})}>{busy?t("extensionmanager.pleaseWait"):t("extensionmanager.loadFromFolder")}</button></div></>}</MenuFormFlyout>
  </section>;
 }
 return <section className="extension-manager" aria-label={t("extensionmanager.extensionsManager")} aria-busy={busy}>
  <div className="extension-profile"><span>{t("extensionmanager.extensionsFor")}</span><strong>{profileName}</strong><button className="icon-button" aria-label={t("extensionmanager.refreshExtensions")} disabled={busy} onClick={()=>void request({type:'list',profileId})}><RefreshCw size={16}/></button></div>
  {target?.supported&&target.actionIds.length>0&&<div className="extension-popup-actions"><span>{t("extensionmanager.openAnExtension")}</span><BrowserExtensionActions limit={100} target={{...target,pinnedIds:target.actionIds}}/></div>}
  {(error||storeError||snapshot?.error)&&<p className="extension-error" role="alert">{error||storeError||snapshot?.error}</p>}
  {!snapshot&&!error&&<p className="extension-empty" role="status">{t("extensionmanager.readingExtensions")}</p>}
  {snapshot&&!snapshot.extensions.length&&<div className="extension-empty"><strong>{t("extensionmanager.noExtensionsYet")}</strong><span>{t("extensionmanager.addThemFromTheChrome")}</span>{onGetExtensions&&<button type="button" className="btn extension-get-btn" onClick={onGetExtensions}>{t("extensionmanager.getExtensions")}</button>}</div>}
  <div className="extension-list">{snapshot?.extensions.map(extension=><article className="extension-row" key={extension.id}>
   <div className="extension-heading"><ExtensionsIcon size={18}/><div><strong>{extension.name}</strong><span>{t("extensionmanager.versionStatus", { version: extension.version, status: extension.status==='loaded'?t("extensionmanager.on"):extension.status==='disabled'?t("extensionmanager.off"):t("extensionmanager.unavailable") })}</span></div><button className="icon-button" disabled={busy} aria-label={t("extensionmanager.removeNamed", { name: extension.name })} onClick={()=>void request({type:'remove',profileId,extensionId:extension.id})}><Trash2 size={16}/></button></div>
   <div className="extension-controls"><button type="button" className="btn" disabled={busy} onClick={()=>void request({type:extension.enabled?'disable':'enable',profileId,extensionId:extension.id})}>{extension.enabled?t("extensionmanager.turnOff"):t("antiTracking.turnOn")}<span className="sr-only"> {extension.name}</span></button>{extension.hasAction&&<button type="button" className="btn" aria-pressed={extension.pinned??false} disabled={busy||!extension.enabled} onClick={()=>void request({type:'pin',profileId,extensionId:extension.id,pinned:!extension.pinned})}>{extension.pinned?t("extensionmanager.unpin"):t('ext.pin')}<span className="sr-only"> {extension.name}</span></button>}<button type="button" className="btn" disabled={busy||!extension.enabled} onClick={()=>void request({type:extension.source==='Chrome Web Store'?'update':'reload',profileId,extensionId:extension.id})}>{extension.source==='Chrome Web Store'?t("extensionmanager.checkForUpdate"):t("error.reload")}<span className="sr-only"> {extension.name}</span></button>{extension.wantsUserScripts&&<button type="button" className="btn" role="switch" aria-checked={extension.userScriptsAllowed??false} disabled={busy||!extension.enabled} onClick={()=>void request({type:'userScripts',profileId,extensionId:extension.id,allowed:!extension.userScriptsAllowed})}>{t("extensionmanager.allowUserScripts")}: {extension.userScriptsAllowed?t("extensionmanager.on"):t("extensionmanager.off")}<span className="sr-only"> {extension.name}</span></button>}{extension.overridesNewTab&&<button type="button" className="btn" role="switch" aria-checked={extension.newTabChosen??false} disabled={busy||!extension.enabled} onClick={()=>void request({type:'newTab',profileId,extensionId:extension.id,allowed:!extension.newTabChosen})}>{t("extensionmanager.useAsNewTab")}: {extension.newTabChosen?t("extensionmanager.on"):t("extensionmanager.off")}<span className="sr-only"> {extension.name}</span></button>}<button type="button" className="btn" role="switch" aria-checked={extension.privateAllowed??false} disabled={busy||!extension.enabled} onClick={()=>void request({type:'private',profileId,extensionId:extension.id,allowed:!extension.privateAllowed})}>{t("extensionmanager.allowInPrivate")}: {extension.privateAllowed?t("extensionmanager.on"):t("extensionmanager.off")}<span className="sr-only"> {extension.name}</span></button></div>
   {extension.wantsUserScripts&&<p>{t("extensionmanager.userScriptsHint")}</p>}{extension.overridesNewTab&&<p>{t("extensionmanager.newTabHint")}</p>}
   {extension.description&&<p>{extension.description}</p>}
   {extension.compat&&<p className="extension-compat" data-compat={extension.compat.status}><strong>{t("extensionmanager.compatInAcira", { status: compatWord(extension.compat.status) })}</strong> {extension.compat.note}</p>}
   {extension.error&&<p className="extension-error">{extension.error}</p>}
   {extension.source&&<p>{extension.source}{extension.packageVerified?t("extensionmanager.verified"):''}</p>}
   {extension.supportWarnings?.map(warning=><p key={warning}>{warning}</p>)}
   <details><summary>{t("extensionmanager.whatItCanAccess")}</summary>{(extension.access??extension.permissions).length?<ul>{(extension.access??extension.permissions).map(line=><li key={line}>{line}</li>)}</ul>:<p>{t("extensionmanager.itAsksForNoSpecial")}</p>}<small>{t("extensionmanager.itCannotOpenFilesOn")}</small></details>
  </article>)}</div>
  <div className="extension-get">
   {onGetExtensions&&Boolean(snapshot?.extensions.length)&&<button type="button" className="btn extension-get-btn" onClick={onGetExtensions}>{t("extensionmanager.getExtensions")}</button>}
   <form className="extension-store-form" onSubmit={event=>{event.preventDefault();addFromLink();}}><label>{t("extensionmanager.addFromALink")}<input value={storeInput} maxLength={4096} placeholder={t("extensionmanager.chromeWebStoreLink")} onChange={event=>setStoreInput(event.target.value)} disabled={busy||!ready}/></label><button className="btn" disabled={busy||!ready||!storeInput.trim()}>{t("searchEngines.add")}</button></form>
  </div>
  <details className="extension-dev"><summary>{t("main.developer")}</summary><p>{t("extensionmanager.loadAnExtensionYouAre")}</p><button className="btn extension-load" disabled={busy||!ready} onClick={()=>void request({type:'load',profileId})}><FolderOpen size={17}/>{busy?t("extensionmanager.pleaseWait"):t("extensionmanager.loadFromFolder")}</button></details>
  <p className="extension-support">{t("extensionmanager.extensionsAreKeptSeparatelyFor")}</p>
 </section>;
}
