import { fitGroupLabels,stripLayout,stripOverhead,type StripMetricEntry } from './tabStripLayout';
/** Narrow browser tabs yield labels before reaching their 38px icon floor. When an even share would cut titles to a few
 * letters (under labelFloor), the active tab keeps its title and the others become favicon pills (Safari, Arc). */
export const compactLabelFloor=96;
export function compactTabMetrics(available:number,tabs:readonly StripMetricEntry[],titles:boolean,active=-1){
 const gap=4,iconWidth=38,maxWidth=144;
 const pinned=tabs.filter(tab=>tab.pinned&&tab.fixedWidth===undefined).length,ordinary=tabs.filter(tab=>!tab.pinned&&tab.fixedWidth===undefined).length;
 const fitted=fitGroupLabels(tabs,available,iconWidth),fixed=fitted.reduce<number>((sum,width)=>sum+(width||0),0);
 const room=Math.max(0,available)-stripOverhead(tabs)-pinned*iconWidth-fixed;
 const width=titles?Math.max(iconWidth,Math.min(maxWidth,room/Math.max(1,ordinary))):iconWidth;
 const lead=titles&&width<compactLabelFloor&&ordinary>1&&tabs[active]&&!tabs[active].pinned&&fitted[active]===undefined?Math.max(iconWidth,Math.min(maxWidth,room-(ordinary-1)*iconWidth)):0;
 const widths=tabs.map((tab,index)=>fitted[index]??(tab.pinned?iconWidth:lead?(index===active?lead:iconWidth):width));
 return stripLayout(tabs,widths,gap);
}

/** Fit whole icon pitches to the viewport so overflowing edges cut real favicons.
 * Wider end targets let the first/last tab remain fully visible at either limit.
 * Below two pitches, preserving one complete hit target takes priority. */
export function compactOverflowMetrics(available:number,tabs:readonly StripMetricEntry[]){
 const base=compactTabMetrics(available,tabs,false);
 if(available<84||tabs.length<3||tabs.some(tab=>tab.fixedWidth!==undefined))return {...base,pitch:0};
 const pitch=available/Math.floor(available/42),widths=tabs.map((_,index)=>index===0||index===tabs.length-1?pitch*1.5-2:pitch-4);
 const offsets:number[]=[];let occupied=0;
 for(const width of widths){offsets.push(occupied);occupied+=width+4;}
 return {widths,offsets,occupied:occupied-4,gap:4,pitch};
}

/** Equal targets start at the track edge. Only intermediate scroll positions
 * align to favicon centers; true endpoints never acquire artificial padding. */
export function compactEqualOverflowMetrics(available:number,tabs:readonly StripMetricEntry[]){
 const base=compactTabMetrics(available,tabs,false);
 if(available<84||tabs.length<3||tabs.some(tab=>tab.fixedWidth!==undefined))return {...base,pitch:0,phase:0};
 const pitch=available/Math.floor(available/42),width=pitch-4;
 const widths=tabs.map(()=>width),offsets=tabs.map((_,index)=>index*pitch);
 return {widths,offsets,occupied:tabs.length*pitch-4,gap:4,pitch,phase:width/2};
}

export function compactScrollTarget(target:number,max:number,pitch:number,phase=0){
 const clamped=Math.max(0,Math.min(max,target));
 if(!pitch)return clamped;
 const grid=Math.max(0,Math.min(max,Math.round((clamped-phase)/pitch)*pitch+phase));
 return phase?[grid,0,max].reduce((best,value)=>Math.abs(value-clamped)<Math.abs(best-clamped)?value:best,grid):grid;
}

export function compactRevealTarget(scroll:number,viewport:number,left:number,width:number,max:number,pitch:number,phase=0){
 // Clear the 32px overflow fade so a revealed tab is never left half-faded at the edge.
 const padding=Math.min(34,Math.max(0,(viewport-width)/2));
 const low=Math.min(max,Math.max(0,left+width-viewport+padding)),high=Math.min(max,Math.max(low,left-padding));
 const target=Math.max(low,Math.min(high,scroll));
 if(!pitch)return Math.max(0,Math.min(max,target));
 if(phase){
  const first=Math.ceil((low-phase-.01)/pitch)*pitch+phase,last=Math.floor((high-phase+.01)/pitch)*pitch+phase;
  const choices=[0,max,...first<=last?[Math.max(first,Math.min(last,compactScrollTarget(target,max,pitch,phase)))]:[]].filter(value=>value>=low-.01&&value<=high+.01);
  return choices.length?choices.reduce((best,value)=>Math.abs(value-scroll)<Math.abs(best-scroll)?value:best,choices[0]):Math.max(0,Math.min(max,target));
 }
 const first=Math.ceil((low-.01)/pitch)*pitch,last=Math.floor((high+.01)/pitch)*pitch;
 return first<=last?Math.max(first,Math.min(last,compactScrollTarget(target,max,pitch))):compactScrollTarget(target,max,pitch);
}
