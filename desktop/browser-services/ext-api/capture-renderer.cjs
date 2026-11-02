'use strict';
// chrome.tabCapture and chrome.desktopCapture inside extension pages, workers and offscreen documents (P9; main side: extension-apis.cjs and
// media-capture.cjs). Both namespaces are built on Chromium's schema (argument checks, enums, callback/promise rules); stream ids come from
// Acira's main process after Chrome's checks (toolbar click on that tab, or the person's choice in Acira's share picker).
//
// The getUserMedia shim: Electron cannot resolve Chrome's stream ids, so getUserMedia({video|audio: {mandatory: {chromeMediaSource:
// 'tab' | 'desktop', chromeMediaSourceId}}}) is answered here: the id is checked and used up in the main process ('mediaCapture.arm'),
// which arms this page, and getDisplayMedia is then answered by the session's display-media handler with that tab or screen, without a
// picker. Camera and microphone calls go to the browser unchanged.
// Offscreen documents (Chromium's own chrome.offscreen) are where MV3 recorders such as Loom use the id. Chromium gives them only
// chrome.runtime, without getManifest, so the engine sees an empty manifest there: the shim is installed whenever the manifest is
// unknown, and the main process checks the extension's permission on every arm.
// Written into the preload as source text: uses only `acira` and the page's globals.
module.exports = {
  namespaces: ['tabCapture', 'desktopCapture'],
  renderer(acira) {
    const g = globalThis;
    const manifestKnown = !!(acira.manifest && acira.manifest.manifest_version);
    const capturing = acira.has('tabCapture') || acira.has('desktopCapture') || !manifestKnown;

    function installShim() {
      const devices = typeof navigator !== 'undefined' && navigator.mediaDevices;
      if (!devices || typeof devices.getUserMedia !== 'function' || typeof devices.getDisplayMedia !== 'function') return;
      if (devices[Symbol.for('acira.capture.shim')]) return;
      const userMedia = devices.getUserMedia.bind(devices), displayMedia = devices.getDisplayMedia.bind(devices);
      const read = part => {
        if (!part || typeof part !== 'object') return null;
        const m = part.mandatory && typeof part.mandatory === 'object' ? part.mandatory : part, source = m.chromeMediaSource, id = m.chromeMediaSourceId;
        return (source === 'tab' || source === 'desktop' || source === 'system') && typeof id === 'string' && id
          ? {id, width: +m.maxWidth || 0, height: +m.maxHeight || 0, frameRate: +m.maxFrameRate || 0} : null;
      };
      const tell = (name, captureId) => acira.call(name)(captureId).catch(() => undefined), running = new Map();
      // The sharing pill's Stop (main process) ends this page's capture: every track stops and fires "ended", as when a share stops in Chrome.
      try {
        Object.defineProperty(devices, Symbol.for('acira.capture.stop'), {configurable: true, value: captureId => {
          const tracks = running.get(captureId); if (!tracks) return false;
          for (const track of [...tracks]) { try { track.stop(); track.dispatchEvent(new Event('ended')); } catch (e) { /* gone */ } }
          return true;
        }});
        Object.defineProperty(devices, Symbol.for('acira.capture.shim'), {configurable: true, value: true});
      } catch (e) { /* frozen */ }
      async function captured(video, audio) {
        const armed = await acira.call('mediaCapture.arm')((video || audio).id);
        let stream;
        try { stream = await displayMedia({video: true, audio: !!audio && !!armed.audio}); }
        catch (error) { tell('mediaCapture.ended', armed.captureId); throw error; }
        if (!video) for (const track of stream.getVideoTracks()) { track.stop(); stream.removeTrack(track); }
        else {
          const want = {};
          if (video.width > 0) want.width = {max: video.width};
          if (video.height > 0) want.height = {max: video.height};
          if (video.frameRate > 0) want.frameRate = {max: video.frameRate};
          const track = stream.getVideoTracks()[0];
          if (track && Object.keys(want).length) track.applyConstraints(want).catch(() => undefined);
        }
        // The capture ends when every track has ended or been stopped (stop() fires no "ended" event, so it is watched too).
        const live = new Set(stream.getTracks()), gone = track => { if (!live.delete(track)) return; if (!live.size) { running.delete(armed.captureId); tell('mediaCapture.ended', armed.captureId); } };
        running.set(armed.captureId, live);
        for (const track of live) {
          track.addEventListener('ended', () => gone(track), {once: true});
          const stop = track.stop;
          try { Object.defineProperty(track, 'stop', {configurable: true, writable: true, value: function () { stop.call(this); gone(track); }}); } catch (e) { /* keep */ }
        }
        tell('mediaCapture.started', armed.captureId);
        return stream;
      }
      const getUserMedia = function getUserMedia(constraints) {
        const c = constraints && typeof constraints === 'object' ? constraints : {}, video = read(c.video), audio = read(c.audio);
        return video || audio ? captured(video, audio) : userMedia(constraints);
      };
      try { Object.defineProperty(devices, 'getUserMedia', {value: getUserMedia, configurable: true, writable: true}); } catch (e) { /* keep */ }
      // Old extensions still use navigator.webkitGetUserMedia(constraints, success, failure).
      if (typeof navigator.webkitGetUserMedia === 'function') {
        try {
          const legacy = navigator.webkitGetUserMedia.bind(navigator);
          Object.defineProperty(navigator, 'webkitGetUserMedia', {configurable: true, writable: true, value: (constraints, success, failure) => {
            const c = constraints || {};
            if (!read(c.video) && !read(c.audio)) return legacy(constraints, success, failure);
            getUserMedia(c).then(success, failure);
          }});
        } catch (e) { /* keep */ }
      }
    }
    if (capturing && !acira.isWorker) installShim();

    let next = 0;
    return {
      tabCapture: {
        gate: () => acira.has('tabCapture'),
        factory: () => acira.build('tabCapture', {
          functions: {
            getMediaStreamId: options => acira.call('tabCapture.getMediaStreamId')(options || {}),
            getCapturedTabs: () => acira.call('tabCapture.getCapturedTabs')(),
            // capture(options, callback): the active tab, from a page of the extension (no worker), as a MediaStream.
            capture: async options => {
              const o = options || {};
              const id = await acira.call('tabCapture.captureStreamId')({audio: !!o.audio, video: !!o.video});
              const part = extra => ({mandatory: {...(extra && extra.mandatory && typeof extra.mandatory === 'object' ? extra.mandatory : {}), chromeMediaSource: 'tab', chromeMediaSourceId: id}});
              return navigator.mediaDevices.getUserMedia({audio: o.audio ? part(o.audioConstraints) : false, video: o.video ? part(o.videoConstraints) : false});
            }
          },
          events: {onStatusChanged: acira.event('tabCapture.onStatusChanged')}
        })
      },
      desktopCapture: {
        gate: () => acira.has('desktopCapture'),
        factory: () => acira.build('desktopCapture', {
          functions: {
            // Returns the request id at once; the callback gets (streamId, {canRequestAudioTrack}), streamId '' when cancelled.
            chooseDesktopMedia: (sources, targetTab) => {
              const requestId = ++next, tab = targetTab && typeof targetTab === 'object' ? {id: targetTab.id, url: targetTab.url} : null;
              const run = acira.call('desktopCapture.chooseDesktopMedia')(requestId, sources, tab)
                .then(result => acira.callbackArgs(result && result.streamId || '', {canRequestAudioTrack: !!(result && result.canRequestAudioTrack)}));
              return acira.later(requestId, run);
            },
            cancelChooseDesktopMedia: requestId => { acira.call('desktopCapture.cancelChooseDesktopMedia')(requestId).catch(() => undefined); }
          }
        })
      }
    };
  }
};
