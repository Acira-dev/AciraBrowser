// Driven by qa/p9/identity-live.mjs through Playwright (window.probe.*). Every step returns plain data or {error}.
const fail = error => ({error: String(error && error.message || error)});
window.probe = {
  redirect: path => chrome.identity.getRedirectURL(path),
  flow: async (url, interactive) => { try { return {url: await chrome.identity.launchWebAuthFlow({url, interactive})}; } catch (error) { return fail(error); } },
  token: async interactive => { try { return {token: await chrome.identity.getAuthToken({interactive})}; } catch (error) { return fail(error); } },
  tokenCallback: interactive => new Promise(resolve => chrome.identity.getAuthToken({interactive}, token => resolve({token, lastError: chrome.runtime.lastError && chrome.runtime.lastError.message}))),
  userInfo: async () => { try { return await chrome.identity.getProfileUserInfo({accountStatus: 'ANY'}); } catch (error) { return fail(error); } },
  removeToken: async () => { try { return {value: (await chrome.identity.removeCachedAuthToken({token: 'x'})) === undefined}; } catch (error) { return fail(error); } },
  viaWorker: message => chrome.runtime.sendMessage(message)
};

// sidePanel, idle and system.display
window.events = {idle: [], opened: [], displayChanged: 0};
chrome.sidePanel.onOpened.addListener(info => window.events.opened.push(info));
Object.assign(window.probe, {
  openPanel: async options => { try { await chrome.sidePanel.open(options); return {ok: true}; } catch (error) { return fail(error); } },
  panelOptions: async options => { try { return await chrome.sidePanel.getOptions(options); } catch (error) { return fail(error); } },
  closePanel: async options => { try { await chrome.sidePanel.close(options); return {ok: true}; } catch (error) { return fail(error); } },
  idleQuery: async seconds => { try { return {state: await chrome.idle.queryState(seconds)}; } catch (error) { return fail(error); } },
  idleListen: seconds => { chrome.idle.setDetectionInterval(seconds); chrome.idle.onStateChanged.addListener(state => window.events.idle.push(state)); },
  displays: async () => { try { return await chrome.system.display.getInfo(); } catch (error) { return fail(error); } },
  listenDisplays: () => chrome.system.display.onDisplayChanged.addListener(() => { window.events.displayChanged++; }),
  events: () => window.events
});
