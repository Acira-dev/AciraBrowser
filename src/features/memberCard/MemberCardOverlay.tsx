import {useEffect,useRef,useState} from 'react';
import {Copy,Download,Video,X} from '../../components/AppIcons';
import {t} from '../../i18n';
import type {BrowserSnapshot} from '../../runtime/types';
import {cardFileName,memberCardLayout} from './cardData';
import {MemberCard} from './MemberCard';
import type {CardHandle} from './renderer/index';
import {copyCardImage,saveCardPicture,saveCardVideo,type ShareResult} from './share';
import {useMemberCardData} from './useMemberCardData';
import './member-card.css';

/** "Your card" (Beta 14): the person's member card, large, turning with the pointer, and the three things to do with it: Copy image, Save picture, Save video.
 * The saved and copied picture is the flat, front-on card; the video is one slow tilt. */
export function MemberCardOverlay({state,profileId,close}:{state:BrowserSnapshot;profileId:string;close:()=>void}){
 const data=useMemberCardData(state,profileId),card=useRef<CardHandle|null>(null);
 /* Read once, when it opens: the popup sizes itself to its content afterwards (memberCardLayout: the same rule gave the popup its opening height). */
 const [{width:cardWidth,compact}]=useState(()=>memberCardLayout(window.innerHeight));
 const [ready,setReady]=useState(false),[busy,setBusy]=useState<null|'copy'|'picture'|'video'>(null),[note,setNote]=useState<{text:string;bad:boolean}>({text:'',bad:false});
 const run=async(kind:'copy'|'picture'|'video',work:(live:CardHandle)=>Promise<ShareResult>,done:string)=>{
  const live=card.current;if(!live||busy)return;
  setBusy(kind);setNote({text:kind==='video'?t('memberCard.working'):'',bad:false});
  try{const result=await work(live);setNote(result.ok?{text:done,bad:false}:result.reason==='cancelled'?{text:'',bad:false}:{text:t('memberCard.failed'),bad:true});}
  catch{setNote({text:t('memberCard.failed'),bad:true});}
  finally{setBusy(null);}
 };
 const base=data?cardFileName(data.rank,data.name):'Acira-card';
 return <section className="mc-sheet" data-compact={compact||undefined} role="dialog" aria-label={t('memberCard.title')}>
  <header className="fb-ranks-head"><h2 className="fb-ranks-title">{t('memberCard.title')}</h2><button type="button" className="menu-form-close" aria-label={t('app.close')} onClick={close}><X size={14}/></button></header>
  <div className="mc-stage">{data&&<MemberCard rank={data.rank} name={data.name} since={data.since} number={data.number} interactive width={cardWidth} onCard={live=>{card.current=live;setReady(!!live);}}/>}</div>
  <div className="mc-actions">
   <button type="button" className="acira-button" disabled={!data||!ready||!!busy} onClick={()=>void run('copy',async live=>copyCardImage(await live.exportFlat(1200)),t('memberCard.copied'))}><Copy size={14}/><span className="mc-btn-label">{t('memberCard.copy')}</span></button>
   <button type="button" className="acira-button" disabled={!data||!ready||!!busy} onClick={()=>void run('picture',async live=>saveCardPicture(await live.exportFlat(1600),`${base}.png`),t('memberCard.pictureSaved'))}><Download size={14}/><span className="mc-btn-label">{t('memberCard.savePicture')}</span></button>
   <button type="button" className="acira-button" disabled={!data||!ready||!!busy} onClick={()=>void run('video',async live=>saveCardVideo(await live.recordTilt({seconds:6,width:720}),`${base}.webm`),t('memberCard.videoSaved'))}><Video size={14}/><span className="mc-btn-label">{t('memberCard.saveVideo')}</span></button>
  </div>
  <p className="mc-note popup-status" role="status" aria-live="polite" data-bad={note.bad||undefined}>{note.text}</p>
 </section>;
}
