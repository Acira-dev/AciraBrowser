import {useEffect,useRef,useState,type KeyboardEvent} from 'react';
import {Check} from './AppIcons';
import {useNewTabPreferences,selectedArtwork,artworkCatalog as workspaceCovers,type CatalogArtwork} from '../ui/newTabPreferences';
import {usePersonalArtwork} from '../ui/usePersonalArtwork';
import {useArtworkDay} from '../ui/useArtworkDay';
import {runtime} from '../runtime/client';
import type {PersonalArtwork} from '../runtime/connectedServices';
import {artworkCollectionChoice,artworkCollectionOptions,coverView,personalCovers,showMyArtworks,type ArtworkCollection,type CoverView} from '../ui/artworkCollections';
import {useRemoteArtwork} from '../ui/useRemoteArtwork';
import {t,translateText} from '../i18n';
import {DotMatrix} from './DotMatrix';
import './WorkspaceCoverPicker.css';

/** Settings › Accessibility › reduce motion, as the app root carries it (this picker also lives in the overlay, outside App's state). */
const reducedMotion=()=>document.querySelector('.app')?.getAttribute('data-reduced-motion')==='true';

export function WorkspaceCoverPicker({profileId,privateMode=false,compact=false,showVisibility=true,personalAssets,personalPending=false}:{profileId:string;privateMode?:boolean;compact?:boolean;showVisibility?:boolean;personalAssets?:PersonalArtwork[];personalPending?:boolean}){
 const [prefs,update]=useNewTabPreferences(profileId,privateMode),visible=prefs.modules.artwork;
 const personal=usePersonalArtwork(profileId,privateMode,personalAssets===undefined&&Boolean(runtime.platform)),assets=personalAssets??personal.assets;
 const day=useArtworkDay(prefs.daily||prefs.hourly,prefs.hourly),selected=selectedArtwork(prefs,profileId,day,assets);
 const pending=personalAssets===undefined?personal.pending:personalPending;
 const [gallery]=useState(()=>crypto.randomUUID());
 const mine=personalCovers(assets),listed=showMyArtworks(assets.length,prefs.artwork,privateMode),[browsingMine,setBrowsingMine]=useState(false),view:CoverView=coverView(prefs.collection,prefs.artwork,browsingMine,listed);
 const options:{value:CoverView;label:string}[]=[...artworkCollectionOptions().filter(item=>!privateMode||item.value==='built-in'),...(listed?[{value:'personal' as const,label:t('ntp.personal')}]:[])];
 const choices:CatalogArtwork[]=view==='personal'?mine:workspaceCovers;
 // Acira's own covers have names in the catalog; paintings keep their museum titles and personal images their file names.
 const coverName=(cover:CatalogArtwork)=>view==='personal'?cover.name:translateText(cover.name);
 const choose=(value:CoverView)=>{
  if(value==='personal'){setBrowsingMine(true);if(!prefs.artwork.startsWith('personal:')&&mine[0])setImage(mine[0].id);return;}
  setBrowsingMine(false);update({...artworkCollectionChoice(value,prefs.artwork),modules:{...prefs.modules,artwork:true}});
 };
 const setVisible=(artwork:boolean)=>update({modules:{...prefs.modules,artwork}});
 const setImage=(artwork:string)=>update({artwork,daily:false,perTab:false,hourly:false,collection:'built-in',modules:{...prefs.modules,artwork:true}});
 const keyboard=(event:KeyboardEvent<HTMLDivElement>)=>{
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
  const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=radio]'));
  const current=buttons.indexOf(document.activeElement as HTMLButtonElement);if(current<0)return;
  event.preventDefault();event.stopPropagation();
  const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+buttons.length)%buttons.length;
  setImage(choices[next].id);buttons[next]?.focus();
 };
 return <div className={`workspace-cover-picker${compact?' is-compact':''}`}>
  <label className="workspace-cover-collection"><span>{t('ntp.collection')}</span><select aria-label={t('ntp.collection')} value={view} onChange={event=>choose(event.target.value as CoverView)}>{options.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
  {showVisibility&&<label className="workspace-cover-visibility"><span>{t('local.showWorkspaceCover')}</span><input type="checkbox" checked={visible} onChange={event=>setVisible(event.target.checked)}/></label>}
  {view==='built-in'||view==='personal'?<div className="workspace-cover-grid" role="radiogroup" aria-label={t('local.workspaceCover')} onKeyDown={keyboard}>
   {choices.map((cover,index)=><button key={cover.id} type="button" role="radio" aria-checked={selected.id===cover.id} aria-label={t('local.namedWorkspaceCover', { name: coverName(cover) })} tabIndex={(choices.some(item=>item.id===selected.id)?selected.id===cover.id:index===0)?0:-1} onClick={()=>setImage(cover.id)}>
    <CoverThumbnail src={cover.src} position={cover.objectPosition||cover.position} selected={selected.id===cover.id} eager={index<12}/><span>{coverName(cover)}</span>
   </button>)}
  </div>:<div className="workspace-cover-grid" role="radiogroup" aria-label={t('local.workspaceCover')} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=radio]:not(:disabled)')];if(!buttons.length)return;event.preventDefault();const at=buttons.indexOf(document.activeElement as HTMLButtonElement),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(at+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+buttons.length)%buttons.length;buttons[next]?.focus();buttons[next]?.click();}}>
   {Array.from({length:6},(_,index)=>{const seed=`cover-${gallery}-${index}`;return <RemoteCover key={prefs.collection+seed} collection={prefs.collection} seed={seed} profileId={profileId} selected={prefs.collectionSeed===seed} enabled={!privateMode} onChoose={()=>update({collectionSeed:seed,collectionExcludeId:'',daily:false,perTab:false,hourly:false,modules:{...prefs.modules,artwork:true}})}/>;})}
  </div>}
  {prefs.artwork.startsWith('personal:')&&!assets.some(item=>'personal:'+item.id===prefs.artwork)&&<p className="workspace-cover-notice" role="status">{pending?t('local.personalCoverLoading'):t('local.personalCoverMissing')}</p>}
  {personalAssets===undefined&&personal.error&&<p className="workspace-cover-notice" role="alert">{personal.error}</p>}
 </div>;
}

/** Preview requests use exactly the seed the new-tab page will use after selection. */
function RemoteCover({collection,seed,profileId,selected,enabled,onChoose}:{collection:ArtworkCollection;seed:string;profileId:string;selected:boolean;enabled:boolean;onChoose:()=>void}){
 const remote=useRemoteArtwork(collection,profileId+'fixed|'+seed,enabled),picture=remote.picture;
 return <button type="button" role="radio" aria-checked={selected} aria-label={picture?.name||t(remote.failed?'dl.retry':'app.loading')} disabled={!picture&&!remote.failed} onClick={remote.failed?remote.retry:onChoose}>
  <CoverThumbnail key={picture?.src} src={picture?.src} failed={remote.failed} selected={selected} eager/><span>{picture?.name||(remote.failed?t('dl.retry'):' ')}</span>
 </button>;
}

const fadeMs=180;

/** The grid draws a small copy of each picture (desktop/artwork-thumbs.cjs): a 2560px painting or 3840px collection photo is never decoded for a tile about 200px wide. Anything else (illustrations, personal images) is its own file. */
const tileSource=(src:string)=>{
 const painting=/(?:^|\/\/ui)\/artwork\/catalog-v2\/([a-z][a-z0-9-]*)\.jpg$/.exec(src);if(painting)return `/artwork-t/${painting[1]}.jpg`;
 const photo=/^(acira-browser-ui:\/\/ui)\/artwork-remote\/([^/?#]+)$/.exec(src);return photo?`${photo[1]}/artwork-t/remote/${photo[2]}`:src;
};

/** One thumbnail. The dot matrix stands in it at once, with nothing behind the dots, and the picture fades in over it as soon as it has decoded; a picture that is already cached skips straight to itself. */
function CoverThumbnail({src:full,position,failed=false,selected,eager=false}:{src?:string;position?:string;failed?:boolean;selected:boolean;eager?:boolean}){
 const src=full?tileSource(full):undefined;
 const [decoded,setDecoded]=useState(''),[gone,setGone]=useState(false),[near,setNear]=useState(eager),box=useRef<HTMLSpanElement>(null),ready=Boolean(src)&&decoded===src,waiting=!failed&&!gone;
 /* Dots are drawn for the tiles in view (the first rows, then any scrolled near): 84 canvases mounting with the popup cost its first frame ~15ms. */
 useEffect(()=>{
  if(near||ready||!box.current)return;
  const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setNear(true);observer.disconnect();}},{rootMargin:'160px'});
  observer.observe(box.current);return()=>observer.disconnect();
 },[near,ready]);
 useEffect(()=>{
  if(!ready)return;
  const timer=window.setTimeout(()=>setGone(true),reducedMotion()?0:fadeMs+40);
  return()=>window.clearTimeout(timer);
 },[ready]);
 const settle=(node:HTMLImageElement,at:string)=>{void node.decode().catch(()=>{}).then(()=>setDecoded(at));};
 return <span ref={box} className="workspace-cover-thumbnail" data-loading={waiting||undefined} data-ready={ready||undefined}>
  {src&&<img src={src} style={position?{objectPosition:position}:undefined} alt="" loading="lazy" decoding="async" width="240" height="92" ref={node=>{if(node?.complete&&node.naturalWidth&&decoded!==src){setDecoded(src);setGone(true);}}} onLoad={event=>settle(event.currentTarget,src)} onError={()=>setDecoded(src)}/>}
  {waiting&&near&&<span className="workspace-cover-loader" data-state={ready?'out':'in'} aria-hidden="true"><DotMatrix preset="loader" size={24} bare reducedMotion={reducedMotion()}/></span>}
  {selected&&<span className="workspace-cover-check"><Check size={12} strokeWidth={2.25}/></span>}
 </span>;
}
