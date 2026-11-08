'use strict';
// The two ids of a tab. chrome.tabs gives an extension a tab id that stays the same for the tab's life; Electron, the engine, Chromium's own scripting and the toolbar know the
// tab by its page's (webContents) id. They are the same number for a tab that was opened in this run, and different for a tab restored from the last session (2000000002 until
// it wakes) or one that got a new page. Everything that tells an extension about a tab must say the extension's id (ofPage), and everything that takes an id from an extension
// and hands it to Electron must use the page's (pageOf). The tabs package (ext-api/tabs.cjs) registers the real answers; without it (tests, private sessions) both are the page id.
const bridge=require('./bridge.cjs');

const NAME='tab-ids';
/** The id an extension of this session knows the page by. */
function ofPage(session,wc){
 try{const found=bridge.controller(session,NAME)?.ofPage(wc);if(Number.isInteger(found))return found;}catch{/* the page's own id */}
 return wc&&Number.isInteger(wc.id)?wc.id:undefined;
}
/** The page id behind an extension tab id; an id nobody maps is returned as given. */
function pageOf(session,tabId){
 if(!Number.isInteger(tabId))return tabId;
 try{const found=bridge.controller(session,NAME)?.pageOf(tabId);if(Number.isInteger(found))return found;}catch{/* as given */}
 return tabId;
}
const register=(session,controller)=>bridge.register(session,NAME,controller);

module.exports={ofPage,pageOf,register,NAME};
