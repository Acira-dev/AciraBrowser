'use strict';
// Camera, microphone and screen sharing, as one tab can show them. Electron gives no browser-side event for "this page is
// capturing", so Acira combines two things:
//   - the permission engine says when a page was granted camera, microphone or a screen to share (browser-side, trustworthy);
//   - while a tab is marked, Acira looks at the page's live MediaStreamTracks from outside the page (a short DevTools protocol
//     attach and Runtime.queryObjects over MediaStream.prototype), so nothing is injected into the site, a site cannot
//     hide a stream from it, and Stop can end every capture track whatever code created it.
// Remote tracks of a call have no device behind them and are ignored: only tracks with a device id or a display surface count.
const KINDS = ['camera', 'microphone', 'screen'];

// Runs inside the page on the array of every MediaStream (a track's JS object only exists once the page has touched it, so the
// streams are listed and their tracks read here): lists the live local capture tracks and, when asked, ends them.
// Checked against Chromium 152: devices have a device name as label; remote WebRTC tracks are labelled "remote audio/video";
// canvas and media-element captureStream tracks use their random id as the label; Web Audio destinations use a "WebAudio-" id.
const FUNCTION = `function (stop) {
  const found = [];
  for (const track of [].concat(...this.map(stream => { try { return stream.getTracks(); } catch { return []; } }))) {
    if (track.readyState !== 'live') continue;
    let settings = {};
    try { settings = track.getSettings(); } catch {}
    const label = track.label || '', id = settings.deviceId || '';
    if (!label || /^remote (audio|video)$/i.test(label) || label === id || id.startsWith('WebAudio-')) continue;
    const screen = !!settings.displaySurface || /^(screen|window|web-contents-media-stream):/i.test(id) || /^(screen|window) \\d*/i.test(label);
    found.push([track.kind, screen ? 'screen' : '']);
    if (stop) { track.stop(); track.dispatchEvent(new Event('ended')); }
  }
  return found;
}`;

/** Live capture kinds on a page, or null when they could not be read (another debugger is attached, page gone). With stop, ends them first. */
async function liveCapture(wc, { stop = false, timeoutMs = 2000 } = {}) {
  if (!wc || wc.isDestroyed()) return null;
  const debug = wc.debugger;
  if (debug.isAttached()) return null;
  let timer;
  try {
    debug.attach('1.3');
    const work = (async () => {
      const prototype = await debug.sendCommand('Runtime.evaluate', { expression: 'MediaStream.prototype' });
      const objects = await debug.sendCommand('Runtime.queryObjects', { prototypeObjectId: prototype.result.objectId });
      const result = await debug.sendCommand('Runtime.callFunctionOn', { objectId: objects.objects.objectId, functionDeclaration: FUNCTION, arguments: [{ value: !!stop }], returnByValue: true });
      return Array.isArray(result.result?.value) ? result.result.value : null;
    })();
    const found = await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('slow')), timeoutMs); })]);
    return found ? kindsOf(found) : null;
  } catch (error) { if (process.env.ACIRA_CAPTURE_DEBUG) console.log('[capture] failed', String(error.message || error)); return null; }
  finally { clearTimeout(timer); try { debug.detach(); } catch {} }
}
const kindsOf = found => KINDS.filter(kind => found.some(([trackKind, surface]) => kind === 'screen' ? surface === 'screen' : kind === 'camera' ? trackKind === 'video' && surface !== 'screen' : trackKind === 'audio' && surface !== 'screen'));

/** Permission names from the permission engine ("media-video", "media-audio", "display") as indicator kinds. */
function kindsFromGrant(names) {
  const kinds = new Set();
  for (const name of Array.isArray(names) ? names : []) {
    if (name === 'media-video') kinds.add('camera');
    else if (name === 'media-audio') kinds.add('microphone');
    else if (name === 'display') kinds.add('screen');
  }
  return KINDS.filter(kind => kinds.has(kind));
}
const merge = (current, added) => KINDS.filter(kind => (current || []).includes(kind) || (added || []).includes(kind));
module.exports = { KINDS, FUNCTION, liveCapture, kindsOf, kindsFromGrant, merge };
