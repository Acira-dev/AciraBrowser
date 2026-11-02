'use strict';
const {LIMITS,snapshotRegion,snapshotPlan,sameSnapshotContext,sameSnapshotSources,encodeSnapshot}=require('./popup-snapshot.cjs');

/** App-internal live material. Grants only an owned renderer, never a desktop,
 * screen, arbitrary tab ID, audio track, or a source chosen by web content. */
class PopupBackdropBroker {
  constructor(resolveFrame) {
    this.resolveFrame=resolveFrame;
    this.owners=new Map();this.pending=new Map();this.sessions=new WeakSet();
    this.snapshotPending=new Map();this.snapshotUsed=new WeakMap();this.snapshotCaptures=0;
  }
  register(contents,owner) {
    this.owners.set(contents.id,{contents,...owner});
    contents.once('destroyed',()=>{this.owners.delete(contents.id);this.pending.delete(contents.id);const snapshot=this.snapshotPending.get(contents.id);if(snapshot)snapshot.cancelled=true;});
    const session=contents.session;
    if(this.sessions.has(session))return;
    this.sessions.add(session);
    // This is the app-UI session; website/profile sessions retain their existing
    // permission policy. A grant must already be armed by the owned popup IPC.
    session.setPermissionCheckHandler((wc,permission)=>permission==='display-capture'&&this.allowed(wc));
    session.setPermissionRequestHandler((wc,permission,callback,details)=>{
      // Electron requests `media` with an empty mediaTypes list before its
      // display handler. Camera/microphone requests carry video/audio instead.
      const display=permission==='display-capture'||permission==='media'&&details?.isMainFrame===true&&Array.isArray(details.mediaTypes)&&details.mediaTypes.length===0;
      callback(display&&this.allowed(wc));
    });
    session.setDisplayMediaRequestHandler((request,callback)=>{
      const wc=request.frame&&this.resolveFrame(request.frame),grant=wc&&this.pending.get(wc.id);
      if(!this.allowed(wc)||request.frame!==wc.mainFrame||request.audioRequested||!request.videoRequested||grant.consumed){callback(null);return;}
      grant.consumed=true;
      try{callback({video:grant.source.mainFrame});}catch{try{callback(null);}catch{}}
    });
  }
  allowed(contents) {
    if(!contents||contents.isDestroyed())return false;
    const grant=this.pending.get(contents.id),owner=this.owners.get(contents.id);
    return !!(grant&&owner&&grant.until>Date.now()&&owner.currentId()===grant.id&&!grant.source.isDestroyed()&&owner.sources().some(source=>source.key===grant.key&&source.contents===grant.source));
  }
  metadata(contents,id) {
    const owner=this.owners.get(contents.id);
    if(!owner||!Number.isSafeInteger(id)||owner.currentId()!==id||contents.isDestroyed())throw new Error('Popup backdrop is outside the active surface');
    return {id,sources:owner.sources().slice(0,3).map(({key,bounds,radius=0})=>({key,bounds,radius}))};
  }
  /** The renderer's descriptor request. A popup that closed between the request and now is answered with no sources (as snapshot() does):
   *  the renderer already treats that as "no material" for a popup that is leaving, and the main process no longer logs an error for it. */
  describe(contents,id) {
    const owner=contents&&this.owners.get(contents.id);
    if(owner&&!contents.isDestroyed()&&Number.isSafeInteger(id)&&owner.currentId()!==id)return {id,sources:[]};
    return this.metadata(contents,id);
  }
  async start(contents,id,key) {
    this.metadata(contents,id);
    const owner=this.owners.get(contents.id),source=owner.sources().find(source=>source.key===key);
    if(typeof key!=='string'||key.length>160||!source||source.contents.isDestroyed()||this.pending.has(contents.id))throw new Error('Invalid popup material source');
    const grant={id,key,source:source.contents,until:Date.now()+1200,consumed:false};
    this.pending.set(contents.id,grant);
    let timer;
    try{
      // A real menu action in the trusted UI authorizes only this internal
      // compositor request. The receiver keeps the MediaStream in its renderer.
      const script=`Promise.resolve(window.__aciraPopupCapture(${JSON.stringify(id)},${JSON.stringify(key)})).catch(error=>{throw new Error(String(error?.name||'CaptureError')+': '+String(error?.message||error))})`;
      await Promise.race([contents.executeJavaScript(script,true),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Live popup material timed out')),1000);})]);
      if(!this.allowed(contents))throw new Error('Popup closed or source retired while material prepared');
      return true;
    }finally{clearTimeout(timer);if(this.pending.get(contents.id)===grant)this.pending.delete(contents.id);}
  }
  /** One cropped, in-memory frame per source for this popup generation. No permission handler, stream, file or cache. */
  async snapshot(contents,id){
    const empty={id,sources:[]},owner=contents&&this.owners.get(contents.id);
    if(!owner||owner.contents!==contents||contents.isDestroyed()||!Number.isSafeInteger(id)||owner.currentId()!==id)return empty;
    const context=owner.snapshotContext?.(),region=snapshotRegion(context);if(!region)return empty;
    const used=this.snapshotUsed.get(contents),geometry=JSON.stringify([context.scale,context.target,context.trigger,context.auxiliary]);
    if(this.snapshotPending.has(contents.id)||used?.id===id&&used.geometry===geometry)return empty;
    const plan=snapshotPlan(context,owner.sources(region));if(!plan.length||this.snapshotCaptures+plan.length>LIMITS.maxInFlight)return empty;
    const until=Date.now()+LIMITS.timeoutMs,token={cancelled:false},retire=()=>{token.cancelled=true;},watched=new Set([contents,...plan.map(item=>item.source.contents)]),identities=plan.map(({source})=>({contents:source.contents,frame:source.contents.mainFrame,url:source.contents.getURL()}));
    const navigate=(event,_url,_inPlace,isMainFrame)=>{if((event?.isMainFrame??isMainFrame)!==false)retire();};
    const valid=()=>!token.cancelled&&Date.now()<until&&!contents.isDestroyed()&&this.owners.get(contents.id)===owner&&owner.currentId()===id&&sameSnapshotContext(context,owner.snapshotContext?.())&&identities.every(item=>!item.contents.isDestroyed()&&item.contents.mainFrame===item.frame&&item.contents.getURL()===item.url)&&sameSnapshotSources(plan,snapshotPlan(context,owner.sources(region)).map(item=>item.source));
    this.snapshotUsed.set(contents,{id,geometry});this.snapshotPending.set(contents.id,token);
    for(const wc of watched){wc.on('did-start-navigation',navigate);wc.on('render-process-gone',retire);wc.on('destroyed',retire);}
    let timer;
    const work=Promise.all(plan.map(async({source,capture,bounds})=>{
      if(!valid())return null;this.snapshotCaptures++;
      try{
        const image=await source.contents.capturePage(capture,{stayHidden:true,stayAwake:false});
        if(!valid())return null;
        const png=encodeSnapshot(image,valid,Math.floor(LIMITS.maxBytes/plan.length));if(!png||!valid())return null;
        return {key:source.key,bounds,radius:source.radius||0,sourceBounds:{...source.bounds},png};
      }catch{return null;}finally{this.snapshotCaptures--;}
    })).then(frames=>{
      if(!valid()||frames.some(frame=>!frame)||frames.reduce((sum,frame)=>sum+frame.png.length,0)>LIMITS.maxBytes)return empty;
      return {id,sources:frames.map(({png,...frame})=>({...frame,image:'data:image/png;base64,'+png.toString('base64')}))};
    }).catch(()=>empty);
    // A timed-out native capture cannot be cancelled; keep its no-pixels pending token until it settles, refusing
    // further requests from this owner. Late images are discarded before PNG conversion and never published.
    void work.finally(()=>{if(this.snapshotPending.get(contents.id)===token)this.snapshotPending.delete(contents.id);});
    try{return await Promise.race([work,new Promise(resolve=>{timer=setTimeout(()=>{retire();resolve(empty);},LIMITS.timeoutMs);})]);}
    finally{clearTimeout(timer);retire();for(const wc of watched){wc.removeListener('did-start-navigation',navigate);wc.removeListener('render-process-gone',retire);wc.removeListener('destroyed',retire);}}
  }
}
module.exports={PopupBackdropBroker};
