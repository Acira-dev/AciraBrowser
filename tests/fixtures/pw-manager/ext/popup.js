'use strict';
// The popup of a password manager. Unlocking writes the key into storage.session (as Bitwarden's popup does with its user key) and tells the worker.
const KEY = 'pw_userKey';
const out = text => { document.getElementById('out').textContent = String(text); };
const show = async () => { const found = await chrome.storage.session.get(KEY); document.getElementById('state').textContent = found[KEY] ? 'unlocked' : 'locked'; };
const popoutUrl = () => chrome.runtime.getURL('popup.html?uilocation=popout');

globalThis.pw = {
  async unlock(tell = true) { await chrome.storage.session.set({[KEY]: 'key-' + Date.now()}); await show(); if (tell) return chrome.runtime.sendMessage({command: 'unlocked'}); },
  async lock(tell = true) { await chrome.storage.session.remove(KEY); await show(); if (tell) return chrome.runtime.sendMessage({command: 'unlocked'}); },
  // Bitwarden's BrowserPopupUtils.openPopout: where the window goes comes from windows.getCurrent, then windows.create({type: 'popup'}).
  async popout() {
    const sender = await chrome.windows.getCurrent({populate: true});
    const width = 380, height = 630, offsetRight = 15, offsetTop = 90;
    const created = await chrome.windows.create({url: popoutUrl(), type: 'popup', focused: true, width, height, left: sender.left + sender.width - width - offsetRight, top: sender.top + offsetTop});
    return {sender: {type: sender.type, left: sender.left, top: sender.top, width: sender.width, height: sender.height, tabs: (sender.tabs || []).length}, created: {id: created.id, type: created.type, left: created.left, top: created.top, width: created.width, height: created.height, tabs: (created.tabs || []).map(tab => tab.url)}};
  },
  // Bitwarden's "make Bitwarden your default password manager": the optional privacy permission, then the three services set to false, then the check that
  // all three are "controlled_by_this_extension" with value false (BrowserApi.browserAutofillSettingsOverridden).
  async makeDefault() {
    const granted = await chrome.permissions.request({permissions: ['privacy']});
    if (!granted) return {granted};
    const services = chrome.privacy.services;
    for (const name of ['autofillAddressEnabled', 'autofillCreditCardEnabled', 'passwordSavingEnabled']) await services[name].set({value: false});
    return {granted, ...(await pw.overridden())};
  },
  async overridden() {
    const details = {};
    for (const name of ['autofillAddressEnabled', 'autofillCreditCardEnabled', 'passwordSavingEnabled']) details[name] = await chrome.privacy.services[name].get({});
    const check = item => item.levelOfControl === 'controlled_by_this_extension' && !item.value;
    return {details, overridden: Object.values(details).every(check)};
  },
  async whoAmI() { return chrome.runtime.sendMessage({command: 'whoAsked'}); },
  async port() {
    return new Promise(resolve => {
      const port = chrome.runtime.connect({name: 'pw-session'});
      const seen = [];
      port.onMessage.addListener(message => { seen.push(message); if (message.id === 's') port.postMessage({id: 'q', action: 'get', key: 'pw_portKey'}); if (message.id === 'q') resolve({seen}); });
      port.postMessage({id: 's', action: 'save', key: 'pw_portKey', data: 'via-port'});
      setTimeout(() => resolve({seen, timeout: true}), 4000);
    });
  },
  async worker() { return chrome.runtime.sendMessage({command: 'dump'}); }
};
document.getElementById('unlock').onclick = () => pw.unlock().then(() => out('unlocked'), error => out(error));
document.getElementById('lock').onclick = () => pw.lock().then(() => out('locked'), error => out(error));
document.getElementById('popout').onclick = () => pw.popout().then(result => out(JSON.stringify(result)), error => out('pop-out failed: ' + error.message));
document.getElementById('privacy').onclick = () => pw.makeDefault().then(result => out(JSON.stringify(result)), error => out('privacy failed: ' + error.message));
show();
