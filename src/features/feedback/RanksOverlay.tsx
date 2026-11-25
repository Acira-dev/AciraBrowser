import {useState,type KeyboardEvent} from 'react';
import {X} from '../../components/AppIcons';
import {t} from '../../i18n';
import {RANKS,useFeedbackView,type Rank} from '../../runtime/feedback';
import type {BrowserAction,BrowserSnapshot} from '../../runtime/types';
import {openSettings} from '../../ui/settingsView';
import {RankMark} from './ContributorBlock';
import {markName,pointsLabel,rankName} from './words';
import './feedback.css';

/** "View ranks" (Beta 14): inside the browser, over the page, not a new page. The four ranks in one calm row with the person's own marked; a click on a rank shows what it takes and what it gives;
 * Early Member shown apart; one sentence about points; a way to the off switch. No trophies, no game art, no figures about other people. The point figures come only from the server's own
 * thresholds (OPEN in the brief): until it has said them the line names no number. Only the display of what ranks give: the perks are not built here. */
export function RanksOverlay({state,dispatch,close}:{state:BrowserSnapshot;dispatch:(action:BrowserAction)=>void;close:()=>void}){
 // `early` is the Early Member chip under the four cards (B4, the reference design 17 Nov): chosen like a rank, its text opens in the same detail area.
 const view=useFeedbackView('ranks'),[chosen,setChosen]=useState<Rank|'early'|null>(null),shown:Rank|'early'=chosen??view.rank??'contributor';
 // The four cards and the chip are one group of five: the arrow keys (and Home/End) move through them and choose, as a radio group does.
 const arrows=(event:KeyboardEvent<HTMLDivElement>)=>{
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
  const radios=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=radio]'));
  const at=radios.indexOf(document.activeElement as HTMLButtonElement);if(at<0)return;
  event.preventDefault();
  const rtl=getComputedStyle(event.currentTarget).direction==='rtl',back=event.key==='ArrowUp'||event.key===(rtl?'ArrowRight':'ArrowLeft');
  const next=radios[event.key==='Home'?0:event.key==='End'?radios.length-1:(at+(back?-1:1)+radios.length)%radios.length];
  next.focus();next.click();
 };
 const takes=(rank:Rank)=>rank==='contributor'?t('feedback.ranks.contributor.takes'):rank==='founding'?t('feedback.ranks.founding.takes'):rank==='insider'?t('feedback.ranks.insider.takes'):view.thresholds?t('feedback.ranks.trusted.takesAt',{count:view.thresholds.trusted}):t('feedback.ranks.trusted.takes');   // Insider and Founding are by invitation: no figure, points never give them
 // Public 14.4: no rank promises a perk. Perks are coming soon and points have no cash value (the two lines under the lead); only what already exists is listed under "What it gives": the Contributor's thanks in the release notes.
 const gives=(rank:Rank):string|null=>rank==='contributor'?t('feedback.ranks.contributor.gives'):null;
 const hide=()=>{close();openSettings(state,dispatch,{setting:'contributor-show'});};
 return <section className="fb-ranks" role="dialog" aria-label={t('feedback.credit.link')}>
  <header className="fb-ranks-head"><h2 className="fb-ranks-title">{t('feedback.credit.link')}</h2><button type="button" className="menu-form-close" aria-label={t('app.close')} onClick={close}><X size={14}/></button></header>
  <p className="fb-ranks-lead">{t('feedback.ranks.lead')}</p>
  <p className="fb-ranks-lead fb-ranks-notes">{t('feedback.ranks.perksSoon')} {t('feedback.ranks.noCash')}</p>
  <div className="fb-rank-pick" role="radiogroup" aria-label={t('feedback.ranks.title')} onKeyDown={arrows}>
  <div className="fb-rank-row" data-emblem={view.emblem||undefined} data-has-mine={view.rank?'':undefined}>
   {RANKS.map((rank,index)=><button key={rank} type="button" role="radio" aria-checked={shown===rank} className="fb-rank-cell" data-mine={view.rank===rank||undefined} onClick={()=>setChosen(rank)}>
    <RankMark rank={rank} emblem={view.emblem} size={48} delay={240+index*110}/><span className="fb-rank-name"><bdi>{rankName(rank)}</bdi></span>{view.rank===rank&&<span className="fb-rank-yours">{t('feedback.ranks.yours')}</span>}
   </button>)}
  </div>
  <div className="fb-marks"><button type="button" role="radio" aria-checked={shown==='early'} className="fb-mark-chip" data-mine={view.mark&&!view.off?'':undefined} data-emblem={view.emblem||undefined} onClick={()=>setChosen('early')}><RankMark rank={null} emblem={view.emblem} size={20} delay={760}/><span className="fb-mark-name"><bdi>{markName()}</bdi>{view.mark&&!view.off&&<span className="fb-rank-yours"> · {t('feedback.ranks.yours')}</span>}</span></button></div>
  </div>
  <div className="fb-rank-detail" aria-live="polite">
   {shown==='early'?<>
    <h3 className="fb-rank-detail-name"><bdi>{markName()}</bdi></h3>
    <p className="fb-rank-about">{t('feedback.ranks.early.about')}</p>
   </>:<>
    <h3 className="fb-rank-detail-name"><bdi>{rankName(shown)}</bdi></h3>
    <dl className="fb-rank-facts"><dt className="fb-rank-fact-name">{t('feedback.ranks.takes')}</dt><dd className="fb-rank-fact">{takes(shown)}</dd>{gives(shown)&&<><dt className="fb-rank-fact-name">{t('feedback.ranks.gives')}</dt><dd className="fb-rank-fact">{gives(shown)}</dd></>}</dl>
   </>}
  </div>
  {!view.off&&view.rank&&<p className="fb-ranks-points"><span className="fb-points">{pointsLabel(view.points)}</span></p>}
  <button type="button" className="fb-link fb-ranks-off" onClick={hide}>{t('feedback.ranks.hide')}</button>
 </section>;
}
