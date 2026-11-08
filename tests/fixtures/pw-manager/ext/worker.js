'use strict';
// The service worker of a password manager, reduced to the parts that decide what the person sees:
//  - "state provider": the lock state is read from chrome.storage.session once when the worker starts and afterwards ONLY changes when
//    storage.session.onChanged says so, and only for a change of exactly one key (Bitwarden's AbstractChromeStorageService.updates$);
//  - the toolbar badge is painted from that state: locked = "LOCK" on the button, unlocked = the number of logins for the page, per tab;
//  - content scripts and the popup ask the worker for the state (runtime messages) and open ports to it (Bitwarden's memory-storage port);
//  - everything the worker sees goes into a log the test reads back (globalThis.PW).
const KEY = 'pw_userKey';
const PW = globalThis.PW = {started: Date.now(), unlocked: null, events: [], paints: [], ports: [], messages: []};
const note = (what, extra) => { PW.events.push({at: Date.now() - PW.started, what, ...extra}); if (PW.events.length > 300) PW.events.shift(); };

const vault = [{host: '127.0.0.1', user: 'one'}, {host: '127.0.0.1', user: 'two'}, {host: 'localhost', user: 'other'}];
const hostOf = url => { try { return new URL(url).hostname; } catch { return ''; } };
async function countFor(url) { return vault.filter(item => item.host === hostOf(url)).length; }

async function paint(why) {
  const unlocked = PW.unlocked === true;
  let tabs = [];
  try { tabs = await chrome.tabs.query({active: true}); } catch (error) { note('tabs.query failed', {error: String(error)}); }
  if (!unlocked) {
    await chrome.action.setBadgeText({text: 'LOCK'});
    await chrome.action.setBadgeBackgroundColor({color: '#aa0000'});
    for (const tab of tabs) await chrome.action.setBadgeText({text: 'LOCK', tabId: tab.id});
  } else {
    await chrome.action.setBadgeText({text: ''});
    await chrome.action.setBadgeBackgroundColor({color: '#175ddc'});
    for (const tab of tabs) await chrome.action.setBadgeText({text: String(await countFor(tab.url)), tabId: tab.id});
  }
  PW.paints.push({at: Date.now() - PW.started, why, unlocked, tabs: tabs.map(tab => tab.id)});
  if (PW.paints.length > 100) PW.paints.shift();
}
async function reread(why) {
  const found = await chrome.storage.session.get(KEY);
  PW.unlocked = !!found[KEY];
  note('state read', {why, unlocked: PW.unlocked});
  await paint(why);
}

// Bitwarden's single-key filter: a change with more than one key is "reseeding" and ignored.
const onSessionChanged = changes => {
  note('session.onChanged', {keys: Object.keys(changes)});
  if (Object.keys(changes).length !== 1 || !(KEY in changes)) return;
  reread('session.onChanged');
};
chrome.storage.session.onChanged.addListener(onSessionChanged);
chrome.storage.onChanged.addListener((changes, area) => note('storage.onChanged', {area, keys: Object.keys(changes)}));

try { chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'}); } catch (error) { note('setAccessLevel failed', {error: String(error)}); }

// Bitwarden's DefaultBadgeBrowserApi: a tab is painted again when it is activated, when its url changed (tabs.onUpdated with changeInfo.url) and when
// webNavigation.onCommitted says the page was reloaded (transitionType 'reload'). Nothing else repaints a tab whose values the browser cleared.
chrome.tabs.onActivated.addListener(() => paint('tabs.onActivated'));
chrome.tabs.onUpdated.addListener((id, change) => { if (change.url !== undefined) { note('tabs.onUpdated url', {id}); paint('tabs.onUpdated url'); } });
chrome.webNavigation.onCommitted.addListener(details => { note('webNavigation.onCommitted', {tabId: details.tabId, frameId: details.frameId, transitionType: details.transitionType}); if (details.frameId === 0 && details.transitionType === 'reload') paint('reload'); });

// Bitwarden's BrowserApi.senderIsInternal: the sender must carry an origin equal to the extension's own and be a top frame.
const senderIsInternal = sender => {
  if (!sender || !sender.origin) return false;
  if (sender.origin !== new URL(chrome.runtime.getURL('')).origin) return false;
  return !('frameId' in sender) || sender.frameId === 0;
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  PW.messages.push({at: Date.now() - PW.started, command: message && message.command, from: sender && sender.url, tab: !!(sender && sender.tab)});
  if (PW.messages.length > 100) PW.messages.shift();
  switch (message && message.command) {
    case 'getAuthStatus': sendResponse({unlocked: PW.unlocked, workerStarted: PW.started}); return false;
    case 'unlocked': reread('message unlocked').then(() => sendResponse({ok: true, unlocked: PW.unlocked})); return true;
    case 'whoAsked': sendResponse({sender: JSON.parse(JSON.stringify(sender || null)), internal: senderIsInternal(sender)}); return false;
    case 'dump': sendResponse(JSON.parse(JSON.stringify(PW))); return false;
    default: return false;
  }
});

// The memory-storage port of Bitwarden's popup (ForegroundMemoryStorageService): a named port from an extension page that only the extension's own pages may use.
chrome.runtime.onConnect.addListener(port => {
  const internal = senderIsInternal(port.sender);
  PW.ports.push({at: Date.now() - PW.started, name: port.name, internal, sender: JSON.parse(JSON.stringify(port.sender || null))});
  if (port.name !== 'pw-session' || !internal) return;
  port.onMessage.addListener(async message => {
    if (message.action === 'get') { const found = await chrome.storage.session.get(message.key); port.postMessage({id: message.id, data: found[message.key] ?? null}); }
    if (message.action === 'save') { await chrome.storage.session.set({[message.key]: message.data}); port.postMessage({id: message.id, data: null}); }
  });
  port.postMessage({action: 'initialization', unlocked: PW.unlocked});
});

reread('worker start');
