/** One spacing model for the DOM trays and the moving tab-selection surface. */
export type StripMetricEntry={pinned:boolean;fixedWidth?:number;minWidth?:number;header?:boolean;group?:{id:string};splitGroup?:{id:string}};
/** What an entry is joined to: its tab group, or else its split (one joined container each, R3-24). */
const joined=(entry?:StripMetricEntry)=>entry?.group?.id??(entry?.splitGroup?`split:${entry.splitGroup.id}`:undefined);
export function stripSpacing(entries:readonly StripMetricEntry[],gap=4){
 return entries.map((entry,index)=>{
  const previous=entries[index-1],group=joined(entry),prior=joined(previous);
  if(!index)return group?4:0; // 2px margin + 2px tray padding
  return group&&group===prior?2:gap+(prior?4:0)+(group?4:0);
 });
}
export function stripLayout(entries:readonly StripMetricEntry[],widths:number[],gap=4){
 const spacing=stripSpacing(entries,gap),offsets:number[]=[];let occupied=0;
 for(let index=0;index<widths.length;index++){occupied+=spacing[index];offsets.push(occupied);occupied+=widths[index];}
 if(joined(entries.at(-1)))occupied+=4;
 return {widths,offsets,occupied,gap};
}
export function stripOverhead(entries:readonly StripMetricEntry[],gap=4){return stripLayout(entries,entries.map(()=>0),gap).occupied;}
/** Labels give way only after ordinary tabs reach their icon floor. */
export function fitGroupLabels(entries:readonly StripMetricEntry[],available:number,iconWidth:number){
 const fixed=entries.reduce((sum,entry)=>sum+(entry.fixedWidth||0),0),ordinary=entries.filter(entry=>entry.fixedWidth===undefined).length;
 const deficit=Math.max(0,fixed+ordinary*iconWidth+stripOverhead(entries)-available),flex=entries.reduce((sum,entry)=>sum+(entry.header?Math.max(0,(entry.fixedWidth||56)-(entry.minWidth||56)):0),0);
 return entries.map(entry=>entry.fixedWidth===undefined?undefined:entry.fixedWidth-(entry.header&&flex?Math.min(1,deficit/flex)*Math.max(0,entry.fixedWidth-(entry.minWidth||56)):0));
}
