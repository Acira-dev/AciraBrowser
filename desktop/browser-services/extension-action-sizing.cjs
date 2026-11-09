'use strict';
// Recover CSS minimum/intrinsic dimensions when native preferred size reports an
// initial tiny viewport. Only public PopupView/BrowserWindow/WebContents APIs.
function fitExtensionAction(popup){
 const window=popup?.browserWindow,wc=popup?.webContents||window?.webContents;if(!window||!wc)return()=>{};
 const timers=new Set();let disposed=false,busy=false,queued=false;
 const sameExtension=()=>{try{const u=new URL(wc.getURL());return u.protocol==='chrome-extension:'&&u.hostname===popup.extensionId;}catch{return false;}};
 async function measure(){if(disposed||busy||window.isDestroyed()||wc.isDestroyed()||!sameExtension())return;busy=true;const sizedAs=popup.size;/* the framed popup's size object (a new one at every resize); the library's has none */
  try{const size=await wc.executeJavaScript(`(()=>{const body=document.body;if(!body)return null;const style=getComputedStyle(body);let height=Math.max(document.documentElement.scrollHeight,body.scrollHeight);const walker=document.createTreeWalker(body,NodeFilter.SHOW_ELEMENT);let node,count=0;while((node=walker.nextNode())&&++count<2000){if(node.scrollHeight<=node.clientHeight)continue;const rect=node.getBoundingClientRect();if(rect.top<0||rect.top>600||rect.width<1||rect.height<1)continue;const overflow=getComputedStyle(node).overflowY;if(overflow==='auto'||overflow==='scroll')height=Math.max(height,rect.top+node.scrollHeight);}return {width:Math.max(document.documentElement.scrollWidth,body.scrollWidth),height,minWidth:Math.max(parseFloat(style.minWidth)||0,parseFloat(style.width)||0),minHeight:parseFloat(style.minHeight)||0};})()`);if(!size||disposed||window.isDestroyed()||wc.isDestroyed()||!sameExtension())return;if(popup.size!==sizedAs){/* the window changed size while the page was measured: this is the size of a window that is gone, and setSize() with it can leave the popup larger than its page for good (scrollWidth never reports less than the window) */schedule(60);return;}
   const clamp=(value,min,max)=>Number.isFinite(value)?Math.max(min,Math.min(max,Math.ceil(value))):min;
   const minWidth=clamp(size.minWidth,25,800),minHeight=clamp(size.minHeight,25,600);window.setMinimumSize(minWidth,minHeight);popup.setSize({width:clamp(Math.max(size.width,minWidth),25,800),height:clamp(Math.max(size.height,minHeight),25,600)});
  }catch{}finally{busy=false;}
 }
 function schedule(delay=80){if(disposed)return;const timer=setTimeout(()=>{timers.delete(timer);void measure();},delay);timer.unref?.();timers.add(timer);}
 function update(){if(queued||disposed)return;queued=true;const timer=setTimeout(()=>{timers.delete(timer);queued=false;void measure();},80);timer.unref?.();timers.add(timer);}
 function dispose(){if(disposed)return;disposed=true;for(const timer of timers)clearTimeout(timer);timers.clear();if(!wc.isDestroyed()){wc.removeListener('preferred-size-changed',update);wc.removeListener('did-finish-load',update);wc.removeListener('did-navigate-in-page',update);}}
 wc.on('preferred-size-changed',update);wc.on('did-finish-load',update);wc.on('did-navigate-in-page',update);window.once('closed',dispose);
 void popup.whenReady().then(()=>{for(const delay of [0,150,500,1500])schedule(delay);}).catch(()=>{});return dispose;
}
module.exports={fitExtensionAction};
