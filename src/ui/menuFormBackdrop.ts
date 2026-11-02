import type { Rectangle } from '../runtime/types';

export interface MenuFrameSource { key: string; bounds: Rectangle }
const intersect = (a:Rectangle,b:Rectangle):Rectangle|null => {
  const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),right=Math.min(a.x+a.width,b.x+b.width),bottom=Math.min(a.y+a.height,b.y+b.height);
  return right>x&&bottom>y?{x,y,width:right-x,height:bottom-y}:null;
};
const covers=(outer:Rectangle,inner:Rectangle)=>outer.x<=inner.x+.5&&outer.y<=inner.y+.5&&outer.x+outer.width>=inner.x+inner.width-.5&&outer.y+outer.height>=inner.y+inner.height-.5;
export const menuFrameBounds=(value:unknown):value is Rectangle=>!!value&&typeof value==='object'&&(['x','y','width','height'] as const).every(key=>Number.isFinite((value as Rectangle)[key]))&&(value as Rectangle).width>0&&(value as Rectangle).height>0;

/** A portal has no DOM inheritance from its owner. Retired ownership therefore
 * closes the child even when its native host can still paint or receive input. */
export const menuFormOwnerRetired=({preparing,inactive,hidden,ownerScene,currentScene}:{preparing:boolean;inactive:boolean;hidden:boolean;ownerScene?:string;currentScene?:string})=>preparing||inactive||hidden||currentScene!==undefined&&ownerScene!==currentScene;

/** Snapshot ROI comes from native-accepted geometry, with host rounding only. */
export const menuFormSnapshotAdmitted=(id:number|undefined,overlay:{id?:number;auxiliaryBounds?:Rectangle}|undefined,desired:Rectangle)=>id!==undefined&&overlay?.id===id&&!!overlay.auxiliaryBounds&&(['x','y','width','height'] as const).every(key=>Math.abs(overlay.auxiliaryBounds![key]-desired[key])<=1);

/** Chrome is a separate capture from native website views. Every website pixel
 * behind the padded sample needs its own decoded source, including split panes. */
export function menuFrameCoverage(sample:Rectangle,sources:MenuFrameSource[],views:{tabId:string;bounds:Rectangle}[],viewport:Rectangle):boolean {
  const visible=intersect(sample,viewport),chrome=sources.find(source=>source.key==='chrome');
  if(!visible||!chrome||!covers(chrome.bounds,visible))return false;
  return views.every(view=>{
    const needed=intersect(view.bounds,visible);
    return !needed||sources.some(source=>source.key===`page:${view.tabId}`&&covers(source.bounds,needed));
  });
}
