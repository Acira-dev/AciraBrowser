import { useId,useLayoutEffect,useRef,useState } from 'react';
import { FOLDER_BACK,FOLDER_FRONT_CLOSED,FOLDER_SHEET_BOXES,FOLDER_SHEEN_CLOSED,folderSheets } from './folderGlyph';

const MOVE_MS=220;
/** The speed setting's scale (Premium 1.7, Fast .6, Off 0) as the sidebar's own CSS sees it. */
const motionScale=(node:Element|null)=>{const value=node?parseFloat(getComputedStyle(node).getPropertyValue('--motion-scale')):NaN;return Number.isFinite(value)?Math.max(0,value):1;};

/** The folder of a tab group in the sidebar (beta.13, item 9): a back plate, one to three small sheets standing in it (one sheet per
 *  tab, no more than three: "up to a few") and a front plate drawn as glass, in the group's colour. Opening tilts the front plate
 *  into the open-folder shape and lifts and fans the sheets a little; a tab going in slides one more sheet up behind the others, a
 *  tab leaving lets the last one sink, and the folder gives a small bump either way. All of the fold itself is CSS on the group's
 *  `data-collapsed` (sidebar.css, the `.gf-*` rules), so the speed setting scales it and Off makes it instant; only the arrival, the
 *  departure and the bump are started here, because they follow the tab count, not the fold. Decoration only: the header button
 *  already says the group, its tab count and whether it is open. */
export function GroupFolderGlyph({count}:{count:number}){
 const id='gf'+useId().replace(/[^a-zA-Z0-9]/g,''),sheets=folderSheets(count),root=useRef<SVGSVGElement>(null),boxes=useRef<(SVGRectElement|null)[]>([]);
 const previous=useRef<{count:number;sheets:number}|null>(null),timer=useRef(0),[leaving,setLeaving]=useState(0);
 // A sheet that is leaving is drawn once more, sinking, in the render where the count drops; `leaving` keeps it for the exit.
 const dropFrom=previous.current&&sheets<previous.current.sheets?previous.current.sheets:0,drawn=Math.max(sheets,leaving,dropFrom);
 useLayoutEffect(()=>()=>window.clearTimeout(timer.current),[]);
 useLayoutEffect(()=>{
  const before=previous.current;previous.current={count,sheets};
  if(!before||before.count===count)return;
  window.clearTimeout(timer.current);
  const ms=MOVE_MS*motionScale(root.current);
  if(sheets<before.sheets&&ms>0){setLeaving(before.sheets);timer.current=window.setTimeout(()=>setLeaving(0),ms);}else setLeaving(0);
  if(ms<=0)return;
  // The bump: a little larger when a tab came in, a little smaller when one left; it ends where it began.
  const peak=count>before.count?1.13:.92;
  root.current?.animate([{transform:'scale(1)'},{transform:`scale(${peak})`,offset:.4},{transform:'scale(1)'}],{duration:ms,easing:'cubic-bezier(.2,0,0,1)'});
  // The new sheet rises from behind the front plate to its place.
  for(let depth=before.sheets;depth<sheets;depth++)boxes.current[depth]?.animate([{opacity:0,translate:'0 5.5px'},{opacity:1,translate:'0 0'}],{duration:ms,easing:'cubic-bezier(.16,1,.3,1)'});
 },[count,sheets]);
 return <svg ref={root} className="gf" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false" data-sheets={sheets}>
  <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".34"/><stop offset="1" stopColor="currentColor" stopOpacity=".12"/></linearGradient></defs>
  <path className="gf-back" d={FOLDER_BACK}/>
  {Array.from({length:drawn},(_,index)=>drawn-1-index).map(depth=>{const box=FOLDER_SHEET_BOXES[depth];return <rect key={depth} ref={node=>{boxes.current[depth]=node;}} className="gf-sheet" data-depth={depth} data-leaving={depth>=sheets||undefined} x={box.x} y={box.y} width={box.w} height={box.h} rx="1.1"/>;})}
  <path className="gf-front" d={FOLDER_FRONT_CLOSED} fill={`url(#${id})`}/>
  <path className="gf-sheen" d={FOLDER_SHEEN_CLOSED}/>
 </svg>;
}
