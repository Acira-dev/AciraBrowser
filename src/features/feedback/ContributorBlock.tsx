import {useEffect,useId,useState,type ReactNode} from 'react';
import {ChevronLeft,ChevronRight,KeyRound,Layers3,Mail,MessageSquare,Sparkles,X} from '../../components/AppIcons';
import {t} from '../../i18n';
import {feedbackAct,useFeedbackView,type FeedbackNote,type FeedbackView} from '../../runtime/feedback';
import type {BrowserAction} from '../../runtime/types';
import {awayLine,markName,noteLines,pointsLabel,rankName,statusLine} from './words';
import {RankEmblem} from './RankEmblem';
import {Seal,type SealKind} from './Seal';
import {askInsider} from '../insider/insiderFlow';
import {hasMemberCard} from '../memberCard/useMemberCardData';
import type {EmblemDirection} from './rankEmblems';
import './feedback.css';

/** The rank's mark (Beta 14): its holographic seal (Seal.tsx; null is the Early Member mark). The earlier rank-emblem drawings stay selectable in code for a test profile (the view names a direction); no
 * shipped build names one. `size` is the mark's box: the seal's full render from 48 px, its small form below. `delay` waits for the pop-up's own reveal (emblems only). */
export const RankMark=({rank,emblem,size,delay=0}:{rank:string|null;emblem:EmblemDirection|null;size:number;delay?:number})=>emblem?<RankEmblem direction={emblem} rank={(rank||'earlyMember') as 'earlyMember'|'contributor'|'trusted'|'insider'|'founding'} size={size} delay={delay}/>:<Seal kind={(rank||'early') as SealKind} size={size}/>;

/** One note: the lines the server's event earned, in order; a name field when it asks; a way to put it away. */
function Note({note,view,onDismiss}:{note:FeedbackNote;view:FeedbackView;onDismiss:()=>void}){
 const emblem=view.emblem;
 const [name,setName]=useState(''),[busy,setBusy]=useState(false),[problem,setProblem]=useState(''),nameId=useId(),lines=noteLines(note,view.reports);
 const answer=async(value:string|null)=>{setBusy(true);setProblem('');const result=await feedbackAct({type:'feedback.thanks',noteId:note.id,name:value});if(!result.ok){setProblem(t('feedback.note.offline'));setBusy(false);}};
 return <div className="fb-note" role="group" data-emblem={emblem&&note.rank?'':undefined}>
  {emblem&&note.rank&&<span className="fb-note-emblem"><RankEmblem direction={emblem} rank={note.rank} size={44} delay={260} maxSpread={1.15}/></span>}
  <div className="fb-note-lines">{lines.map((line,index)=><p key={index} className="fb-note-line" data-first={index===0||undefined}>{line}</p>)}</div>
  {note.askName&&<div className="fb-note-ask">
   <label className="fb-note-ask-label" htmlFor={nameId}>{t('feedback.note.thanks')}</label>
   <input id={nameId} className="fb-note-ask-input" value={name} maxLength={40} placeholder={t('feedback.note.thanks.name')} disabled={busy} onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&name.trim()&&!busy){event.preventDefault();void answer(name.trim());}}}/>
   <div className="fb-note-buttons"><button type="button" className="acira-button" disabled={busy} onClick={()=>void answer(null)}>{t('feedback.note.thanks.no')}</button><button type="button" className="acira-button acira-button-primary" disabled={busy||!name.trim()} onClick={()=>void answer(name.trim())}>{t('feedback.note.thanks.yes')}</button></div>
   {problem&&<p className="fb-problem" role="alert">{problem}</p>}
  </div>}
  {!note.askName&&<button type="button" className="fb-note-dismiss" aria-label={t('feedback.note.dismiss')} title={t('feedback.note.dismiss')} onClick={onDismiss}><X size={12}/></button>}
 </div>;
}

/** Your reports: what this profile sent, newest first, each with its coarse status. Never plans or dates. */
export function MyReports({onBack}:{onBack:()=>void}){
 const view=useFeedbackView('reports');
 return <div className="fb-reports" role="group" aria-label={t('feedback.reports.title')}>
  <button type="button" className="acira-menu-row acira-menu-row-identity fb-back" onClick={onBack}><ChevronLeft className="acira-menu-icon" size={16}/><span className="acira-menu-title">{t('feedback.reports.title')}</span><span/></button>
  <hr className="acira-menu-sep"/>
  {view.reports.length===0?<p className="fb-empty">{t('feedback.reports.empty')}</p>:<ul className="fb-report-list">{view.reports.map(report=><li key={report.id} className="fb-report" data-status={report.status}>
   <span className="fb-report-text"><bdi>{report.snippet||t(report.kind==='idea'?'feedback.kind.idea':'feedback.kind.bug')}</bdi></span>
   <span className="fb-report-meta"><span>{t(report.kind==='idea'?'feedback.kind.idea':'feedback.kind.bug')}</span><span aria-hidden="true">·</span><span className="fb-report-status">{statusLine(report)}</span></span>
  </li>)}</ul>}
 </div>;
}

/** The part of the profile viewer about the profile's contribution (Beta 14): the mark or rank, its points in a small rounded rectangle, one line about the next rank (no progress bar),
 * the notes that are waiting, and View ranks, Your reports. A private window and a Tor window have none of it; with the switch off only Your reports stays. */
/** The seal's and the card's close-up (Beta 14: the Welcome's full-window frost, src/features/welcome/Viewer.tsx): main is told which one, and when it says ok the pop-up kind `welcome` opens. A second press while it is on its way (a double click) is
 * ignored for as long as the close-up takes to take over from this pop-up: `onOpen` of the kind that is already open CLOSES it, so a repeated press would open the close-up and shut it again. */
let viewerOpening=false;
const openViewer=(flow:'seal'|'card',onOpen?:(kind:string,id?:string)=>void)=>{
 if(viewerOpening)return;viewerOpening=true;window.setTimeout(()=>{viewerOpening=false;},900);
 void askInsider(flow).then(answer=>{if(answer?.ok)onOpen?.('welcome');else viewerOpening=false;});
};
/** B2 (the reference design, 17 Nov): the block is the LAST part of the profile menu, so the divider that sets it apart comes BEFORE it (`lead`, drawn only when the block draws something) and it ends with none of its own. */
export function ContributorBlock({dispatch,close,onOpen,onReports,lead}:{dispatch:(action:BrowserAction)=>void;close:()=>void;onOpen?:(kind:string,id?:string)=>void;onReports:()=>void;lead?:ReactNode}){
 const view=useFeedbackView('viewer');
 useEffect(()=>{void feedbackAct({type:'feedback.opened'});},[]);
 if(view.privateOrTor||view.key==='none')return null;
 const reports=view.reports.length>0;
 if(view.off)return reports?<>{lead}<button type="button" className="acira-menu-row" onClick={onReports}><MessageSquare className="acira-menu-icon" size={16}/><span className="acira-menu-title">{t('feedback.link.reports')}</span><ChevronRight className="acira-menu-chevron" size={14}/></button></>:null;
 const label=view.rank?rankName(view.rank):view.mark?markName():t('feedback.noMark'),line=view.available?awayLine(view.next):null;   // no promise of a first rank while no server can be reached
 return <>
  {lead}
  <section className="fb-card" aria-label={t('feedback.viewer')}>
   {view.notes.map(note=><Note key={note.id} note={note} view={view} onDismiss={()=>void feedbackAct({type:'feedback.note-seen',id:note.id})}/>)}
   <div className="fb-card-head">
    <span className="fb-card-label">{(view.rank||view.mark)&&(view.emblem?<RankMark rank={view.rank} emblem={view.emblem} size={24} delay={220}/>:<button type="button" className="fb-seal-button" aria-label={t('insider.reveal.closer')} title={t('insider.reveal.closer')} onClick={()=>openViewer('seal',onOpen)}><RankMark rank={view.rank} emblem={null} size={24}/></button>)}<span className="fb-card-name"><bdi>{label}</bdi></span></span>
    <span className="fb-points" data-count={view.points}>{pointsLabel(view.points)}</span>
   </div>
   {line&&<p className="fb-away">{line}</p>}
   {view.rank&&view.mark&&<p className="fb-away fb-also">{markName()}</p>}
  </section>
  {hasMemberCard(view)&&<button type="button" className="acira-menu-row" onClick={()=>openViewer('card',onOpen)}><Sparkles className="acira-menu-icon" size={16}/><span className="acira-menu-title">{t('memberCard.title')}</span><ChevronRight className="acira-menu-chevron" size={14}/></button>}
  <button type="button" className="acira-menu-row" onClick={()=>onOpen?.('ranks')}><Layers3 className="acira-menu-icon" size={16}/><span className="acira-menu-title">{t('feedback.link.ranks')}</span><ChevronRight className="acira-menu-chevron" size={14}/></button>
  <button type="button" className="acira-menu-row" onClick={onReports}><MessageSquare className="acira-menu-icon" size={16}/><span className="acira-menu-title">{t('feedback.link.reports')}</span><ChevronRight className="acira-menu-chevron" size={14}/></button>
  {view.insider.available&&!view.insider.insider&&!view.insider.borrowed&&<button type="button" className="acira-menu-row" onClick={()=>{void askInsider('code').then(()=>onOpen?.('insider'));}}><KeyRound className="acira-menu-icon" size={16}/><span className="acira-menu-title">{t('insider.link.enter')}</span><ChevronRight className="acira-menu-chevron" size={14}/></button>}
  {(view.insider.insider||view.insider.canInvite)&&<button type="button" className="acira-menu-row" onClick={()=>{void askInsider('invites').then(()=>onOpen?.('insider'));}}><Mail className="acira-menu-icon" size={16}/><span className="acira-menu-title">{view.insider.invitesLeft===null||!view.insider.invitesOpen?t('insider.link.invite'):t('insider.invites.make',{count:view.insider.invitesLeft})}</span><ChevronRight className="acira-menu-chevron" size={14}/></button>}
 </>;
}
