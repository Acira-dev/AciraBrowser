'use strict';
// The content script of a password manager: asks the worker whether the vault is unlocked and shows it on the page (the inline menu says
// "Unlock your account" when the worker answers locked). Also reads storage.session itself (setAccessLevel makes that possible) and listens
// for a page event so a test can ask again later.
const root = document.documentElement;
async function ask() {
  const started = Date.now();
  try {
    const answer = await chrome.runtime.sendMessage({command: 'getAuthStatus'});
    root.dataset.pwWorker = answer ? (answer.unlocked ? 'unlocked' : 'locked') : 'none';
    root.dataset.pwWorkerStarted = answer ? String(answer.workerStarted) : '';
  } catch (error) { root.dataset.pwWorker = 'error: ' + String(error && error.message || error); }
  try {
    const found = await chrome.storage.session.get('pw_userKey');
    root.dataset.pwSession = found.pw_userKey ? 'unlocked' : 'locked';
  } catch (error) { root.dataset.pwSession = 'error: ' + String(error && error.message || error); }
  root.dataset.pwAsked = String(Date.now() - started);
}
ask();
document.addEventListener('pw-ask', ask);
// The worker tells the page things with chrome.tabs.sendMessage(tabId, ...) (Bitwarden: "unlock completed", refresh the inline menu); the page answers.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.command === 'pw-ping') { document.documentElement.dataset.pwPinged = String(Date.now()); sendResponse({pong: true, url: location.href}); }
  return false;
});
