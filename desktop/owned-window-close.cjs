/** Close an actual owned auxiliary window without treating a cancelled
 * beforeunload or native close event as accepted. Electron's will-prevent-unload
 * decision is synchronous, so a page that asks to be confirmed always stays at
 * first. `chooseLeave(window)` then asks: it may answer at once (true = Leave) or
 * return a promise, which keeps the rest of the browser running while the question
 * is open (13.5; a blocking box froze every window until it was answered). Leave
 * closes the window again with the page's own prompt waived. */
function closeOwnedWindow(window,chooseLeave){
 if(window.isDestroyed())return Promise.resolve(true);
 return new Promise(resolve=>{
  let done=false,closeEvent,approved=false,asking=false;const contents=window.webContents;
  const finish=value=>{if(done)return;done=true;window.removeListener('close',observe);window.removeListener('closed',closed);contents.removeListener('will-prevent-unload',prevented);resolve(value);};
  const observe=event=>{closeEvent=event;},closed=()=>finish(true);
  const again=()=>{if(window.isDestroyed()){finish(true);return;}approved=true;try{window.close();if(closeEvent?.defaultPrevented&&!window.isDestroyed())finish(false);}catch{finish(false);}};
  const prevented=event=>{
   if(approved){event.preventDefault();return;}
   if(asking)return;   // a second attempt while the question is up only keeps the page where it is
   let answer;try{answer=chooseLeave(window);}catch{answer=false;}
   if(answer&&typeof answer.then==='function'){
    asking=true;
    // one turn later: Electron answers Chromium for this unload after the handler returned, and a close repeated before that answer is taken for the one under way
    answer.then(leave=>{setImmediate(()=>{asking=false;if(leave===true)again();else finish(false);});},()=>{setImmediate(()=>{asking=false;finish(false);});});
    return;
   }
   if(answer===true)event.preventDefault();else finish(false);
  };
  window.on('close',observe);window.once('closed',closed);contents.on('will-prevent-unload',prevented);
  try{window.close();if(closeEvent?.defaultPrevented&&!window.isDestroyed())finish(false);}catch{finish(false);}
 });
}
module.exports={closeOwnedWindow};
