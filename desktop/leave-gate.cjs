'use strict';
// A page that asks "Leave this site?" (its beforeunload handler), answered without stopping the browser (13.5).
//
// Electron decides a page's unload synchronously: the 'will-prevent-unload' handler either calls event.preventDefault() (the page may go) or returns (the
// page stays). Up to 13.4 every case Acira could not repeat afterwards (a reload, Back, a form, a script's navigation, a close the page was not asked
// about first) was asked with dialog.showMessageBoxSync, which holds the WHOLE main process until it is answered: every window froze, other tabs
// included, and a hidden test run waited ten minutes for a sheet nobody could see.
//
// Now the page always stays first, the question is asked without blocking anything (the card in the window, or the system sheet attached to it when there
// is no card), and Leave repeats what the person was doing with the page's own prompt waived for a few seconds. Only this page waits: a close keeps its
// closePage() promise open meanwhile (window close, quit and tab moves wait for the answer), a navigation is repeated after Leave.
//
// What was the person doing is told by (in this order): a close in progress (entry.closing), a reload or history step Acira made (entry.leaveIntent,
// set by guardUnload below), a typed address or a loading target (entry.navigation), the page's own navigation event (entry.navIntent, from
// page-input-preload.cjs: a script, a form, a meta refresh; a posting form is asked to submit itself again) and a link click (entry.linkIntent).
// Anything else is 'unknown': nothing can be repeated, so Stay and Leave both leave the page as it is, and Leave lets the person's next try through.
//
// Two details that matter: the repeat runs a moment after the answer (SETTLE_MS) and again, twice at most, if the page raised no new unload check
// (Chromium takes a close or reload that comes while it is still finishing the previous check for the one under way, which an answer that arrives at
// once runs into); and a close that comes while another question is up is ended, since nobody would answer it.
const APPROVE_MS=5000,INTENT_MS=2000,SETTLE_MS=120,RETRY_MS=800,RETRIES=2;

/** What is the page being asked to leave for? Pure. `entry` carries the fields named above; `now` is a time, `currentURL` the page's address. */
function classify(entry,now,currentURL){
  if(entry.closing)return {kind:'close'};
  const direct=entry.leaveIntent;
  if(direct&&now-direct.at<=INTENT_MS&&typeof direct.redo==='function')return {kind:direct.kind,redo:direct.redo};
  const nav=entry.navigation;
  if(nav&&nav.phase==='loading'&&nav.target&&nav.target!==currentURL)return {kind:'navigate',url:nav.target};
  const own=entry.navIntent;
  if(own&&now-own.at<=INTENT_MS&&typeof own.url==='string'){
    if(own.type==='reload')return {kind:'reload',redo:null};
    if(own.form)return {kind:'form',url:own.url,once:true};   // a posting form: the page is asked to submit it again; never run twice
    return {kind:'navigate',url:own.url};
  }
  const link=entry.linkIntent;
  if(link&&now-link.at<=INTENT_MS&&typeof link.url==='string')return {kind:'navigate',url:link.url};
  return {kind:'unknown'};
}

/** The 'will-prevent-unload' handler of one page.
 *   entry     the page's record (fields above, plus discarding, leaveApproved, askingLeave, cancelClose)
 *   contents  the page's webContents (isDestroyed, getURL)
 *   stay      ({keepClosing}) puts the page's loading state back as it was; it ends a pending close unless keepClosing
 *   ask       (intent) -> Promise<boolean> true = Leave. Must not block the process.
 *   perform   (intent) repeats what the person was doing (close again, reload, step back, go to the address)
 */
function createLeaveGate({entry,contents,stay,ask,perform,now=Date.now,settleMs=SETTLE_MS,retryMs=RETRY_MS,retries=RETRIES}){
  let events=0,asking=null;
  const gone=()=>{try{return contents.isDestroyed();}catch{return true;}};
  function handle(event){
    events++;
    if(entry.discarding){stay();return;}
    const at=now();
    if(entry.leaveApproved>at){event.preventDefault();return;}
    let intent;try{intent=classify(entry,at,contents.getURL());}catch{intent={kind:'unknown'};}
    entry.linkIntent=undefined;entry.navIntent=undefined;entry.leaveIntent=undefined;
    const holdClose=intent.kind==='close';
    stay({keepClosing:holdClose});
    if(entry.askingLeave){   // one question per page: a second press only keeps the page where it is
      if(holdClose&&asking!=='close')entry.cancelClose?.();   // a close that comes while another question is up is not held: nobody would answer it
      return;
    }
    entry.askingLeave=true;asking=intent.kind;
    let settled=false;
    const fail=()=>{entry.leaveApproved=0;entry.cancelClose?.();};   // a repeat that cannot run ends whatever close is still registered
    // Repeats what the person was doing, and again (twice at most) when the page raised no new unload check after it: Chromium takes a close or reload that comes while it
    // is still finishing the previous unload check (the renderer's reply) for the one under way, which an answer that arrives at once can run into.
    const run=attempt=>{
      if(gone())return;
      entry.leaveApproved=now()+APPROVE_MS;const mark=events;
      try{perform(intent);}catch{fail();return;}
      entry.leaveIntent=undefined;   // what the repeat itself recorded
      if(attempt<retries&&!intent.once)setTimeout(()=>{if(!gone()&&events===mark&&entry.leaveApproved>now())run(attempt+1);},retryMs);
    };
    const settle=leave=>{
      if(settled)return;settled=true;
      entry.askingLeave=false;asking=null;
      if(gone())return;   // a close finishes through the page's 'destroyed'
      // A close registered while this question was up (a burst of × presses, a window close) can have its wc.close() swallowed by Chromium (an earlier unload check is still being finished):
      // no 'will-prevent-unload' ever comes for it, nothing would end it, and every later × would return the old promise without closing anything. So, whatever the answer, a close
      // that is still registered is over, unless this question IS the close and the person said Leave (then the repeat below is that close).
      if(!(holdClose&&leave===true))entry.cancelClose?.();
      if(leave!==true)return;
      entry.leaveApproved=now()+APPROVE_MS;   // anything the page raises meanwhile is let through
      setTimeout(()=>run(0),settleMs);
    };
    let answer;try{answer=ask(intent);}catch{answer=false;}
    Promise.resolve(answer).then(settle,()=>settle(false));
  }
  return {handle,classify:()=>classify(entry,now(),contents.getURL())};
}

/** Puts Acira's own ways of leaving a page (reload, hard reload, Back, Forward, a step in the history list) on the record before they run, so the
 * question can be asked without a dialog that blocks, and Leave can repeat the step. Wrapped on the one page's webContents, so every caller is covered
 * (the toolbar, the menu, shortcuts, the context menu, extensions, swipes). `now` is a time source for tests. */
function guardUnload(contents,entry,now=Date.now){
  const history=contents.navigationHistory;
  const wrap=(owner,name,kind)=>{
    const original=owner&&owner[name];
    if(typeof original!=='function')return;
    const call=(...args)=>original.apply(owner,args);
    owner[name]=(...args)=>{entry.leaveIntent={kind,at:now(),redo:()=>call(...args)};return original.apply(owner,args);};
  };
  wrap(contents,'reload','reload');
  wrap(contents,'reloadIgnoringCache','reload');
  for(const name of ['goBack','goForward','goToIndex','goToOffset'])wrap(history,name,'history');
}

module.exports={createLeaveGate,classify,guardUnload,APPROVE_MS,INTENT_MS,SETTLE_MS,RETRY_MS,RETRIES};
