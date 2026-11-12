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

/** What an extension sees for an Acira page address: internal pages are shown as chrome:// pages (the same rule as ext-api/tabs/model.cjs exposeUrl). */
const exposeUrl=url=>'chrome://'+String(url).slice(8).replace(/^new\/?$/,'newtab').replace(/\/?$/,'/');

/**
 * The page in front of the window in use when it is one of Acira's own (the New Tab page, Settings, History...), described as chrome.tabs describes it and WITH its chrome:// address: the
 * click that is being answered is the extension's activeTab on that page, so Chrome tells it where it was used (an extension with no "tabs" permission otherwise gets no url, and a handler
 * that reads tab.url throws). undefined when a website is in front, the window has no tab, or the tab list cannot say. Needs no address from the caller: a button that names no tab (-1) is
 * exactly the case where the interface could not point at a website.
 */
function frontOwnPage(api,extension){
 const front=frontTab(api,extension);
 if(!front)return undefined;
 const windows=quiet(()=>api.store()?.impl?.tabModel?.windows?.());
 const window=Array.isArray(windows)?windows.find(item=>item&&item.id===front.windowId):undefined,state=window&&window.state;
 const tab=state&&Array.isArray(state.tabs)?state.tabs.find(item=>item.id===state.activeTabId):undefined;
 if(!tab||tab.contentKind==='web'||typeof tab.url!=='string'||!tab.url.startsWith('acira://'))return undefined;
 return {...front,url:exposeUrl(tab.url)};
}

module.exports={pageInFront,frontTab,frontOwnPage};
