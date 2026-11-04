'use strict';
// macOS (founder, 3 Nov): Acira can't use passkeys on a Mac yet (no build has Apple's browser passkey entitlement), so the passkey guard
// (passkey-guard-preload.cjs) refuses a site's passkey request at once, as Chrome answers a cancelled sheet. Sites word that refusal their own
// way: Google's passkey page said "Something went wrong. Make sure Bluetooth is on…", and the founder's Bluetooth was on. When a page's top
// frame asked for a passkey and was refused, this answers the guard's 'acira:passkey-refused' with the existing toast saying it is Acira
// and what to do instead. The guard asks at most until one is shown per page load; the answer says whether it was shown.
//  - top frame of a website tab only: an iframe (a widget, an ad), a pop-up window or an Acira page never raises it;
//  - only while that page is on screen (the active page, or a pane of the split on screen): a page in the background stays quiet and may
//    ask again later; profiles as spaces: never in another profile's space (like "Pop-up blocked").
const NOTICE = 'main.passkeysUnavailableMac';

function createPasskeyNotice({controllers, tm}) {
  return function passkeyRefused(event) {
    try {
      const contents = event && event.sender, frame = event && event.senderFrame;
      if (!contents || contents.isDestroyed() || !frame || frame.parent || !/^https?:/i.test(frame.url || '')) return false;
      for (const c of controllers) {
        if (c.closing || !c.state || !c.pages) continue;
        for (const [, entry] of c.pages) {
          if (entry.view.webContents !== contents) continue;
          if (entry.tabProfileId && entry.tabProfileId !== c.state.activeBrowserProfileId) return false;
          if (!entry.view.getVisible()) return false;
          c.toast(tm(NOTICE), {i18n: {id: NOTICE}, tone: 'info'});
          return true;
        }
      }
    } catch (error) { /* A closing window. */ }
    return false;
  };
}

module.exports = {createPasskeyNotice, NOTICE};
