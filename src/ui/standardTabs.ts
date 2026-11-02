import { compactOverflowMetrics } from './compactTabs';
import { fitGroupLabels,stripLayout,stripOverhead,type StripMetricEntry } from './tabStripLayout';

/** Give titles the available room first; reserve scroll controls only at the icon floor. */
export function standardTabMetrics(available:number,tabs:readonly StripMetricEntry[],frozenWidth:number|null=null){
 const gap=4,iconWidth=40,maxWidth=200;
 const pinned=tabs.filter(tab=>tab.pinned&&tab.fixedWidth===undefined).length,ordinary=tabs.filter(tab=>!tab.pinned&&tab.fixedWidth===undefined).length;
 const fitted=fitGroupLabels(tabs,Math.max(0,available-36),iconWidth);
 const fixed=fitted.reduce<number>((sum,width)=>sum+(width||0),0),overhead=stripOverhead(tabs);
 const room=Math.max(0,available-36),minimum=fixed+(pinned+ordinary)*iconWidth+overhead;
 if(minimum>room+1){
  const viewport=Math.max(0,room-52),metrics=compactOverflowMetrics(viewport,tabs.map((tab,index)=>({...tab,fixedWidth:fitted[index]})));
  return {...metrics,viewport,overflow:true,iconOnly:true,width:metrics.widths[tabs.findIndex(tab=>tab.fixedWidth===undefined)]||iconWidth};
 }
 const natural=Math.max(iconWidth,Math.min(maxWidth,(room-fixed-pinned*iconWidth-overhead)/Math.max(1,ordinary)));
 const width=frozenWidth===null?natural:Math.min(natural,Math.max(iconWidth,frozenWidth));
 const widths=tabs.map((tab,index)=>fitted[index]??(tab.pinned?iconWidth:width)),{offsets,occupied}=stripLayout(tabs,widths);
 return {widths,offsets,occupied,gap,pitch:0,viewport:Math.min(room,occupied),overflow:false,iconOnly:width<64,width};
}

/** Resolve at gesture start, so scrolling is current without resize observers moving idle tabs. */
export function standardTabDragConstraints(viewport:{current:{scrollLeft:number;clientWidth:number}|null},offset:number,width:number){
 return {
  get left(){return (viewport.current?.scrollLeft||0)-offset;},
  get right(){return (viewport.current?.scrollLeft||0)+Math.max(0,(viewport.current?.clientWidth||width)-width)-offset;}
 };
}
