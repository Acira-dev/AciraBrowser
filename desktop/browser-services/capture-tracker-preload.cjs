'use strict';
// Runs before any page script in every frame of a website session (13.8). It keeps the count Chromium keeps for its capture indicator,
// from inside the page, because Electron gives the browser side no event when a camera, microphone or screen stops: which capture
// requests of this frame are live, and for which kinds of device (desktop/capture-indicator.cjs combines the frames and shows the pill).
// The bookkeeping follows Blink and MediaStreamManager (third_party/blink/renderer/modules/mediastream/, content/browser/renderer_host/
// media/media_stream_manager.cc): one request per getUserMedia / getDisplayMedia call, holding the devices it opened; a device stays open
// while any track on it is live, clones included (MediaStreamTrack.clone, MediaStream.clone); the request counts for the kinds it opened
// until its last device stops (MediaStreamManager::StopDevice deletes the request only then, and ~UIDelegate removes all its devices).
// A track stops with track.stop() (no 'ended' event for the page's own stop, so stop() is watched), with 'ended' (the device went away,
// Acira's Stop), or with the document. Only tracks made by those calls count: a call's remote tracks, canvas, media-element and Web Audio
// tracks never do. Stop from Acira ends every live capture track of the frame and fires 'ended' on it, as Chromium's browser-side stop does.
// Nothing the page passes is trusted: the main process only ever shows kinds the browser granted to this page.
const {ipcRenderer, contextBridge} = require('electron');

/** Runs in the page's main world (contextBridge.executeInMainWorld), before its scripts. report({kinds, pending}); onStop(fn). Self-contained. */
function captureTracker(report, onStop) {
  const W = globalThis;
  const MD = W.MediaDevices, MST = W.MediaStreamTrack, MS = W.MediaStream, Nav = W.Navigator, ET = W.EventTarget;
  if (!MD || !MST || !MS || !ET) return;
  const apply = Reflect.apply, define = Object.defineProperty, describe = Object.getOwnPropertyDescriptor, EventC = W.Event, WeakMapC = W.WeakMap, PromiseThen = W.Promise.prototype.then;
  const get = (proto, name) => { const d = describe(proto, name); return d && d.get; };
  const native = {
    gum: MD.prototype.getUserMedia, gdm: MD.prototype.getDisplayMedia, webkitGum: Nav && Nav.prototype.webkitGetUserMedia,
    stop: MST.prototype.stop, clone: MST.prototype.clone, getSettings: MST.prototype.getSettings,
    kind: get(MST.prototype, 'kind'), readyState: get(MST.prototype, 'readyState'),
    tracks: MS.prototype.getTracks, audio: MS.prototype.getAudioTracks, video: MS.prototype.getVideoTracks, streamClone: MS.prototype.clone,
    listen: ET.prototype.addEventListener, dispatch: ET.prototype.dispatchEvent,
    mapGet: WeakMapC.prototype.get, mapSet: WeakMapC.prototype.set,
  };
  if (typeof native.stop !== 'function' || typeof native.readyState !== 'function' || typeof native.kind !== 'function') return;
  const owner = new WeakMapC();  // track -> its request
  let requests = [];             // [{kinds: string[], tracks: MediaStreamTrack[]}]
  let pending = 0, last = '';
  const live = track => { try { return apply(native.readyState, track, []) === 'live'; } catch (error) { return false; } };
  const ORDER = ['camera', 'microphone', 'screen'];
  function changed() {
    const keep = [], kinds = [];
    for (let i = 0; i < requests.length; i++) {
      const request = requests[i];
      let any = false;
      for (let j = 0; j < request.tracks.length; j++) if (live(request.tracks[j])) { any = true; break; }
      if (!any) continue; // every device of the request stopped: the request is gone (and its tracks may be collected)
      keep[keep.length] = request;
      for (let j = 0; j < request.kinds.length; j++) { const kind = request.kinds[j]; let seen = false; for (let k = 0; k < kinds.length; k++) if (kinds[k] === kind) seen = true; if (!seen) kinds[kinds.length] = kind; }
    }
    requests = keep;
    const sorted = [];
    for (let i = 0; i < ORDER.length; i++) for (let k = 0; k < kinds.length; k++) if (kinds[k] === ORDER[i]) sorted[sorted.length] = ORDER[i];
    const key = sorted.join(',') + '|' + pending;
    if (key === last) return;
    last = key;
    try { report({kinds: sorted, pending}); } catch (error) { /* the frame is going away */ }
  }
  function join(track, request) {
    if (!track || !request) return;
    try { if (apply(native.mapGet, owner, [track])) return; apply(native.mapSet, owner, [track, request]); } catch (error) { return; }
    request.tracks[request.tracks.length] = track;
    try { apply(native.listen, track, ['ended', changed]); } catch (error) { /* not a track */ }
  }
  // The kind of device a track of a call opened: a display call's tracks (and its tab or system sound) share a screen; a getUserMedia
  // track is the camera or the microphone unless it carries a display surface (the older desktop-capture constraints).
  function kindOf(track, display) {
    if (display) return 'screen';
    let settings = {};
    try { settings = apply(native.getSettings, track, []) || {}; } catch (error) { /* keep the plain kind */ }
    if (settings.displaySurface) return 'screen';
    let kind = '';
    try { kind = apply(native.kind, track, []); } catch (error) { return ''; }
    return kind === 'audio' ? 'microphone' : kind === 'video' ? 'camera' : '';
  }
  function adopt(stream, display) {
    let tracks = [];
    try { tracks = apply(native.tracks, stream, []); } catch (error) { return; }
    const request = {kinds: [], tracks: []};
    for (let i = 0; i < tracks.length; i++) {
      const kind = kindOf(tracks[i], display);
      if (!kind) continue;
      let seen = false; for (let k = 0; k < request.kinds.length; k++) if (request.kinds[k] === kind) seen = true;
      if (!seen) request.kinds[request.kinds.length] = kind;
      join(tracks[i], request);
    }
    if (request.tracks.length) requests[requests.length] = request;
  }
  // A capture call: in flight until it settles, then its stream (if any) is a request.
  function call(fn, self, args, display) {
    pending++; changed();
    let promise;
    try { promise = apply(fn, self, args); } catch (error) { pending--; changed(); throw error; }
    return apply(PromiseThen, promise, [
      stream => { pending--; try { adopt(stream, display); } catch (error) { /* not a stream */ } changed(); return stream; },
      error => { pending--; changed(); throw error; },
    ]);
  }
  const install = (proto, name, value) => { try { const d = describe(proto, name); define(proto, name, {configurable: true, enumerable: d ? d.enumerable : true, writable: true, value}); } catch (error) { /* leave the original */ } };
  // Shapes like the built-in methods: same names, same lengths, no prototype.
  const shapes = {
    getUserMedia() { return call(native.gum, this, arguments, false); },
    getDisplayMedia() { return call(native.gdm, this, arguments, true); },
    stop() { const result = apply(native.stop, this, arguments); changed(); return result; },
    clone() { const copy = apply(native.clone, this, arguments); try { join(copy, apply(native.mapGet, owner, [this])); } catch (error) { /* untracked */ } changed(); return copy; },
  };
  const streamShapes = {
    clone() {
      const copy = apply(native.streamClone, this, arguments);
      try {
        // Blink clones the audio tracks, then the video tracks, in order (MediaStream::clone): pair them the same way.
        const lists = [native.audio, native.video];
        for (let l = 0; l < lists.length; l++) {
          const from = apply(lists[l], this, []), to = apply(lists[l], copy, []);
          for (let i = 0; i < from.length && i < to.length; i++) join(to[i], apply(native.mapGet, owner, [from[i]]));
        }
      } catch (error) { /* untracked */ }
      changed(); return copy;
    },
  };
  const legacy = {
    webkitGetUserMedia(constraints, success, failure) {
      if (typeof success !== 'function') return apply(native.webkitGum, this, arguments);
      pending++; changed();
      let settled = false;
      const done = () => { if (!settled) { settled = true; pending--; } };
      const ok = function (stream) { done(); try { adopt(stream, false); } catch (error) { /* not a stream */ } changed(); return apply(success, this, arguments); };
      const fail = function () { done(); changed(); if (typeof failure === 'function') return apply(failure, this, arguments); };
      try { return apply(native.webkitGum, this, [constraints, ok, fail]); } catch (error) { done(); changed(); throw error; }
    },
  };
  if (typeof native.gum === 'function') install(MD.prototype, 'getUserMedia', shapes.getUserMedia);
  if (typeof native.gdm === 'function') install(MD.prototype, 'getDisplayMedia', shapes.getDisplayMedia);
  if (typeof native.webkitGum === 'function') install(Nav.prototype, 'webkitGetUserMedia', legacy.webkitGetUserMedia);
  install(MST.prototype, 'stop', shapes.stop);
  if (typeof native.clone === 'function') install(MST.prototype, 'clone', shapes.clone);
  if (typeof native.streamClone === 'function') install(MS.prototype, 'clone', streamShapes.clone);
  // Acira's Stop: end every live capture track of this frame and tell the page, as the browser does when it stops a capture.
  try {
    onStop(function () {
      const list = requests; // 'ended' below re-counts (and replaces the list) as it goes
      for (let i = 0; i < list.length; i++) {
        const tracks = list[i].tracks.slice();
        for (let j = 0; j < tracks.length; j++) {
          if (!live(tracks[j])) continue;
          try { apply(native.stop, tracks[j], []); apply(native.dispatch, tracks[j], [new EventC('ended')]); } catch (error) { /* already gone */ }
        }
      }
      changed();
    });
  } catch (error) { /* no Stop from Acira for this frame */ }
  // The document is going away: its captures end with it (pagehide comes before the next document's).
  try {
    apply(native.listen, W, ['pagehide', () => { if (last !== '|0' && last !== '') { last = '|0'; try { report({kinds: [], pending: 0}); } catch (error) { /* gone */ } } }]);
    apply(native.listen, W, ['pageshow', event => { if (event && event.persisted) { last = ''; changed(); } }]);
  } catch (error) { /* no window events */ }
}

if (typeof window !== 'undefined' && process.type === 'renderer') {
  let origin = '';
  try { origin = String(location.origin || ''); } catch { /* opaque */ }
  if (/^https?:/.test(location.href) || /^https?:\/\//.test(origin)) {
    try {
      let stopper = null;
      const report = value => {
        try {
          const kinds = Array.isArray(value && value.kinds) ? value.kinds.filter(kind => kind === 'camera' || kind === 'microphone' || kind === 'screen') : [];
          const pending = value && Number.isSafeInteger(value.pending) && value.pending > 0 ? value.pending : 0;
          ipcRenderer.send('acira:capture-state', {kinds, pending});
        } catch { /* the frame is closing */ }
      };
      const onStop = fn => { if (!stopper && typeof fn === 'function') stopper = fn; };
      ipcRenderer.on('acira:capture-stop', () => { try { if (stopper) stopper(); } catch { /* the page's own problem */ } });
      contextBridge.executeInMainWorld({func: captureTracker, args: [report, onStop]});
    } catch { /* A closing frame. */ }
  }
}

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {captureTracker};
