// QA fixture service worker: each command exercises one namespace and answers with what happened (errors included, as text).
const settle = async run => { try { return {ok: true, value: await run()}; } catch (error) { return {ok: false, error: String(error && error.message || error)}; } };
const offscreenReplies = [];
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.from === 'offscreen') { offscreenReplies.push(message); return false; }
  const commands = {
    async offscreen() {
      const before = await chrome.offscreen.hasDocument();
      await chrome.offscreen.createDocument({url: 'offscreen.html', reasons: ['DOM_PARSER'], justification: 'Parse HTML for the QA probe'});
      const duplicate = await settle(() => chrome.offscreen.createDocument({url: 'offscreen.html', reasons: ['DOM_PARSER'], justification: 'again'}));
      const contexts = await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']});
      for (let i = 0; i < 40 && !offscreenReplies.length; i++) await new Promise(r => setTimeout(r, 100));
      const during = await chrome.offscreen.hasDocument();
      await chrome.offscreen.closeDocument();
      const after = await chrome.offscreen.hasDocument();
      const closeAgain = await settle(() => chrome.offscreen.closeDocument());
      return {before, during, after, duplicate, closeAgain, contexts: contexts.map(c => [c.contextType, c.documentUrl]), parsed: offscreenReplies.at(-1) || null};
    },
    async userScripts() {
      await chrome.userScripts.configureWorld({messaging: true});
      await chrome.userScripts.unregister();
      await chrome.userScripts.register([
        {id: 'probe-user', matches: ['http://127.0.0.1/*'], runAt: 'document_idle', js: [{code: "document.documentElement.dataset.aciraUserScript = typeof window.aciraPageSecret === 'undefined' ? 'isolated' : 'leaked'; chrome.runtime.sendMessage({hello: location.pathname}).then(reply => { document.documentElement.dataset.aciraUserScriptReply = JSON.stringify(reply); }, error => { document.documentElement.dataset.aciraUserScriptError = String(error && error.message || error); });"}]},
        {id: 'probe-main', matches: ['http://127.0.0.1/*'], runAt: 'document_end', world: 'MAIN', js: [{code: "document.documentElement.dataset.aciraMainWorld = String(typeof window.aciraPageSecret);"}]}
      ]);
      return {scripts: (await chrome.userScripts.getScripts()).map(s => [s.id, s.world, s.runAt]), worlds: await chrome.userScripts.getWorldConfigurations()};
    },
    async sidePanel() {
      await chrome.sidePanel.setOptions({path: 'panel.html', enabled: true});
      const options = await chrome.sidePanel.getOptions({});
      const win = await chrome.windows.getLastFocused();
      const opened = await settle(() => chrome.sidePanel.open({windowId: win.id}));
      await new Promise(r => setTimeout(r, 1200));
      const contexts = await chrome.runtime.getContexts({contextTypes: ['SIDE_PANEL']});
      const all = await chrome.runtime.getContexts({});
      return {options, windowId: win.id, opened, contexts: contexts.map(c => c.documentUrl), all: all.map(c => c.contextType + ' ' + c.documentUrl), impl: String(chrome.runtime.getContexts).slice(0, 80)};
    },
    async closePanel() { return settle(() => chrome.sidePanel.close({})); },
    async identity() {
      const redirect = chrome.identity.getRedirectURL('cb');
      const flow = await settle(() => chrome.identity.launchWebAuthFlow({url: message.authUrl + '?redirect_uri=' + encodeURIComponent(redirect), interactive: false}));
      const token = await settle(() => chrome.identity.getAuthToken({interactive: false}));
      return {redirect, flow, token};
    },
    async stores() {
      const tree = await chrome.bookmarks.getTree();
      const recent = await chrome.bookmarks.getRecent(5);
      const history = await chrome.history.search({text: '', startTime: 0, maxResults: 5});
      const closed = await chrome.sessions.getRecentlyClosed({maxResults: 5});
      // history stays read-only; bookmarks can be changed (Acira's own store, as in Chrome) - the node made here is removed again
      const write = await settle(() => chrome.history.deleteAll());
      const made = await settle(() => chrome.bookmarks.create({parentId: '1', title: 'Fixture write', url: 'https://example.com/fixture-write'}));
      const removed = made.ok ? await settle(() => chrome.bookmarks.remove(made.value.id)) : null;
      return {rootChildren: tree[0].children.map(c => c.title), recent: recent.map(b => b.title), history: history.map(h => h.url), closed: closed.length, write, bookmarkWrite: {created: made.ok, removed: !!removed && removed.ok}};
    }
  };
  const run = commands[message && message.command];
  if (!run) return false;
  settle(run).then(sendResponse);
  return true;
});
chrome.runtime.onUserScriptMessage.addListener((message, sender, sendResponse) => {
  sendResponse({pong: message, origin: sender.origin, world: sender.userScriptWorldId || 'default'});
});
