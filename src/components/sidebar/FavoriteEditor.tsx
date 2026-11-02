import { useLayoutEffect,useRef,useState } from 'react';
import type { BrowserAction,BrowserSnapshot } from '../../runtime/types';
import { favoriteTabOf } from '../../runtime/favoriteTabs';
import { SiteIdentityIcon } from '../SiteIdentityIcon';
import { readSidebarApps,removeSidebarAppWithUndo,updateSidebarApp,useSidebarApps } from '../../ui/sidebarApps';
import { favoriteEditTarget } from '../../ui/favoriteEdit';
import '../../features/library.css';
import './favoriteEditor.css';

import { t } from '../../i18n';
const host=(url:string)=>{try{return new URL(url).hostname.replace(/^www\./,'');}catch{return url;}};

/** Edit favorite (Round 2, G with A's panel spec): a popover that grows from the tile and edits in place, on the
 * bookmark editor's look. Header: the site, its name and address. Name and Address fields on the text edge, the divider,
 * then Remove (quiet, with Undo) left and Done right, as Chrome's and Safari's bookmark editors. Enter saves, Escape
 * leaves it as it was. While the favorite's own tab is open, Close tab unloads it and keeps the favorite, as Cmd+W does
 * (a favorite owns one tab, runtime/favoriteTabs.ts; its row is not in the tab list, so this is its close control). */
export function FavoriteEditor({state,dispatch,close}:{state:BrowserSnapshot;dispatch:(action:BrowserAction)=>void;close:()=>void}){
 const target=useRef(favoriteEditTarget()).current;
 const live=useSidebarApps(target?.profileId??'',false).apps.find(app=>app.id===target?.appId);
 const app=live??(target?readSidebarApps(target.profileId,false).apps.find(item=>item.id===target.appId):undefined);
 const [name,setName]=useState(app?.title??''),[url,setUrl]=useState(app?.url??''),[error,setError]=useState('');
 const field=useRef<HTMLInputElement>(null);
 useLayoutEffect(()=>{field.current?.focus({preventScroll:true});field.current?.select();},[]);
 if(!target||!app)return <div className="bm-edit"><p className="bm-edit-note">{t("favoriteeditor.thisFavoriteWasRemoved")}</p><hr className="acira-sep"/><div className="bm-edit-actions fav-edit-actions"><button type="button" className="acira-button acira-button-primary" onClick={close}>{t("favoriteeditor.done")}</button></div></div>;
 const save=()=>{const failed=updateSidebarApp(target.profileId,false,app.id,{url:url.trim(),title:name.trim()});if(failed){setError(failed);return;}close();};
 const remove=()=>{const toast=removeSidebarAppWithUndo(target.profileId,false,app.id);if(toast)dispatch(toast);close();};
 const tab=favoriteTabOf([...state.tabs,...(state.otherWorkspaceTabs??[])],app.id,target.profileId);
 const closeTab=()=>{if(tab)dispatch({type:'tab.close',id:tab.id});close();};
 return <form className="bm-edit fav-edit" aria-label={t("acirasidebar.editFavorite")} onSubmit={event=>{event.preventDefault();save();}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();close();}}}>
  <header className="bm-edit-head fav-edit-head"><SiteIdentityIcon url={app.url} favicon={app.icon} size={16}/><div><strong>{name.trim()||host(url)}</strong><small>{host(url)}</small></div></header>
  <label className="bm-edit-label" htmlFor="fav-edit-name">{t("acirasidebar.name")}</label>
  <input id="fav-edit-name" ref={field} className="bm-edit-input" value={name} maxLength={80} placeholder={host(url)} onChange={event=>setName(event.target.value)}/>
  <label className="bm-edit-label" htmlFor="fav-edit-url">{t("acirasidebar.address")}</label>
  <input id="fav-edit-url" className="bm-edit-input" value={url} spellCheck={false} placeholder="example.com" aria-invalid={!!error||undefined} aria-describedby={error?'fav-edit-error':undefined} onChange={event=>{setUrl(event.target.value);setError('');}}/>
  {error&&<p id="fav-edit-error" className="fav-edit-error" role="alert">{error}</p>}
  <hr className="acira-sep"/>
  <div className="bm-edit-actions fav-edit-actions"><button type="button" className="acira-button acira-button-quiet fav-edit-remove" onClick={remove}>{t("acirasidebar.remove")}</button>{tab&&<button type="button" className="acira-button acira-button-quiet fav-edit-close" onClick={closeTab}>{t("app.closeTab")}</button>}<button type="submit" className="acira-button acira-button-primary">{t("favoriteeditor.done")}</button></div>
 </form>;
}
