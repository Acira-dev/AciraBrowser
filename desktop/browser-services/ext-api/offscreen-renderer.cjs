'use strict';
// chrome.offscreen (P9). Chromium 152 brings its own offscreen documents, but Electron hosts them in an ExtensionHost whose media requests
// go through app_shell's media_capture_util: microphone and camera only, every tab or screen request answered "Invalid state". So a
// document made for capture (reasons USER_MEDIA, DISPLAY_MEDIA or WEB_RTC: Loom, Screencastify, meeting recorders) is Acira's own (a
// hidden page of the extension, extension-apis.cjs createOffscreen), where getUserMedia with a tabCapture/desktopCapture stream id and
// getDisplayMedia reach the session's display-media handler. Every other reason keeps Chromium's document (its lifetime rules, its
// context type). Either way an extension has at most one document, and hasDocument/closeDocument answer for whichever it has.
// Written into the preload as source text: uses only `acira` and the page's globals.
module.exports = {
  namespaces: ['offscreen'],
  renderer(acira) {
    const CAPTURE = ['USER_MEDIA', 'DISPLAY_MEDIA', 'WEB_RTC'];
    const ONE = 'Only a single offscreen document may be created.', NONE = 'No current offscreen document.';
    return {
      offscreen: {
        gate: () => acira.has('offscreen'),
        factory: base => {
          const native = name => (base && typeof base[name] === 'function' ? (...args) => base[name](...args) : null);
          const nativeCreate = native('createDocument'), nativeClose = native('closeDocument'), nativeHas = native('hasDocument');
          const nativeHasDocument = async () => { if (!nativeHas) return false; try { return !!(await nativeHas()); } catch (e) { return false; } };
          const ours = {create: acira.call('offscreen.createDocument'), close: acira.call('offscreen.closeDocument'), has: acira.call('offscreen.hasDocument')};
          return acira.build('offscreen', {
            functions: {
              createDocument: async parameters => {
                const reasons = Array.isArray(parameters.reasons) ? parameters.reasons : [];
                const forCapture = !nativeCreate || reasons.some(reason => CAPTURE.includes(reason));
                if (forCapture) {
                  if (await nativeHasDocument()) throw new Error(ONE);
                  return ours.create(parameters);
                }
                if (await ours.has()) throw new Error(ONE);
                return nativeCreate(parameters);
              },
              closeDocument: async () => {
                if (await ours.has()) return ours.close();
                if (nativeClose && await nativeHasDocument()) return nativeClose();
                throw new Error(NONE);
              },
              hasDocument: async () => (await ours.has()) === true || await nativeHasDocument()
            }
          });
        }
      }
    };
  }
};
