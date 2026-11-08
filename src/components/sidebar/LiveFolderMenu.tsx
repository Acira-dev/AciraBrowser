import { useLayoutEffect,useRef,useState,type ReactNode } from 'react';
import { Check,ChevronLeft,ChevronRight,RotateCw,X } from '../AppIcons';
import { hasLiveFolder,minutesSince,type LivePrsFilterPatch,type LivePrsFolder } from '../../runtime/livePrs';
import { livePrsRequest,useLivePrs } from '../../ui/useLivePrs';
import { t } from '../../i18n';
import './liveFolderMenu.css';

/** The live pull requests popup (item 31). With no folder it is the one plain question before one is made (the consent, shown once per profile);
 *  with one it is the filter menu: what to show, drafts, repositories, Refresh now and Remove live folder. Opened from the folder's slider button,
 *  by right-clicking the folder, and (the question) from the sidebar menu's "New live folder". */
export function LiveFolderMenu({profileId,close}:{profileId:string;close:()=>void}){
 const status=useLivePrs(profileId);
 const [section,setSection]=useState<'main'|'repos'>('main'),root=useRef<HTMLElement>(null);
 useLayoutEffect(()=>{const first=root.current?.querySelector<HTMLElement>('[role=menuitem],button');first?.focus({preventScroll:true});},[section,status?.folder===null]);
 if(!status||!status.supported)return <section ref={root} className="tab-group-controls live-menu" role="menu" aria-label={t('livepr.menu.title')}/>;
 if(!hasLiveFolder(status))return <Consent close={close}/>;
 return section==='repos'?<Repositories status={status} back={()=>setSection('main')} rootRef={root}/>:<Filters status={status} close={close} openRepos={()=>setSection('repos')} rootRef={root}/>;
}

export function Consent({close}:{close:()=>void}){
 const add=()=>{void livePrsRequest({type:'live-prs.add'}).finally(close);};
 return <form className="live-consent" aria-label={t('livepr.add.title')} onSubmit={event=>{event.preventDefault();add();}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();close();}}}>
  <strong>{t('livepr.add.title')}</strong>
  <p>{t('livepr.add.body1')}</p>
  <p>{t('livepr.add.body2')}</p>
  <div className="live-consent-actions"><button type="button" className="acira-button" onClick={close}>{t('livepr.add.notNow')}</button><button type="submit" className="acira-button acira-button-primary" autoFocus>{t('livepr.add.confirm')}</button></div>
 </form>;
}

const item=(label:string,onClick:()=>void,options:{check?:boolean;value?:string;sub?:boolean;icon?:ReactNode;danger?:boolean;checked?:boolean;key?:string}={})=>
 <button key={options.key} type="button" className="menu-row group-menu-row" role={options.check?'menuitemcheckbox':'menuitem'} aria-checked={options.check?!!options.checked:undefined} data-danger={options.danger||undefined} onClick={onClick}
  onKeyDown={event=>{if(options.sub&&event.key==='ArrowRight'){event.preventDefault();event.stopPropagation();onClick();}}}>
  {options.check?(options.checked?<Check size={15}/>:null):options.icon}<span>{label}</span>{options.value&&<em className="live-menu-value">{options.value}</em>}{options.sub&&<ChevronRight size={12}/>}
 </button>;

export function Filters({status,close,openRepos,rootRef,now=Date.now()}:{status:LivePrsFolder;close:()=>void;openRepos:()=>void;rootRef:{current:HTMLElement|null};/** For tests: the time "2 min ago" counts from. */now?:number}){
 const {filters}=status.folder,[note,setNote]=useState('');
 const set=(patch:LivePrsFilterPatch)=>{void livePrsRequest({type:'live-prs.filters',patch});};
 const minutes=minutesSince(status.updatedAt,now),updated=minutes===null?t('livepr.menu.updatedNever'):minutes<1?t('livepr.menu.updatedNow'):t('livepr.menu.updatedMinutes',{minutes});
 const repos=filters.repos===null?t('livepr.menu.repositoriesAll'):t('livepr.menu.repositoriesN',{count:filters.repos.length});
 return <section ref={rootRef} className="tab-group-controls live-menu" role="menu" aria-label={t('livepr.menu.title')} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}}>
  <span className="popup-label">{t('livepr.menu.show')}</span>
  {item(t('livepr.menu.author'),()=>set({author:!filters.author}),{check:true,checked:filters.author})}
  {item(t('livepr.menu.review'),()=>set({review:!filters.review}),{check:true,checked:filters.review})}
  {item(t('livepr.menu.assigned'),()=>set({assigned:!filters.assigned}),{check:true,checked:filters.assigned})}
  {item(t('livepr.menu.mentioned'),()=>set({mentioned:!filters.mentioned}),{check:true,checked:filters.mentioned})}
  <hr/>
  {item(t('livepr.menu.drafts'),()=>set({drafts:!filters.drafts}),{check:true,checked:filters.drafts})}
  {item(t('livepr.menu.recent'),()=>set({recent:!filters.recent}),{check:true,checked:filters.recent,value:t('livepr.menu.recentValue')})}
  <hr/>
  {item(t('livepr.menu.repositories'),openRepos,{value:repos,sub:true})}
  <hr/>
  {item(t('livepr.menu.refresh'),()=>{void livePrsRequest({type:'live-prs.refresh'}).then(result=>{if(result&&hasLiveFolder(result)&&result.refresh==='wait')setNote(t('livepr.note.rateLimited'));});},{icon:<RotateCw size={15}/>,value:updated})}
  {note&&<div className="menu-row live-menu-note" role="status">{note}</div>}
  {item(t('livepr.menu.remove'),()=>{void livePrsRequest({type:'live-prs.remove'}).finally(close);},{icon:<X size={15}/>,danger:true})}
 </section>;
}

export function Repositories({status,back,rootRef}:{status:LivePrsFolder;back:()=>void;rootRef:{current:HTMLElement|null}}){
 const chosen=status.folder.filters.repos,all=chosen===null;
 const toggle=(repo:string)=>{const next=new Set(chosen??status.repos);if(next.has(repo))next.delete(repo);else next.add(repo);void livePrsRequest({type:'live-prs.filters',patch:{repos:next.size===status.repos.length&&status.repos.every(name=>next.has(name))?null:[...next]}});};
 return <section ref={rootRef} className="tab-group-controls live-menu" role="menu" aria-label={t('livepr.menu.repositories')} onKeyDown={event=>{if(['ArrowLeft','Escape'].includes(event.key)){event.preventDefault();event.stopPropagation();back();}}}>
  {item(t('livepr.menu.repositories'),back,{icon:<ChevronLeft size={14}/>})}
  <hr/>
  {item(t('livepr.menu.allRepositories'),()=>{void livePrsRequest({type:'live-prs.filters',patch:{repos:null}});},{check:true,checked:all})}
  {status.repos.length>0&&<hr/>}
  {status.repos.map(repo=>item(repo,()=>toggle(repo),{key:repo,check:true,checked:all||!!chosen?.includes(repo)}))}
  <div className="menu-row live-menu-note" data-info>{t('livepr.menu.repositoriesNote')}</div>
 </section>;
}
