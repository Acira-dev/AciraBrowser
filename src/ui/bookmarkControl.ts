import type {MouseEvent} from 'react';
import type {BookmarkNode,BrowserAction,BrowserSnapshot,TabSession} from '../runtime/types';
import {openPage} from './pageActions';

/** Match the runtime's persistence boundary; an internal address is never a bookmark. A Tor tab of an ordinary window saves a
 * Tor bookmark (BookmarkNode.tor), kept apart from an ordinary bookmark of the same page; other private tabs save nothing. */
export function bookmarkControl(state:BrowserSnapshot,tab:TabSession){
 const profile=state.browserProfiles.find(profile=>profile.id===tab.browserProfileId),tor=tab.privacy==='tor'&&!profile?.private;
 const privateTab=!tor&&(!!tab.privacy||!!profile?.private);
 const reason=privateTab?'private':!/^https?:\/\//i.test(tab.url)?'internal':null;
 const saved=!reason&&state.bookmarkNodes.some(node=>node.browserProfileId===tab.browserProfileId&&node.url===tab.url&&!!node.tor===tor);
 return {available:reason===null,reason,saved,tor};
}

/** A Tor bookmark opens in a Tor tab: the one already showing its page, or a new one. */
export function openTorBookmark(state:BrowserSnapshot,dispatch:(action:BrowserAction)=>void,url:string,background=false){
 const open=state.tabs.find(tab=>tab.privacy==='tor'&&tab.url===url);
 if(open&&!background)dispatch({type:'tab.select',id:open.id});
 else if(!open)dispatch({type:'tab.new',url,privacy:'tor',background});
}

/** A click on a saved page (openPage's buttons and keys): a Tor bookmark opens in a Tor tab, in the background with Ctrl or the middle button. */
export function openSavedPage(event:MouseEvent,node:Pick<BookmarkNode,'url'|'tor'>,state:BrowserSnapshot,dispatch:(action:BrowserAction)=>void,onNavigate:(url:string)=>void){
 if(!node.url)return;
 if(!node.tor){openPage(event,node.url,dispatch,onNavigate);return;}
 if(event.button!==0&&event.button!==1)return;
 event.preventDefault();
 openTorBookmark(state,dispatch,node.url,event.button===1||event.ctrlKey||event.metaKey);
}
