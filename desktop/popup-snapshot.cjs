'use strict';

const LIMITS=Object.freeze({timeoutMs:180,maxSources:5,maxArea:2000000,maxBytes:2*1024*1024,maxFrameBytes:1024*1024,maxImageSide:512,maxInFlight:8});
const rect=value=>value&&['x','y','width','height'].every(key=>Number.isFinite(value[key]))&&value.width>0&&value.height>0&&value.width<=12000&&value.height<=12000;
const intersect=(a,b)=>{const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),right=Math.min(a.x+a.width,b.x+b.width),bottom=Math.min(a.y+a.height,b.y+b.height);return right>x&&bottom>y?{x,y,width:right-x,height:bottom-y}:null;};
const sameRect=(a,b)=>!!a&&!!b&&['x','y','width','height'].every(key=>a[key]===b[key]);
/** A visible native view may still belong to an older tab context while cleanup blocks its replacement. */
function popupBackdropPageOwned(state,id,entry,{privateMode,mayBrowse,sessionFor}){
 const tab=state.tabs.find(item=>item.id===id),profile=tab&&state.browserProfiles.find(item=>item.id===tab.browserProfileId),native=entry.profile,wc=entry.view?.webContents;
 if(!tab||tab.contentKind!=='web'||!profile||!native||!wc||entry.tabId!==id||entry.retired||tab.browserProfileId!==entry.tabProfileId||(tab.privacy||undefined)!==(entry.privacy||undefined)||!!tab.privacy!==!!entry.privateTab||entry.profileId!==native.id||!!profile.private!==!!privateMode)return false;
 if(!privateMode&&!mayBrowse(profile.id))return false;
 if(tab.privacy){if(!native.private||native.tab!==id)return false;}
 else if(native.id!==profile.id||native.partition!==profile.partition||!!native.private!==!!profile.private||!!native.tor!==!!profile.tor)return false;
 const expected=tab.privacy||(profile.tor?'tor':profile.private?'private':undefined),actual=entry.privacy||(native.tor?'tor':native.private?'private':undefined);
 return expected===actual&&!wc.isDestroyed()&&wc.session===sessionFor(native.partition)&&require('./browser-services/private-extension-sessions.cjs').persistent(wc.session)===!native.private;
}

/** All inputs come from the owned native resolver. The renderer supplies no crop or source selector. */
function snapshotRegion(context){
 if(!context||!rect(context.target)||context.trigger&&!rect(context.trigger)||context.auxiliary&&!rect(context.auxiliary)||!Number.isFinite(context.scale)||context.scale<.5||context.scale>2)return null;
 const regions=[context.target,context.trigger,context.auxiliary].filter(Boolean),pad=64;
 const x=Math.min(...regions.map(box=>box.x))-pad,y=Math.min(...regions.map(box=>box.y))-pad;
 return {x,y,width:Math.max(...regions.map(box=>box.x+box.width))+pad-x,height:Math.max(...regions.map(box=>box.y+box.height))+pad-y};
}
function snapshotPlan(context,sources){
 const region=snapshotRegion(context);if(!region||!Array.isArray(sources)||sources.length>LIMITS.maxSources)return [];
 const plan=[];let area=0;
 for(const source of sources){
  if(typeof source.key!=='string'||source.key.length>160||!Number.isFinite(source.radius)||source.radius<0||!rect(source.bounds)||!source.contents||source.contents.isDestroyed()||source.contents.isLoadingMainFrame?.()||typeof source.contents.capturePage!=='function')return [];
  const overlap=intersect(region,source.bounds);if(!overlap)continue;
  // Round inward so capturePage never samples outside the authorized target or source view.
  const x=Math.ceil((overlap.x-source.bounds.x)*context.scale),y=Math.ceil((overlap.y-source.bounds.y)*context.scale),right=Math.floor((overlap.x+overlap.width-source.bounds.x)*context.scale),bottom=Math.floor((overlap.y+overlap.height-source.bounds.y)*context.scale);
  if(right<=x||bottom<=y)continue;
  const capture={x,y,width:right-x,height:bottom-y};area+=capture.width*capture.height;if(area>LIMITS.maxArea)return [];
  plan.push({source:{...source,bounds:{...source.bounds}},capture,bounds:{x:source.bounds.x+x/context.scale,y:source.bounds.y+y/context.scale,width:capture.width/context.scale,height:capture.height/context.scale}});
 }
 return plan;
}
function sameSnapshotContext(a,b){
 return !!a&&!!b&&a.generation===b.generation&&a.context===b.context&&a.scale===b.scale&&sameRect(a.target,b.target)&&(!a.trigger&&!b.trigger||sameRect(a.trigger,b.trigger))&&(!a.auxiliary&&!b.auxiliary||sameRect(a.auxiliary,b.auxiliary));
}
function sameSnapshotSources(plan,sources){
 return plan.length===sources.length&&plan.every(({source})=>sources.some(next=>next.key===source.key&&next.contents===source.contents&&next.radius===source.radius&&sameRect(next.bounds,source.bounds)));
}
function encodeSnapshot(image,current=()=>true,maxBytes=LIMITS.maxFrameBytes){
 if(!image||image.isEmpty())return null;
 const size=image.getSize();if(!rect({x:0,y:0,...size}))return null;
 let previous='';
 // The frost is blurred 32px, so a 512px still is indistinguishable from a full-resolution one and encodes ~4x faster:
 // the glass lands while the sheet is still condensing, even at 150%. No unbounded quality search: high-entropy
 // photographs get at most four smaller PNG attempts, each still mapped
 // to the same CSS crop. Check the owner/deadline around every native resize/encode; never convert late pixels.
 for(const side of [LIMITS.maxImageSide,384,256,192]){
  if(!current())return null;
  const factor=Math.max(1,size.width/side,size.height/side),width=Math.max(1,Math.round(size.width/factor)),height=Math.max(1,Math.round(size.height/factor)),dimensions=width+'x'+height;
  if(dimensions===previous)continue;previous=dimensions;
  const sample=factor>1?image.resize({width,height,quality:'good'}):image;if(!current())return null;
  const png=sample.toPNG();if(!current())return null;
  if(!Buffer.isBuffer(png)||png.length<8||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return null;
  if(png.length<=Math.min(maxBytes,LIMITS.maxFrameBytes))return png;
 }
 return null;
}
module.exports={LIMITS,snapshotRegion,snapshotPlan,sameSnapshotContext,sameSnapshotSources,encodeSnapshot,popupBackdropPageOwned};
