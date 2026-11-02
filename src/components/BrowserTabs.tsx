import type { ReactNode } from 'react';
import type { BrowserAction,BrowserSnapshot,TabSession } from '../runtime/types';
import { BrowserTabsHorizontal } from './BrowserTabsHorizontal';

export interface BrowserTabsProps {
 state:BrowserSnapshot;dispatch:(action:BrowserAction)=>void;render:(tab:TabSession)=>ReactNode;onContext:(id:string,anchor?:{x:number;y:number;width:number;height:number},isGroup?:boolean|'split')=>void;
 onPreview?:(id:string,anchor:{x:number;y:number;width:number;height:number},visible:boolean,force?:boolean)=>void;
 onBlankContext:(anchor:{x:number;y:number;width:number;height:number})=>void;newTab:ReactNode;
 tabState?:(tab:TabSession)=>string|undefined;
 /** The stored site icon for a URL, when the tab has none of its own: part of a strip row's signature (memoised rows). */
 iconOf?:(url:string)=>string|undefined;
}
export function BrowserTabs(props:BrowserTabsProps){return <BrowserTabsHorizontal {...props}/>;}
