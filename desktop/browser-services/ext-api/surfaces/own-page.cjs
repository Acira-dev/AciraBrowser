'use strict';
// When one of Acira's own pages (Settings, New tab, History...) is in front, a key or a click on an extension's button is not on a website. Chrome tells the extension about such a
// page as a tab like any other (a chrome:// address; nothing on it to read or script) and the extension does what it can with it: a popup opens, a command is heard, anything that
// needs a website finds none. The engine only knows website pages, so Acira sent the click to the last website tab behind the page: onClicked fired for that tab and it got the
// activeTab grant, a website the person was not looking at. These two questions let action.cjs and commands.cjs keep to the tab that is in front.
const quiet=fn=>{try{return fn();}catch{return undefined;}};

/** Only the tab list of Acira's windows can say which tab is in front; a private session that runs extensions has none. */
const modelled=api=>Boolean(quiet(()=>api.store()?.impl?.tabModel));

/** Is this page the tab on screen in its window? false when another tab, such as one of Acira's own pages, is; undefined when the tab list cannot say.
 *  The call is made as the extension: a handler refuses a caller that is no extension (an answer of {__acira_error}, which is "cannot say"). */
function pageInFront(api,extension,webContents){
 if(!extension||!webContents||!modelled(api))return undefined;
 const get=quiet(()=>api.handler('tabs.get'));
 const tab=typeof get==='function'?quiet(()=>get({type:'frame',sender:null,extension},webContents.id)):undefined;
 return tab&&typeof tab.active==='boolean'?tab.active:undefined;
}

/** The tab on screen in the window the person is using, as chrome.tabs describes it to this extension (an Acira page is a chrome:// tab); undefined when the tab list cannot say. */
function frontTab(api,extension){
 if(!extension||!modelled(api))return undefined;
 const query=quiet(()=>api.handler('tabs.query'));
 const found=typeof query==='function'?quiet(()=>query({type:'frame',sender:null,extension},{active:true,lastFocusedWindow:true})):undefined;
 return Array.isArray(found)&&found[0]&&typeof found[0]==='object'?found[0]:undefined;
}

module.exports={pageInFront,frontTab};
