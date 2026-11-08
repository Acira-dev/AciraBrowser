import { useEffect,useId,useMemo,useState,type CSSProperties,type KeyboardEvent,type MouseEvent,type ReactNode } from 'react';
import { ChevronDown,X } from '../AppIcons';
import { PreviewIcon } from '../PreviewIcon';
import { runtime } from '../../runtime/client';
import { GITHUB_PULLS,GITHUB_SIGN_IN,hasLiveFolder,liveNote,prDone,prLook,pullKeyOf,readSeenReviews,sheetLooks,staleRows,unseenReviews,writeSeenReviews,type LivePrLook,type LivePrRow,type LivePrsFolder,type LivePrsNote } from '../../runtime/livePrs';
import type { BrowserAction,BrowserSnapshot,TabSession } from '../../runtime/types';
import { livePrsRequest,useLivePrs } from '../../ui/useLivePrs';
import { pointerAnchor } from '../../ui/popup';
import { setRailPrefs,useRailPrefs } from '../../ui/railPrefs';
import { tabGroupColor } from '../../ui/theme';
import { t } from '../../i18n';
import './liveFolder.css';

type Dispatch=(action:BrowserAction)=>void;
const CLOSED_KEY='live-prs-closed';

/** Pull request glyphs on the 16px grid in the sidebar's 1.4 stroke (the favicon's place on a row). A draft has a dotted right edge, as on GitHub. */
const GLYPH:Record<LivePrLook,ReactNode>={
 open:<><circle cx="4.5" cy="3.6" r="1.7"/><circle cx="4.5" cy="12.4" r="1.7"/><circle cx="11.5" cy="12.4" r="1.7"/><path d="M4.5 5.3v5.4"/><path d="M11.5 10.7V6.6a2.1 2.1 0 0 0-2.1-2.1H7.9"/><path d="m9.6 2.6-1.9 1.9 1.9 1.9"/></>,
 draft:<><circle cx="4.5" cy="3.6" r="1.7"/><circle cx="4.5" cy="12.4" r="1.7"/><circle cx="11.5" cy="12.4" r="1.7" opacity=".6"/><path d="M4.5 5.3v5.4"/><circle cx="11.5" cy="3.7" r=".62" fill="currentColor" stroke="none"/><circle cx="11.5" cy="6.1" r=".62" fill="currentColor" stroke="none"/><circle cx="11.5" cy="8.5" r=".62" fill="currentColor" stroke="none"/></>,
 merged:<><circle cx="4.5" cy="3.6" r="1.7"/><circle cx="4.5" cy="12.4" r="1.7"/><circle cx="11.5" cy="8" r="1.7"/><path d="M4.5 5.3v5.4"/><path d="M4.5 5.3c0 1.7.9 2.7 2.9 2.7h2.4"/></>,
 closed:<><circle cx="4.5" cy="3.6" r="1.7"/><circle cx="4.5" cy="12.4" r="1.7"/><circle cx="11.5" cy="12.4" r="1.7"/><path d="M4.5 5.3v5.4"/><path d="M11.5 10.7V6.4"/><path d="m9.7 2.6 3.6 3.6m0-3.6L9.7 6.2"/></>,
};
export function PrGlyph({look,size=16}:{look:LivePrLook;size?:number}){return <svg className="live-pr-glyph" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">{GLYPH[look]}</svg>;}

const LOOK_COLOR:Record<LivePrLook,string>={open:'var(--tab-group-green)',draft:'var(--tab-group-grey)',merged:'var(--tab-group-purple)',closed:'var(--tab-group-red)'};
const f=(n:number)=>Math.round(n*100)/100;
/** A polygon with rounded corners (radius r) as a path. */
function rounded(points:number[][],r:number){
 const n=points.length;let d='';
 for(let i=0;i<n;i++){
  const p=points[i],a=points[(i+n-1)%n],b=points[(i+1)%n],ua=[a[0]-p[0],a[1]-p[1]],ub=[b[0]-p[0],b[1]-p[1]],la=Math.hypot(ua[0],ua[1]),lb=Math.hypot(ub[0],ub[1]),rr=Math.min(r,la/2,lb/2);
  d+=(i?'L':'M')+f(p[0]+ua[0]/la*rr)+' '+f(p[1]+ua[1]/la*rr)+'Q'+f(p[0])+' '+f(p[1])+' '+f(p[0]+ub[0]/lb*rr)+' '+f(p[1]+ub[1]/lb*rr);
 }
 return d+'Z';
}
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
/** The sheet-stack folder of the folders design (item 9: a back plate, up to three small sheets, a glass front plate) with each sheet tinted by the
 *  state of the pull request it stands for. Closed and open are two drawings; the group's own CSS cross-fades them as it does for any folder.
 *  Its geometry is this one function; when item 9 ships its folder component, this takes that one's place and passes the sheets in. */
export function LiveFolderIcon({looks,open,size=16}:{looks:readonly LivePrLook[];open:boolean;size?:number}){
 const id=useId().replace(/:/g,''),n=Math.min(3,Math.max(1,looks.length)),t=open?1:0;
 const back=[[1.2,3.3],[6,3.3],[7.3,4.8],[14.8,4.8],[14.8,13.6],[1.2,13.6]],closedFront=[[1.2,6.7],[14.8,6.7],[14.8,13.6],[1.2,13.6]],openFront=[[2.5,6.5],[15.2,6.5],[13.6,13.6],[.8,13.6]];
 const front=closedFront.map((p,i)=>[lerp(p[0],openFront[i][0],t),lerp(p[1],openFront[i][1],t)]);
 const sheets=[...looks.slice(0,3)].reverse();
 const pages=sheets.map((look,k)=>{
  const depth=n-1-k,w=lerp(8.2,10.6,1-depth/Math.max(1,2)),peek=1.55+depth*1.15+t*(1.1+depth*.35),side=depth?(k%2?1:-1)*depth:0,angle=side*3.2*t,cx=8+side*.55*t,y=6.7-peek,h=peek+2.3;
  return <rect key={k} x={f(cx-w/2)} y={f(y)} width={f(w)} height={h} rx="1.1" transform={`rotate(${f(angle)} ${f(cx)} ${f(y+h)})`} fill={`color-mix(in srgb,${LOOK_COLOR[look]} 36%,var(--pg-fill))`} stroke={`color-mix(in srgb,${LOOK_COLOR[look]} 88%,transparent)`} strokeWidth=".6"/>;
 });
 return <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" style={{overflow:'visible'}}>
  <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".34"/><stop offset="1" stopColor="currentColor" stopOpacity=".12"/></linearGradient></defs>
  <path d={rounded(back,1.2)} fill="currentColor" fillOpacity=".10" stroke="currentColor" strokeOpacity=".5" strokeWidth=".8" strokeLinejoin="round"/>
  {pages}
  <path d={rounded(front,1.25)} fill={`url(#${id})`} stroke="currentColor" strokeOpacity=".82" strokeWidth=".85" strokeLinejoin="round"/>
  <path d={`M${f(front[0][0]+1.7)} ${f(front[0][1]+1.05)}L${f(front[1][0]-1.7)} ${f(front[1][1]+1.05)}`} stroke="var(--sheen)" strokeWidth=".6" strokeLinecap="round" fill="none"/>
 </svg>;
}

const FilterGlyph=()=><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M2.5 4.2h11M4.5 8h7M6.5 11.8h3"/></svg>;
const SignInGlyph=()=><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6.5 3H4.4A1.4 1.4 0 0 0 3 4.4v7.2A1.4 1.4 0 0 0 4.4 13h2.1"/><path d="M9.5 5.2 12.3 8l-2.8 2.8M12.3 8H6.2"/></svg>;
const RetryGlyph=({spin=false}:{spin?:boolean})=><svg className={spin?'live-spin':undefined} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 2.8v2.6h-2.6"/></svg>;
const ArrowGlyph=()=><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 11 11 5M6.5 5H11v4.5"/></svg>;

const lookName=(look:LivePrLook)=>look==='open'?t('livepr.state.open'):look==='draft'?t('livepr.state.draft'):look==='merged'?t('livepr.state.merged'):t('livepr.state.closed');
const noteText=(note:LivePrsNote)=>{switch(note){
 case 'loading':return t('livepr.note.loading');case 'signed-out':return t('livepr.note.signedOut');case 'nothing-waiting':return t('livepr.note.nothing');case 'all-filtered':return t('livepr.note.filtered');
 case 'error-offline':return t('livepr.note.offline');case 'error-rate-limited':return t('livepr.note.rateLimited');case 'error-unreadable':return t('livepr.note.unreadable');case 'error-other':return t('livepr.note.error');
}};

/** The tab of this profile that shows the pull request (its page or any page of it: files, checks), the one on screen first. */
function tabFor(state:BrowserSnapshot,row:LivePrRow,profileId:string):TabSession|undefined{
 const key=pullKeyOf(row.url);if(!key)return undefined;
 const own=state.tabs.filter(tab=>tab.browserProfileId===profileId&&!tab.privacy&&pullKeyOf(tab.url)===key);
 return own.find(tab=>tab.id===state.activeTabId)??own[0];
}

/** Opens the pull-request menu (filters, repositories, refresh, remove) from its button or at a right-click. */
export function openLiveFolderMenu(state:Pick<BrowserSnapshot,'activeTabId'>,from:HTMLElement|{clientX:number;clientY:number}){
 const box='getBoundingClientRect' in from?from.getBoundingClientRect():pointerAnchor(from.clientX,from.clientY);
 void runtime.browserCommand({type:'ui',tabId:state.activeTabId,action:'open',kind:'live-folder',anchor:{x:box.x,y:box.y,width:box.width,height:box.height}});
}

function LiveRow({row,state,profileId,dispatch,moveFocus,open}:{row:LivePrRow;state:BrowserSnapshot;profileId:string;dispatch:Dispatch;moveFocus:(event:KeyboardEvent<HTMLElement>)=>unknown;open:boolean}){
 const tab=tabFor(state,row,profileId),active=!!tab&&tab.id===state.activeTabId,look=prLook(row),done=prDone(row);
 const go=()=>{if(tab){if(!active)dispatch({type:'tab.select',id:tab.id});}else dispatch({type:'tab.new',url:row.url,browserProfileId:profileId});};
 // The row is a link until a tab shows it; with a tab open its × closes that tab (the row stays, as a link again), without one it hides the row until the pull request changes.
 const leave=()=>{if(tab)dispatch({type:'tab.close',id:tab.id});else void livePrsRequest({type:'live-prs.hide',id:row.id});};
 const name=`${row.title} · ${row.repo}#${row.number}`;
 return <div className="sb-tab live-row" role="listitem" data-flip={'live:'+row.id} data-live-id={row.id} data-look={look} data-done={done||undefined} data-hidden={!open&&!active?true:undefined} inert={!open&&!active?true:undefined} aria-current={active||undefined}
  onAuxClick={event=>{if(event.button===1){event.preventDefault();leave();}}}>
  <button type="button" className="sb-tab-main" data-sb-focus aria-current={active?'page':undefined} aria-label={`${row.title}, ${row.repo}#${row.number}, ${lookName(look)}${row.reviewRequested?`, ${t('livepr.reviewAsked')}`:''}`} title={name} onClick={go}
   onKeyDown={event=>{if(event.key==='Delete'){event.preventDefault();leave();return;}moveFocus(event);}}>
   <span className="sb-tab-icon"><PrGlyph look={look}/></span><span className="sb-tab-title" dir="auto"><span className="sb-tab-title-text">{row.title}</span></span>
  </button>
  {row.reviewRequested&&<span className="sb-tab-mark live-review" title={t('livepr.reviewAsked')} role="img" aria-label={t('livepr.reviewAsked')}><span className="live-dot"/></span>}
  <button type="button" className="sb-tab-close" aria-label={tab?t('acirasidebar.closeName',{name:row.title}):t('livepr.hideNamed',{name:row.title})} title={tab?t('livepr.closeTab'):t('livepr.hideTip')} onClick={leave}><PreviewIcon icon={X} size={14}/></button>
 </div>;
}

function Note({text,wrap=false,spin=false}:{text:string;wrap?:boolean;spin?:boolean}){return <div className="live-note" role="status" data-wrap={wrap||undefined} data-spin={spin||undefined}>{spin&&<span className="sb-tab-icon"><RetryGlyph spin/></span>}{text}</div>;}
function Action({label,icon,onClick,spin=false}:{label:string;icon:ReactNode;onClick:()=>void;spin?:boolean}){return <button type="button" className="live-action" data-sb-focus data-spin={spin||undefined} onClick={onClick}><span className="sb-tab-icon">{icon}</span><span className="sb-tab-title-text">{label}</span></button>;}

/** The lines under the rows that are not pull requests: loading, nothing waiting, signed out, errors, "More on GitHub". */
function LiveNotes({status,dispatch,again}:{status:LivePrsFolder;dispatch:Dispatch;again:()=>void}){
 const note=liveNote(status),openGithub=(url:string)=>dispatch({type:'tab.new',url});
 return <div className="live-notes">
  {note==='signed-out'&&<><Note wrap text={noteText(note)}/><Action label={t('livepr.signIn')} icon={<SignInGlyph/>} onClick={()=>openGithub(GITHUB_SIGN_IN)}/><Action label={t('livepr.checkAgain')} icon={<RetryGlyph spin={status.loading}/>} spin={status.loading} onClick={again}/></>}
  {note==='loading'&&<Note text={noteText(note)} spin/>}
  {note&&note!=='signed-out'&&note!=='loading'&&note.startsWith('error')&&<><Note wrap text={noteText(note)}/><Action label={t('livepr.tryAgain')} icon={<RetryGlyph spin={status.loading}/>} spin={status.loading} onClick={again}/></>}
  {(note==='nothing-waiting'||note==='all-filtered')&&<Note wrap text={noteText(note)}/>}
  {staleRows(status)&&<Note text={t('livepr.stale')}/>}
  {status.more&&status.phase!=='signed-out'&&<Action label={t('livepr.more')} icon={<ArrowGlyph/>} onClick={()=>openGithub(GITHUB_PULLS)}/>}
 </div>;
}

/** The folder as drawn from what main said: all the drawing, no state of its own (the tests render it with made-up rows). */
export function LiveFolderView({status,state,dispatch,moveFocus,open,unseen,onToggle,onAgain}:{status:LivePrsFolder;state:BrowserSnapshot;dispatch:Dispatch;moveFocus:(event:KeyboardEvent<HTMLElement>)=>unknown;open:boolean;unseen:number;onToggle:()=>void;onAgain:()=>void}){
 const profileId=state.activeBrowserProfileId,looks=sheetLooks(status.rows),name=status.folder.name==='Pull requests'?t('livepr.folderName'):status.folder.name;
 const menu=(event:MouseEvent<HTMLElement>)=>{event.preventDefault();event.stopPropagation();openLiveFolderMenu(state,event);};
 return <div className="ed-rail-tab-group sb-group sb-live" role="listitem" data-live-folder data-collapsed={open?undefined:true} data-holds-active={status.rows.some(row=>tabFor(state,row,profileId)?.id===state.activeTabId)||undefined} style={{'--group-color':tabGroupColor('grey')} as CSSProperties} onContextMenu={menu}>
  <button type="button" className="ed-rail-tab-group-name sb-group-header" data-flip="live:header" data-sb-focus aria-expanded={open} aria-label={`${name}${unseen&&!open?`, ${t('livepr.reviewAsked')}`:''}`} title={name} onClick={onToggle}
   onKeyDown={event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();openLiveFolderMenu(state,event.currentTarget);return;}moveFocus(event);}}>
   <span className="sb-tab-icon sb-group-folder" aria-hidden="true"><LiveFolderIcon looks={looks} open={false}/><LiveFolderIcon looks={looks} open/>{!open&&unseen>0&&<span className="live-dot live-dot-icon"/>}</span>
   <span className="sb-group-name">{name}</span><PreviewIcon icon={ChevronDown} size={12}/>
  </button>
  <button type="button" className="sb-header-add sb-live-filter" aria-label={t('livepr.filter')} title={t('livepr.filter')} onClick={event=>{event.stopPropagation();openLiveFolderMenu(state,event.currentTarget);}}><FilterGlyph/></button>
  <div className="ed-rail-group-members sb-group-members" role="list">
   {status.rows.map(row=><LiveRow key={row.id} row={row} state={state} profileId={profileId} dispatch={dispatch} moveFocus={moveFocus} open={open}/>)}
  </div>
  {open&&<LiveNotes status={status} dispatch={dispatch} again={onAgain}/>}
 </div>;
}

/** The "Pull requests" live folder (item 31): a folder that fills itself with the person's GitHub pull requests. It exists only when the person added it
 *  (right-click the sidebar, New live folder) and is the first folder in the list. Private, Tor and secured windows never draw it. */
export function LiveFolder({state,dispatch,moveFocus}:{state:BrowserSnapshot;dispatch:Dispatch;moveFocus:(event:KeyboardEvent<HTMLElement>)=>unknown}){
 const profileId=state.activeBrowserProfileId,profile=state.browserProfiles.find(item=>item.id===profileId);
 const ordinary=!!profile&&!profile.private&&!profile.tor&&!state.workspaces?.find(item=>item.id===state.activeWorkspaceId)?.secured;
 const status=useLivePrs(profileId,ordinary),prefs=useRailPrefs(profileId,false);
 const open=!prefs.folded[CLOSED_KEY],[seen,setSeen]=useState<string[]>(()=>readSeenReviews(profileId));
 const folder=hasLiveFolder(status)?status:null;
 useEffect(()=>{setSeen(readSeenReviews(profileId));},[profileId]);
 // A review request that arrived while the folder was closed puts a blue dot on its icon; opening the folder shows it and the dot goes.
 const unseen=useMemo(()=>folder?unseenReviews(folder.rows,seen).map(row=>row.id):[],[folder,seen]);
 useEffect(()=>{if(open&&unseen.length){const next=[...seen,...unseen];setSeen(next);writeSeenReviews(profileId,next);}},[open,unseen,seen,profileId]);
 if(!folder)return null;
 return <LiveFolderView status={folder} state={state} dispatch={dispatch} moveFocus={moveFocus} open={open} unseen={unseen.length} onToggle={()=>setRailPrefs({folded:{...prefs.folded,[CLOSED_KEY]:open}},profileId,false)} onAgain={()=>{void livePrsRequest({type:'live-prs.refresh'});}}/>;
}
