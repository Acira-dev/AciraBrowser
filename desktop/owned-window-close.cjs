/** Close an actual owned auxiliary window without treating a cancelled
 * beforeunload or native close event as accepted. Confirmation is synchronous
 * because Electron's will-prevent-unload decision is synchronous. */
function closeOwnedWindow(window,chooseLeave){
 if(window.isDestroyed())return Promise.resolve(true);
 return new Promise(resolve=>{
  let done=false,closeEvent;const contents=window.webContents;
  const finish=value=>{if(done)return;done=true;window.removeListener('close',observe);window.removeListener('closed',closed);contents.removeListener('will-prevent-unload',prevented);resolve(value);};
  const observe=event=>{closeEvent=event;},closed=()=>finish(true);
  const prevented=event=>{let leave=false;try{leave=chooseLeave(window)===true;}catch{}if(leave)event.preventDefault();else finish(false);};
  window.on('close',observe);window.once('closed',closed);contents.on('will-prevent-unload',prevented);
  try{window.close();if(closeEvent?.defaultPrevented&&!window.isDestroyed())finish(false);}catch{finish(false);}
 });
}
module.exports={closeOwnedWindow};
