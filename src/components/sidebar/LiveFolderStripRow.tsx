import type { ReactNode } from 'react';
import { PrGlyph } from './LiveFolder';
import { hasLiveFolder } from '../../runtime/livePrs';
import type { BrowserSnapshot } from '../../runtime/types';
import { useLivePrs } from '../../ui/useLivePrs';
import { runtime } from '../../runtime/client';
import { t } from '../../i18n';

/** "New live folder" in the sidebar's right-click menu (item 31): offered while the profile has no live folder and the window can have one (an ordinary
 *  window with its tabs in the sidebar). It opens the one plain question; nothing else adds the folder, so it is off until someone asks. */
export function LiveFolderStripRow({state,row,close}:{state:BrowserSnapshot;row:(label:string,Icon:(props:{size?:number})=>ReactNode,action:()=>void)=>ReactNode;close:()=>void}){
 const status=useLivePrs(state.activeBrowserProfileId);
 if(!status||!status.supported||hasLiveFolder(status))return null;
 return <><hr/>{row(t('livepr.add.row'),({size=16})=><PrGlyph look="open" size={size}/>,()=>{close();setTimeout(()=>void runtime.browserCommand({type:'ui',tabId:state.activeTabId,action:'open',kind:'live-folder'}),0);})}</>;
}
