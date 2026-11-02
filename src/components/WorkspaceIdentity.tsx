import {AnimatePresence,motion} from 'motion/react';
import {useEffect,useState,type CSSProperties} from 'react';
import type {WorkspaceArtwork} from '../ui/newTabPreferences';
import {ChevronDown} from './AppIcons';
import './WorkspaceIdentity.css';

/** Keep the heading, profile and search stable while the selected painting folds. */
export function WorkspaceIdentity({name,profileName,cover,visible,showHeading=true,onToggle,onProfile,onChooseCover,reduced}:{
 name:string;profileName:string;cover:WorkspaceArtwork;visible:boolean;showHeading?:boolean;reduced:boolean;
 onToggle:()=>void;onProfile:(target:HTMLButtonElement)=>void;onChooseCover:(target:HTMLButtonElement)=>void;
}){
 const transition={type:'tween' as const,duration:reduced?0:.52,ease:[.16,1,.3,1] as const};
 const [painting,setPainting]=useState(cover);
 useEffect(()=>{
  if(!visible||cover.src===painting.src)return;
  let cancelled=false;
  const image=new Image();image.src=cover.src;
  // Keep the painted image until its replacement is decoded. Rapid choices
  // cancel stale loads and continue the current blend without a blank frame.
  void image.decode().then(()=>{if(!cancelled)setPainting(cover);}).catch(()=>{});
  return()=>{cancelled=true;};
 },[cover,painting.src,visible]);
 const zoom=painting.id.startsWith('met-')?1.06:1;
 const hidden=!showHeading&&!visible;
 // One reversible progress value keeps the painting, material and ink in step
 // with the collapsing layout, including a toggle before the fold finishes.
 return <motion.section className={`ed-workspace-identity workspace-identity has-cover${showHeading?' has-label':''}`} aria-label="Workspace" aria-hidden={hidden||undefined} inert={hidden||undefined} style={{'--workspace-cover-position':cover.position||'50% 50%'} as CSSProperties} initial={false} animate={{height:visible?176:showHeading?76:0,marginBottom:hidden?0:16,'--workspace-cover-progress':visible?1:0}} transition={transition}>
  <div className="ed-workspace-cover" role="img" aria-label={painting.alt} aria-hidden={!visible||undefined}>
   <AnimatePresence initial={false}>
    {visible&&<motion.img key={painting.id} className="workspace-cover-image" src={painting.src} style={{objectPosition:painting.position||'50% 50%'}} alt="" aria-hidden="true" width="720" height="176"
     initial={{opacity:0,scale:zoom*1.035,filter:'blur(6px)'}} animate={{opacity:1,scale:zoom,filter:'blur(0px)'}} exit={{opacity:1,scale:zoom*1.015,filter:'blur(4px)'}}
     transition={{duration:reduced?0:.6,ease:[.16,1,.3,1]}}/>}
   </AnimatePresence>
  </div>
  <div className="workspace-cover-actions">
   <button type="button" className="workspace-cover-action" data-popup-trigger aria-label="Change workspace cover" onClick={event=>onChooseCover(event.currentTarget)}>Change cover</button>
   <button type="button" className="workspace-cover-action" aria-label={visible?'Hide workspace cover':'Show workspace cover'} aria-expanded={visible} onClick={onToggle}>{visible?'Hide cover':'Show cover'}</button>
  </div>
  {showHeading&&<header className="ed-start-heading">
   <h1>{name}</h1><button type="button" className="ed-workspace-profile" data-popup-trigger aria-label={`Browsing profile: ${profileName}. Switch profile`} onClick={event=>onProfile(event.currentTarget)}><span className="ed-profile-initial">{profileName[0]||'P'}</span><span>{profileName}</span><ChevronDown size={12}/></button>
  </header>}
 </motion.section>;
}
