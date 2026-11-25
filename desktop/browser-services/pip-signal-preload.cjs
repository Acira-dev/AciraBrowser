'use strict';
// Beta 14, macOS only: a page's video entered picture in picture (any way in: the site's button, the right-click menu, Acira's card, Alt+P, the automatic pop-out). Tells main, which lets
// Chromium's small video window onto the Space of a fullscreen window (desktop/pip-spaces.cjs). A plain listener in this preload's own world: the page cannot see it, and nothing of the
// page's is wrapped or changed (so it is safe in Tor and private sessions too). Sends no words, no address and no page data: just the fact. Only the engine's own event counts: a page that
// fakes the event (isTrusted false) is ignored.
// Beta 14.0: the same for LEAVING (`leavepictureinpicture`): the window went away (its X, its Back to tab, a page script, Acira's own exit). It sends only whether the video was paused or ended at that
// moment ("acira:pip-left"), so the automatic pop-out can tell X (the video is paused with it) from Back to tab (still playing) at once instead of by polling (desktop/auto-pip.cjs).
const {ipcRenderer} = require('electron');
if (/^https?:/.test(location.href)) {
  try { document.addEventListener('leavepictureinpicture', event => { if (!event.isTrusted) return; const video = event.target; try { ipcRenderer.send('acira:pip-left', { paused: !!(video && video.paused), ended: !!(video && video.ended) }); } catch { /* a closing page */ } }, true); } catch { /* no document yet */ }
  try { document.addEventListener('enterpictureinpicture', event => { if (!event.isTrusted) return; try { ipcRenderer.send('acira:pip-entered'); } catch { /* a closing page */ } }, true); } catch { /* no document yet */ }
}
