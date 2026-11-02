import {useEffect,useId,useRef,useState} from 'react';
import {runtime} from '../runtime/client';
import type {BrowserAction,SiteReportKind,SiteReportPayload,TabSession} from '../runtime/types';
import {FactRow} from '../components/PanelParts';
import {MenuChoice} from '../components/MenuChoice';
import {MessageSquare} from '../components/AppIcons';
import {t,type MessageId} from '../i18n';
import '../styles/menu-form.css';
import '../styles/site-report.css';

const kinds:[SiteReportKind,MessageId][]=[['blocked','report.kind.blocked'],['broken','report.kind.broken'],['banner','report.kind.banner'],['other','report.kind.other']];
const lists:Record<string,MessageId>={phishing:'report.list.phishing',malware:'report.list.malware','phishing-db':'report.list.phishingDb',lookalike:'report.list.lookalike','ad-blocking':'report.list.adBlocking','cookie-banners':'report.list.cookieBanners'};
const systems:Record<string,MessageId>={darwin:'report.system.darwin',win32:'report.system.win32',linux:'report.system.linux'};
export const NOTE_MAX=500;

/** Whether a tab can offer "Report a problem with this site": a website, never in a Tor window or tab (main refuses those too). */
export const reportable=(tab:TabSession,tor:boolean)=>!tor&&tab.privacy!=='tor'&&tab.contentKind==='web'&&/^https?:\/\//i.test(tab.url);

/** "Report a problem with this site", inside Page information and Protection: what went wrong, an optional note, and the exact message that
 * will be sent (main's own preview of it, site-reports.cjs), then Send. Nothing leaves before Send. */
export function SiteReport({tab,initialKind,dispatch,onCancel,onSent}:{tab:TabSession;initialKind?:SiteReportKind;dispatch:(action:BrowserAction)=>void;onCancel:()=>void;onSent:()=>void}){
 const [kind,setKind]=useState<SiteReportKind|undefined>(initialKind),[note,setNote]=useState(''),[payload,setPayload]=useState<SiteReportPayload|null>(null),[host,setHost]=useState(''),[available,setAvailable]=useState(true),[busy,setBusy]=useState(false),[problem,setProblem]=useState(''),noteId=useId(),version=useRef(0);
 // Main builds the message; the panel only shows it. Asked again when the choice or the note changes, so what is shown is what Send sends.
 useEffect(()=>{const current=++version.current;const timer=setTimeout(()=>{void runtime.service({type:'site-report.preview',tabId:tab.id,kind:kind??'',note}).then(result=>{if(current!==version.current)return;const report=result.siteReport;setAvailable(report?.available!==false);setPayload(report?.payload??null);if(report?.payload?.host)setHost(report.payload.host);else if(!host){try{setHost(new URL(tab.url).hostname);}catch{}}}).catch(()=>{if(current===version.current)setPayload(null);});},note?150:0);return()=>clearTimeout(timer);},[tab.id,tab.url,kind,note]);
 const send=async()=>{if(!kind||!payload)return;setBusy(true);setProblem('');try{await runtime.service({type:'site-report.send',tabId:tab.id,kind,note});dispatch({type:'toast',text:t('report.thanks')});onSent();}catch{setProblem(t('report.failed'));setBusy(false);}};
 return <section className="site-report" aria-label={t('report.title')} aria-busy={busy}>
  <div className="acira-menu-row acira-menu-row-identity"><MessageSquare size={16} className="acira-menu-icon"/><span className="acira-menu-title">{t('report.title')}<span className="acira-menu-sub"><bdi>{host}</bdi></span></span><span/></div>
  <div className="acira-menu-sep" role="separator"/>
  <div className="acira-menu-label">{t('report.whatsWrong')}</div>
  <div role="group" aria-label={t('report.whatsWrong')}>{kinds.map(([id,label])=><MenuChoice key={id} label={t(label)} on={kind===id} onChoose={()=>setKind(id)}/>)}</div>
  <div className="acira-menu-sep" role="separator"/>
  <label className="acira-menu-label" htmlFor={noteId}>{t('report.note')}</label>
  <div className="menu-form-fields site-report-note"><textarea id={noteId} rows={3} maxLength={NOTE_MAX} value={note} placeholder={t('report.notePlaceholder')} disabled={busy} onChange={event=>setNote(event.target.value)}/></div>
  <div className="acira-menu-sep" role="separator"/>
  <div className="acira-menu-label">{t('report.sentHeading')}</div>
  <FactRow label={t('report.field.site')} value={<bdi>{payload?.host??host}</bdi>}/>
  <FactRow label={t('report.field.problem')} value={kind?t(kinds.find(([id])=>id===kind)![1]):t('report.chooseAbove')}/>
  {payload?.list&&lists[payload.list]&&<FactRow label={t('report.field.list')} value={t(lists[payload.list])}/>}
  {payload&&<FactRow label={t('report.field.acira')} value={<bdi>{`${payload.appVersion} · ${systems[payload.platform]?t(systems[payload.platform]):payload.platform}`}</bdi>}/>}
  <FactRow label={t('report.field.note')} value={payload?.note?t('report.noteAbove'):t('report.noteNone')}/>
  <p className="site-report-fine">{t('report.nothingElse')}</p>
  {(problem||!available)&&<p className="site-report-fine site-report-problem" role="alert">{problem||t('report.unavailable')}</p>}
  <div className="menu-form-actions site-report-actions"><button type="button" className="acira-button" onClick={onCancel}>{t('dialog.cancel')}</button><button type="button" className="acira-button acira-button-primary" disabled={busy||!kind||!payload||!available} onClick={()=>void send()}>{busy?t('report.sending'):t('report.send')}</button></div>
 </section>;
}
