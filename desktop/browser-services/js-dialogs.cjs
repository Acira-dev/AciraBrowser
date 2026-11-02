'use strict';
// A page's alert(), confirm() and prompt() (desktop/browser-services/js-dialog-preload.cjs asks here, synchronously) shown as the
// browser's own card in the page instead of a system message box. The page stays blocked until the reply is set, as with the native
// ones. Nothing is trusted from the page: kind, message and default text are checked and clamped, and the asker must be a website
// tab of a window that can show the card (anything else gets {native:true} and the original dialog).
const MUTE_AFTER=2,WINDOW_MS=10000,MAX_MESSAGE=2000,MAX_INITIAL=1000;
const hostOf=value=>{try{const url=new URL(value);return /^https?:$/.test(url.protocol)?url.host:'';}catch{return '';}};

function createJsDialogs({controllers,t,now=()=>Date.now()}){
 const seen=new WeakMap();
 function ownerOf(wc){
  for(const controller of controllers){
   if(controller.closing||!controller.sitePrompt||!controller.pages)continue;
   for(const [tabId,entry] of controller.pages)if(entry.view?.webContents===wc)return {controller,tabId};
  }
  return null;
 }
 /** How often this page asked lately; a page that keeps asking is offered "Stop dialogs from this page" and, once stopped, is answered with the defaults until it moves on. */
 function history(wc){
  let record=seen.get(wc);
  if(!record){
   record={times:[],muted:false};seen.set(wc,record);
   try{wc.on('did-start-navigation',(event,_url,inPlace,isMainFrame)=>{const main=event?.isMainFrame??isMainFrame,same=event?.isSameDocument??inPlace;if(main&&!same){record.muted=false;record.times=[];}});}catch{}
  }
  record.times=record.times.filter(at=>now()-at<WINDOW_MS);
  return record;
 }
 function handle(event,payload){
  let done=false;
  const reply=value=>{if(done)return;done=true;try{event.returnValue=value;}catch{}};
  try{
   const wc=event.sender;
   if(!payload||typeof payload!=='object'||!['alert','confirm','prompt'].includes(payload.kind)||typeof payload.message!=='string'){reply({native:true});return;}
   const owner=wc&&!wc.isDestroyed()?ownerOf(wc):null;
   if(!owner||!owner.controller.sitePrompt.enabled()){reply({native:true});return;}
   const kind=payload.kind,defaults=kind==='alert'?{ok:true}:kind==='confirm'?{value:false}:{value:null};
   const record=history(wc);
   if(record.muted){reply(defaults);return;}
   const host=hostOf(event.senderFrame?.url||wc.getURL())||hostOf(wc.getURL());
   const offerMute=record.times.length>=MUTE_AFTER;
   record.times.push(now());
   const labels=[t('dialog.cancel'),t('sitePrompt.ok')];
   const asking=owner.controller.sitePrompt.showMessageBox({
    type:'question',message:t('sitePrompt.says',{host:host||wc.getURL()}),detail:payload.message.slice(0,MAX_MESSAGE),
    buttons:kind==='alert'?[labels[1]]:labels,defaultId:kind==='alert'?0:1,cancelId:0,
    site:{centered:true,contents:wc,host:host||'',...(kind==='prompt'?{input:{value:String(payload.initial||'').slice(0,MAX_INITIAL)}}:{}),...(offerMute?{mute:{label:t('sitePrompt.stopDialogs')}}:{}),stale:()=>wc.isDestroyed()},
   });
   asking.then(result=>{
    if(result.muted===true)record.muted=true;
    const accepted=!result.dismissed&&(kind==='alert'||result.response===1);
    if(kind==='alert')reply({ok:true});
    else if(kind==='confirm')reply({value:accepted});
    else reply({value:accepted?String(result.value??''):null});
   },()=>reply(defaults));
  }catch{reply({native:true});}
 }
 return {handle};
}
module.exports={createJsDialogs,hostOf};
