'use strict';
// One question instead of several at the start of every frame (13.5). Each page-start preload (chrome-identity, farbling, scriptlets, page-risk, autoconsent) used to ask the main
// process its own synchronous question before the page could start, one blocked round trip each, in every frame, iframes included. Now the first of them to run asks ONE question
// (`acira:frame-boot`) and main answers every question those preloads would have asked, by calling the very same handlers; the others read the answer from the frame's shared global.
// A question main did not answer here (no handler, or it gave no answer) is simply asked the old way by its preload, so no feature changes: same handler, same event, same answer.
// What each preload asks for a frame (mirrors the preloads' own conditions):
//   chrome-identity, farbling: websites and srcdoc frames        scriptlets: the main frame of a website        page-risk: the top frame of a website (the script only when it is on)
//   autoconsent-setup: websites
const CHANNELS = Object.freeze({identity: 'acira:chrome-identity', farbling: 'acira:farbling', scriptlets: 'acira:scriptlets', riskConfig: 'acira:page-risk-config', riskScript: 'acira:page-risk-script', consent: 'acira:autoconsent-setup'});
const BOOT = 'acira:frame-boot';

/** The questions a frame's preloads ask, as [channel, arguments] in the order they asked them. Pure. */
function questionsFor(href, mainFrame, topFrame) {
  const http = /^https?:/.test(href), web = http || href === 'about:srcdoc', list = [];
  if (web) list.push([CHANNELS.identity, []], [CHANNELS.farbling, [href]]);
  if (mainFrame && http) list.push([CHANNELS.scriptlets, [href]]);
  if (topFrame && http) list.push([CHANNELS.riskConfig, []]);
  if (http) list.push([CHANNELS.consent, [mainFrame]]);
  return list;
}

/** Answers one frame's questions by calling the handlers that are registered for them (exactly one each). `event` is the boot question's own event: its sender and sender frame are the frame that asked. */
function answerFor(ipcMain, event, href, mainFrame, topFrame) {
  const answers = {};
  const ask = (channel, args) => {
    const handlers = ipcMain.listeners(channel);
    if (handlers.length !== 1) return undefined; // none or several: the preload asks as before
    // The same event with its own return slot (the real one answers the boot question once, at the end).
    const own = Object.create(event, {returnValue: {value: undefined, writable: true, enumerable: true, configurable: true}});
    try { handlers[0].call(ipcMain, own, ...args); } catch { return undefined; }
    return own.returnValue;
  };
  for (const [channel, args] of questionsFor(href, mainFrame, topFrame)) {
    const value = ask(channel, args);
    if (value !== undefined) answers[channel] = value;
    if (channel === CHANNELS.riskConfig && value?.enabled) { const script = ask(CHANNELS.riskScript, []); if (script !== undefined) answers[CHANNELS.riskScript] = script; }
  }
  return answers;
}

function install(ipcMain) {
  ipcMain.on(BOOT, (event, href, mainFrame, topFrame) => {
    let answers = {};
    try { if (typeof href === 'string' && href.length <= 8192) answers = answerFor(ipcMain, event, href, mainFrame === true, topFrame === true); } catch { answers = {}; }
    event.returnValue = answers;
  });
}

/** The client every folded preload carries (kept identical in each file; tests/frame-boot.test.cjs compares the copies). The first preload of a frame to run asks, the rest read. */
const CLIENT = "const bootAnswer=(channel,...args)=>{try{const KEY=Symbol.for('acira.frame-boot');let boot=globalThis[KEY];if(!boot)boot=globalThis[KEY]=ipcRenderer.sendSync('acira:frame-boot',location.href,process.isMainFrame,window===window.top)||{};if(Object.prototype.hasOwnProperty.call(boot,channel))return boot[channel];}catch{/* ask directly */}return ipcRenderer.sendSync(channel,...args);};";

module.exports = {install, questionsFor, answerFor, CHANNELS, BOOT, CLIENT};
