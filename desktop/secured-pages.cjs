'use strict';
// Locked pages leave the window's routable pages map. Only this main-process owner retains their live documents.
// They are detached and muted with media paused; Chromium lifecycle freezing is requested as well.
// No snapshot, renderer IPC, tab search or extension can address the retained documents.
const MEDIA_WORLD = 'acira-secured-media';
const PAUSE_MEDIA = `(() => {
  const playing = Array.from(document.querySelectorAll('video,audio')).filter(m => !m.paused && !m.ended).map(element => ({element, time: element.currentTime}));
  const block = event => { if (event.target instanceof HTMLMediaElement) event.target.pause(); };
  globalThis.aciraLockedMedia = {playing, block}; document.addEventListener('play', block, true);
  for (const {element} of playing) element.pause();
})()`;
const RESUME_MEDIA = `(() => {
  const saved = globalThis.aciraLockedMedia; if (!saved) return;
  document.removeEventListener('play', saved.block, true); delete globalThis.aciraLockedMedia;
  for (const {element, time} of saved.playing) if (element.isConnected) {
    if (Number.isFinite(time) && Math.abs(element.currentTime - time) > .25) try { element.currentTime = time; } catch {}
    element.play().catch(() => {});
  }
})()`;

async function mediaInFrames(debug, expression) {
  const {frameTree} = await debug.sendCommand('Page.getFrameTree');
  const visit = async tree => {
    try {
      const {executionContextId} = await debug.sendCommand('Page.createIsolatedWorld', {frameId: tree.frame.id, worldName: MEDIA_WORLD});
      await debug.sendCommand('Runtime.evaluate', {contextId: executionContextId, expression, returnByValue: true});
    } catch { /* A frame may navigate or disappear while the workspace locks. */ }
    for (const child of tree.childFrames || []) await visit(child);
  };
  await visit(frameTree);
}

async function suspendSecuredPage(entry) {
  const wc = entry.view.webContents;
  if (!wc || wc.isDestroyed() || entry.securedLifecycle) return;
  const debug = wc.debugger;
  entry.securedLifecycle = {own: false, muted: entry.securedMuted ?? wc.isAudioMuted(), backgroundThrottling: wc.getBackgroundThrottling()};
  // Enable background lifecycle handling even if a development profile disabled it. Chromium decides whether freezing can take effect.
  wc.setBackgroundThrottling(true);
  wc.setAudioMuted(true);
  try {
    if (!debug.isAttached()) { debug.attach('1.3'); entry.securedLifecycle.own = true; }
    await mediaInFrames(debug, PAUSE_MEDIA);
    await debug.sendCommand('Page.setWebLifecycleState', {state: 'frozen'});entry.securedLifecycle.freezeRequested=true;
  } catch (error) { console.warn('Secured page suspension:', error.message); }
}

async function resumeSecuredPage(entry) {
  const wc = entry.view.webContents, saved = entry.securedLifecycle;
  if (!wc || wc.isDestroyed() || !saved) return;
  const debug = wc.debugger;
  try {
    if (debug.isAttached()) {
      await debug.sendCommand('Page.setWebLifecycleState', {state: 'active'});
      await mediaInFrames(debug, RESUME_MEDIA);
    }
  } finally {
    if (saved.own) try { debug.detach(); } catch {}
    wc.setAudioMuted(saved.muted);wc.setBackgroundThrottling(saved.backgroundThrottling);
    entry.securedLifecycle = null;
  }
}

function createSecuredPages({pages, detach, attach, conceal, suspend = suspendSecuredPage, resume = resumeSecuredPage, ready = () => {}}) {
  const parked = new Map();
  let disposed = false;
  const live = entry => !!entry.view.webContents && !entry.view.webContents.isDestroyed();
  function close(entry) {
    ++entry.securedGeneration;
    entry.progress?.dispose();
    if (live(entry)) entry.view.webContents.close({waitForBeforeUnload: false});
  }
  function queue(entry, run) {
    entry.securedTask = Promise.resolve(entry.securedTask).catch(() => {}).then(() => live(entry) && run(entry)).catch(() => {});
    return entry.securedTask;
  }
  function reconcile(state) {
    if (disposed) return;
    const tabs = new Map(state.tabs.map(tab => [tab.id, tab]));
    let concealed = false;
    for (const [id, entry] of pages) {
      const workspace = state.workspaces?.find(item => item.id === entry.securedWorkspaceId);
      if (!live(entry) || tabs.has(id) || entry.privacy !== 'secured' || !workspace?.secured || workspace.unlocked) continue;
      if (!concealed) { conceal(); concealed = true; }
      // An active camera/microphone/screen capture must end on lock, including tracks outside the DOM.
      // The normal removal closes those pages; retaining a capture would keep a device running behind the lock.
      if (entry.capture?.length) continue;
      entry.securedGeneration = (entry.securedGeneration || 0) + 1;
      entry.securedLocked = true; entry.securedRestoring = false; entry.askedVisible = false;
      clearTimeout(entry.boundsTimer); entry.boundsTimer = null;
      entry.view.setVisible(false); detach(entry); pages.delete(id); parked.set(id, entry);
      if (entry.securedMuted === undefined) entry.securedMuted = entry.view.webContents.isAudioMuted();
      entry.view.webContents.setAudioMuted(true);
      queue(entry, suspend);
    }
    for (const [id, entry] of parked) {
      const tab = tabs.get(id), workspace = state.workspaces?.find(item => item.id === entry.securedWorkspaceId);
      if (!live(entry) || !workspace?.secured || tab && (tab.privacy !== 'secured' || tab.workspaceId !== entry.securedWorkspaceId || tab.url !== entry.loadedURL)) {
        parked.delete(id); close(entry); continue;
      }
      if (!tab || !workspace.unlocked) continue;
      parked.delete(id); pages.set(id, entry); attach(entry);
      const generation = ++entry.securedGeneration;
      entry.securedRestoring = true;
      queue(entry, resume).then(() => {
        if (disposed || generation !== entry.securedGeneration || pages.get(id) !== entry || !live(entry)) return;
        entry.securedLocked = false; entry.securedRestoring = false; entry.securedMuted = undefined; ready(id, entry);
      });
    }
  }
  function drop(workspaceId) {
    for (const [id, entry] of parked) if (!workspaceId || entry.securedWorkspaceId === workspaceId) { parked.delete(id); close(entry); }
  }
  return {reconcile, drop, dispose() { disposed = true; drop(); }};
}

module.exports = {createSecuredPages, suspendSecuredPage, resumeSecuredPage};
