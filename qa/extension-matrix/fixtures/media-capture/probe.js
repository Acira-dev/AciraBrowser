// Driven by qa/extension-matrix/media-capture.mjs through Playwright (window.probe.*). Every step returns plain data or {error}.
const fail = error => ({error: String(error && error.message || error)});
window.probe = {
  // chrome.desktopCapture: Acira's picker opens; the harness picks its own test window there.
  desktop: () => new Promise(resolve => {
    const requestId = chrome.desktopCapture.chooseDesktopMedia(['screen', 'window', 'tab', 'audio'], async (streamId, options) => {
      if (chrome.runtime.lastError) return resolve({requestId, error: chrome.runtime.lastError.message});
      if (!streamId) return resolve({requestId, cancelled: true});
      try { const stream = await streamFor('desktop', streamId); resolve({requestId, streamId: streamId.slice(0, 6) + '…', options, result: await record(stream)}); }
      catch (error) { resolve({requestId, ...fail(error)}); }
    });
  }),
  cancelDesktop: () => new Promise(resolve => {
    const requestId = chrome.desktopCapture.chooseDesktopMedia(['screen', 'window'], streamId => resolve({requestId, streamId, lastError: chrome.runtime.lastError && chrome.runtime.lastError.message}));
    setTimeout(() => chrome.desktopCapture.cancelChooseDesktopMedia(requestId), 1200);
  }),
  // chrome.tabCapture from this page: the id for a tab, then getUserMedia with chromeMediaSource 'tab'.
  tab: async targetTabId => {
    try {
      const streamId = await chrome.tabCapture.getMediaStreamId({targetTabId});
      const stream = await streamFor('tab', streamId, {audio: true});
      const during = await chrome.tabCapture.getCapturedTabs();
      return {streamId: streamId.slice(0, 6) + '…', during, result: await record(stream)};
    } catch (error) { return fail(error); }
  },
  reuse: async targetTabId => {
    try { const streamId = await chrome.tabCapture.getMediaStreamId({targetTabId}); const first = await streamFor('tab', streamId); const again = await streamFor('tab', streamId).then(s => { s.getTracks().forEach(t => t.stop()); return {reused: true}; }, fail); first.getTracks().forEach(t => t.stop()); return again; }
    catch (error) { return fail(error); }
  },
  captured: () => chrome.tabCapture.getCapturedTabs(),
  // MV3 pattern (Loom-style): the worker gets the id after the toolbar click and an offscreen document records it.
  offscreen: targetTabId => chrome.runtime.sendMessage({type: 'record-in-offscreen', targetTabId}),
  statuses: () => chrome.runtime.sendMessage({type: 'statuses'}),
};
