import {useEffect,useId,useRef,useState,type ClipboardEvent,type DragEvent} from 'react';
import {Segmented} from '../../components/Segmented';
import {Check,X,Plus} from '../../components/AppIcons';
import {t} from '../../i18n';
import {CATEGORIES,feedbackAct,feedbackCall,useFeedbackView,type DraftFile,type ReportCategory,type ReportKind} from '../../runtime/feedback';
import type {BrowserAction} from '../../runtime/types';
import {attachProblem,categoryName,failureText} from './words';
import './feedback.css';

export const TEXT_MAX=4000;
/** The largest file main would take (the video limit, 25 MB); anything bigger is not even read into the page. */
const MAX_FILE=26*1024*1024;
/** The mark of the Report a bug button: a small bug drawn on the 16 px grid in the app's line weight. */
export function BugGlyph({size=16,className=''}:{size?:number;className?:string}){
 return <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <path d="M5.2 5.1V4.4a2.8 2.8 0 0 1 5.6 0v.7"/>
  <path d="M8 5.2c-1.9 0-3.1 1.4-3.1 3.3v.4c0 2 1.3 3.7 3.1 3.7s3.1-1.7 3.1-3.7v-.4C11.1 6.6 9.9 5.2 8 5.2Z"/>
  <path d="M8 5.6v6.6M4.9 8.2H2.4M11.1 8.2h2.5M5.1 11l-2 1.2M10.9 11l2 1.2M5.2 6l-2-1.1M10.8 6l2-1.1"/>
 </svg>;
}

/** A picture or the video the person chose: shown big enough to check that nothing personal is visible (the bytes come back from main, which already cut hidden data out of pictures). */
function Thumb({file,onRemove}:{file:DraftFile;onRemove:()=>void}){
 const [url,setUrl]=useState('');
 useEffect(()=>{
  let alive=true,made='';
  // A picture is shown from a data address (the page may load images from data:, not from blob:); the video from a blob (media-src blob:).
  void feedbackCall({type:'feedback.draft-file',id:file.id}).then(result=>{
   if(!alive||!result.data)return;
   const blob=new Blob([result.data as BlobPart],{type:file.type});
   if(file.kind==='video'){made=URL.createObjectURL(blob);setUrl(made);return;}
   const reader=new FileReader();reader.onload=()=>{if(alive&&typeof reader.result==='string')setUrl(reader.result);};reader.readAsDataURL(blob);
  }).catch(()=>{});
  return()=>{alive=false;if(made)URL.revokeObjectURL(made);};
 },[file.id]);
 return <li className="fb-thumb" data-kind={file.kind}>
  {url?(file.kind==='video'?<video className="fb-thumb-media" src={`${url}#t=0.1`} muted preload="metadata" playsInline aria-label={t('feedback.attach.video')}/>:<img className="fb-thumb-media" src={url} alt={t('feedback.attach.picture')} draggable={false}/>):<span className="fb-thumb-wait" aria-hidden="true"/>}
  <button type="button" className="fb-thumb-remove" aria-label={t('feedback.attach.remove')} title={t('feedback.attach.remove')} onClick={onRemove}><X size={12}/></button>
 </li>;
}

/** The report pop-up (Beta 14): two tabs, Report a bug and Suggest an idea; chips for what happened; a text box; "Include technical details"; up to 3 pictures and one video with the
 * "Check that nothing personal is visible" preview; Send; the quiet credit line. After sending: "Report sent…" and the plain invitation to the Discord (a link that sends nothing). Nothing leaves before Send. */
export function ReportPopup({dispatch,close,onOpen}:{dispatch:(action:BrowserAction)=>void;close:()=>void;onOpen?:(kind:string)=>void}){
 const view=useFeedbackView('report'),[tab,setTab]=useState<ReportKind>('bug'),[category,setCategory]=useState<ReportCategory|null>(null),[text,setText]=useState(''),[details,setDetails]=useState(false),[facts,setFacts]=useState<string[]|null>(null),[files,setFiles]=useState<DraftFile[]>([]),[problem,setProblem]=useState(''),[busy,setBusy]=useState(false),[sent,setSent]=useState<{partial:boolean}|null>(null),[over,setOver]=useState(false),textId=useId(),detailsId=useId(),fieldRef=useRef<HTMLTextAreaElement>(null);
 // Opening the pop-up asks the server for this profile's record when it has reported before (the local copy shows at once); closing drops what was attached.
 useEffect(()=>{void feedbackCall({type:'feedback.opened'});fieldRef.current?.focus({preventScroll:true});return()=>{void feedbackCall({type:'feedback.draft-clear'});};},[]);
 const canSend=Boolean(text.trim())&&view.available&&!busy&&!view.privateOrTor;
 const add=async(data:Uint8Array)=>{setProblem('');const result=await feedbackCall({type:'feedback.attach',data});if(result.files)setFiles(result.files);if(!result.ok)setProblem(attachProblem(result.reason));};
 const addFiles=async(list:FileList|File[]|null|undefined)=>{for(const file of Array.from(list??[]).slice(0,8)){if(file.size>MAX_FILE){setProblem(attachProblem('size'));continue;}await add(new Uint8Array(await file.arrayBuffer()));}};
 const pick=async()=>{setProblem('');const result=await feedbackCall({type:'feedback.pick'});if(result.files)setFiles(result.files);const bad=result.results?.find(item=>!item.ok);if(bad)setProblem(attachProblem(bad.reason));};
 const remove=(id:string)=>{void feedbackCall({type:'feedback.draft-remove',id}).then(result=>{if(result.files)setFiles(result.files);});};
 const send=async()=>{
  if(!canSend)return;setBusy(true);setProblem('');
  try{
   const result=await feedbackAct({type:'feedback.send',kind:tab,category:tab==='bug'?category:null,text,details:tab==='bug'&&details});
   if(!result.sent){setProblem(failureText(result.failure));setBusy(false);return;}
   setSent({partial:Boolean(result.attachmentsFailed)});setBusy(false);
  }catch{setProblem(failureText('offline'));setBusy(false);}
 };
 const again=()=>{setSent(null);setText('');setCategory(null);setFiles([]);setDetails(false);setProblem('');requestAnimationFrame(()=>fieldRef.current?.focus({preventScroll:true}));};
 const onDrop=(event:DragEvent)=>{setOver(false);if(!event.dataTransfer?.files?.length)return;event.preventDefault();void addFiles(event.dataTransfer.files);};
 const onPaste=(event:ClipboardEvent)=>{const pasted=Array.from(event.clipboardData?.files??[]);if(pasted.length){event.preventDefault();void addFiles(pasted);}};
 const joinDiscord=()=>{if(view.inviteUrl){dispatch({type:'tab.new',url:view.inviteUrl});close();}};
 // C2 (the team notes, 17 Nov; docs/launch/POPUP_SPACING_RULEBOOK.md): grouped blocks (16 between groups, 6 / 12 / 4 inside them), the attach hint on its own line under its button, and one footer row (the credit line, then Send): no band, no separator, not sticky.
 return <section className="fb-panel" role="group" aria-label={t('feedback.panel')} data-over={over||undefined} onDragOver={event=>{if(event.dataTransfer?.types?.includes('Files')){event.preventDefault();setOver(true);}}} onDragLeave={()=>setOver(false)} onDrop={onDrop} onPaste={onPaste}>
  {sent?<>
   <div className="fb-sent" role="status">
    <span className="fb-sent-mark" aria-hidden="true"><Check size={16}/></span>
    <p className="fb-sent-line">{t('feedback.sent')}</p>
    {sent.partial&&<p className="fb-fine">{t('feedback.sent.partial')}</p>}
    {view.inviteUrl&&<p className="fb-sent-talk">{t('feedback.sent.talk')} <button type="button" className="fb-link" onClick={joinDiscord}>{t('feedback.sent.join')}</button></p>}
    <div className="fb-actions"><button type="button" className="acira-button" onClick={again}>{t('feedback.sent.another')}</button><button type="button" className="acira-button acira-button-primary" onClick={close}>{t('feedback.sent.done')}</button></div>
   </div>
   <p className="fb-credit">{t('feedback.credit')} <button type="button" className="fb-link" onClick={()=>onOpen?.('ranks')}>{t('feedback.credit.link')}</button></p>
  </>:<>
   <div className="fb-group">
    <Segmented label={t('feedback.tabs')} value={tab} options={[['bug',t('feedback.tab.bug')],['idea',t('feedback.tab.idea')]]} onChange={next=>{setTab(next);setProblem('');}}/>
    {tab==='bug'&&<div className="fb-chips" role="group" aria-label={t('feedback.kind.label')}>
     {CATEGORIES.map(id=><button key={id} type="button" className="fb-chip" aria-pressed={category===id} onClick={()=>setCategory(category===id?null:id)}>{categoryName(id)}</button>)}
    </div>}
   </div>
   <div className="fb-group">
    <div className="fb-field">
     <label className="fb-label" htmlFor={textId}>{t(tab==='bug'?'feedback.bug.placeholder':'feedback.idea.placeholder')}</label>
     <textarea ref={fieldRef} id={textId} className="fb-text" rows={4} maxLength={TEXT_MAX} value={text} disabled={busy} onChange={event=>setText(event.target.value)}/>
    </div>
    {tab==='bug'&&<div className="fb-ticks">
     <label className="fb-tick"><input className="fb-tick-input" type="checkbox" aria-describedby={detailsId} checked={details} disabled={busy} onChange={event=>setDetails(event.target.checked)}/><span className="fb-tick-box" aria-hidden="true"><Check size={12}/></span><span className="fb-tick-text">{t('feedback.details')}</span></label>
     <p id={detailsId} className="fb-fine fb-fine-tick">{t('feedback.details.what')}</p>   {/* C3 (the reference design, 17 Nov): the box adds facts the app collects itself, so what it adds is said BEFORE it is ticked */}
     <p className="fb-fine fb-fine-tick"><button type="button" className="fb-link" aria-expanded={facts!==null} onClick={()=>{if(facts){setFacts(null);return;}void feedbackAct({type:'feedback.preview',kind:'bug',category:null,text:'',details:true}).then(result=>{const found=result.payload?.details;if(found)setFacts(Object.values(found));});}}>{t('feedback.details.included')}</button></p>
     {facts&&<><p className="fb-fine fb-fine-tick" dir="auto">{facts.join(' · ')}</p><p className="fb-fine fb-fine-tick">{t('feedback.details.always')}</p></>}   {/* C3 gap (17 Nov): the exact values the report would carry, from main's own preview: the same allow-listed list the report builds */}
    </div>}
   </div>
   <div className="fb-attach">
    <button type="button" className="fb-add" disabled={busy||(files.length>=4)} onClick={()=>void pick()}><Plus size={14}/><span>{t('feedback.attach.add')}</span></button>
    {files.length===0&&<span className="fb-fine fb-attach-hint">{t('feedback.attach.hint')}</span>}
   </div>
   {files.length>0&&<div className="fb-group fb-group-files"><ul className="fb-thumbs">{files.map(file=><Thumb key={file.id} file={file} onRemove={()=>remove(file.id)}/>)}</ul><p className="fb-check">{t('feedback.attach.check')}</p></div>}
   {(problem||!view.available)&&<p className="fb-problem" role="alert">{problem||failureText(view.privateOrTor?'private':'unavailable')}</p>}
   <div className="fb-foot">
    <p className="fb-credit">{t('feedback.credit')} <button type="button" className="fb-link" onClick={()=>onOpen?.('ranks')}>{t('feedback.credit.link')}</button></p>
    <button type="button" className="acira-button acira-button-primary fb-send" disabled={!canSend} onClick={()=>void send()}>{busy?t('feedback.sending'):t('feedback.send')}</button>
   </div>
  </>}
 </section>;
}
