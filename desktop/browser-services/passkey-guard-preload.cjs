'use strict';
// Passkeys and security keys (R3-37, P0 28 Oct; off by default 28 Oct). Windows' passkey dialog ("Choose a passkey" / "Create a passkey",
// Windows Security) opens for every WebAuthn call a page makes: Electron has no autofill list to answer a sign-in page's background
// requests (navigator.credentials.get with mediation 'conditional') the way Chrome does, so the modal dialog used to open on load, on
// focus and whenever the page re-armed it (Google's sign-in does this all the time). The person decides in Settings > Privacy >
// "Passkeys and security keys"; the answer is read from the main process at every call, so a change applies to open pages at once.
//  - OFF (the default): no passkey (publicKey) request ever reaches Windows. get()/create() are rejected at once with NotAllowedError, the
//    error a cancelled dialog gives; isUserVerifyingPlatformAuthenticatorAvailable() and isConditionalMediationAvailable() answer false;
//    getClientCapabilities() reports every capability false, so sites show their password form. A conditional get() (autofill sign-in)
//    waits until the page aborts it, as in Chrome with no passkey to offer, and still never reaches Windows.
//  - ON: today's guarded behaviour. get()/create() needs a fresh press on this page (transient user activation) and one dialog per press;
//    without one the call is refused with NotAllowedError. Conditional requests never reach Windows: get() waits until the page aborts
//    it, create() is refused. isConditionalMediationAvailable() answers false and getClientCapabilities() reports no conditional get or
//    create, so sites show their normal "Sign in with a passkey" button instead.
// macOS (2 Nov, `mac` set): Electron shows no passkey sheet of its own. Touch ID / iCloud Keychain passkeys need Apple's browser passkey
// entitlement, which no build has yet (mac-passkey-preload.cjs adds them in main frames once one does), and a phone (hybrid) needs a QR
// code Electron never shows. Yet the engine tells pages a passkey can be used (getClientCapabilities() says passkeyPlatformAuthenticator
// and hybridTransport, and autofill is reported available), so Google asked for a passkey and its "Verifying it's you…" page waited with
// nothing on screen until the sign-in session expired. Here the guard answers what is true on a Mac: no platform authenticator, no
// phone, no autofill (immediate mediation either). A passkey get()/create() is refused at once with NotAllowedError, what a cancelled
// sheet gives, so the site moves on to its other ways (Google: "Try another way"). A request only a security key can answer still
// reaches the engine, which talks to USB keys without any sheet: a get() whose every allowCredentials entry names only usb, nfc, ble or
// smart-card transports, a create() asking for a cross-platform authenticator, or either one hinting only 'security-key'. No setting and
// no press: nothing here opens a system dialog. The Windows press rule is not used on a Mac (it can suppress a sign-in request after
// navigation, when the initiating click belonged to the previous document). Linux keeps its native WebAuthn methods and answers.
// The refusal reads exactly as the engine's own (Chromium 152, measured 4 Nov: the same NotAllowedError, in 1 ms, when no authenticator has
// the passkey), and as Chrome's after the person cancels its sheet. Sites word it their own way: Google's passkey page said "Make sure
// Bluetooth is on" (founder, 3 Nov). So when the page itself asked for a passkey (not autofill, not a quiet immediate sign-in) and was
// refused, `refused` lets the main process say in a toast that this is Acira, not the person's Bluetooth: top frame only, once per page
// load, only while the page is on screen (main decides and answers whether it showed).
// Passwords, federated sign-in and every other credential call are untouched (the check is for `publicKey` options only). Runs before
// any page script in every website frame (tabs, pop-ups and Peek load preloads in iframes; every session registers it, private, Tor and
// secured ones included) and in the page's own world; a child frame that is still about:blank is covered by its parent the moment the
// parent reaches it. The main process backs this up for pages loaded after a change: with the choice off it adds a Permissions-Policy
// header (publickey-credentials-get / -create denied) to every web response, so the engine itself refuses the call in the frame and
// its children (Windows, content-blocking.cjs). If a Windows browser has no navigator.userActivation the guard does nothing. A sandboxed
// preload cannot require other files, so the guard is one function that executeInMainWorld serialises; tests/passkey-guard.test.cjs runs
// it against stand-in windows. `allowed` is the bridged answer from the main process (true only when the person turned passkeys on);
// `mac` selects the macOS answers above, which ask nothing of the main process; `refused` (macOS) is the bridged notice.
const {ipcRenderer,contextBridge}=require('electron');
const guard = function (allowed, mac, refused) {
  // The page's own globals can be replaced by page scripts later: everything the guard calls at request time is taken now, before any
  // page script runs. (A page that swapped Reflect.apply used to be handed the unguarded original on its next ordinary call.)
  const apply = Reflect.apply, keysOf = Object.keys, define = Object.defineProperty, createBare = Object.create, describe = Object.getOwnPropertyDescriptor;
  const covered = new WeakSet();
  const open = () => { try { return allowed() === true; } catch (error) { return false; } };
  const install = w => {
    try {
      if (!w || covered.has(w)) return;
      covered.add(w);
      const Container = w.CredentialsContainer, activation = w.navigator && w.navigator.userActivation;
      if (!Container || !Container.prototype || (!activation && !mac)) return;
      const proto = Container.prototype, Exception = w.DOMException, PromiseOf = w.Promise;
      // One passkey dialog per press: count trusted presses in this frame and remember which one the last request used.
      let presses = 0, spent = -1;
      if (!mac) for (const type of ['pointerdown', 'keydown', 'click', 'touchend']) w.addEventListener(type, event => { if (event.isTrusted) presses++; }, { capture: true, passive: true });
      // The engine's own isActive getter, taken now: a page that redefines UserActivation.prototype.isActive cannot fake a press.
      const activeGetter = (() => { try { const d = w.UserActivation && describe(w.UserActivation.prototype, 'isActive'); return d && typeof d.get === 'function' ? d.get : null; } catch (error) { return null; } })();
      const isActive = () => (activeGetter ? apply(activeGetter, activation, []) : activation.isActive) === true;
      const fresh = () => { if (!isActive() || presses === spent) return false; spent = presses; return true; };
      const refuse = message => PromiseOf.reject(new Exception(message, 'NotAllowedError'));
      const untilAborted = signal => new PromiseOf((resolve, reject) => {
        if (!signal || typeof signal.addEventListener !== 'function') return;
        if (signal.aborted) { reject(signal.reason); return; }
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      // macOS: what only a security key can answer (a list counts when it has entries and every one passes; plain comparisons, so a page
      // that replaces Array methods cannot change the answer). Anything else (internal, hybrid, no transports given) is refused at once.
      const every = (list, test) => {
        if (!list || typeof list !== 'object' || typeof list.length !== 'number' || list.length < 1) return false;
        for (let i = 0; i < list.length; i++) if (!test(list[i])) return false;
        return true;
      };
      const keyTransport = value => value === 'usb' || value === 'nfc' || value === 'ble' || value === 'smart-card';
      const securityKeyOnly = (publicKey, creating) => every(publicKey.hints, hint => hint === 'security-key') || (creating
        ? Boolean(publicKey.authenticatorSelection) && publicKey.authenticatorSelection.authenticatorAttachment === 'cross-platform'
        : every(publicKey.allowCredentials, item => Boolean(item) && every(item.transports, keyTransport)));
      const onMac = (options, creating) => {
        try {
          if (securityKeyOnly(options.publicKey, creating)) return undefined;
          // This frame's own request (a child frame the parent's guard covered when it reached it says nothing).
          if (options.mediation !== 'immediate' && w === window && typeof refused === 'function') { try { refused(); } catch (error) { /* A closing frame. */ } }
          return refuse('The operation either timed out or was not allowed. See: https://www.w3.org/TR/webauthn-2/#sctn-privacy-considerations-client.');
        } catch (error) { return PromiseOf.reject(error); }
      };
      // The engine converts any object as the options dictionary (a function too, and document.all, whose typeof is 'undefined') and reads
      // its members again. So the options are read once, here, into a plain copy: the decision and the engine see the same values, and a
      // getter cannot hide publicKey from the guard and show it to the engine.
      const dictionary = options => options !== undefined && options !== null && (typeof options === 'object' || typeof options === 'function' || typeof options === 'undefined');
      // The copy has no prototype and only own data properties, so nothing the page puts on Object.prototype answers for it.
      const own = (object, key, value) => define(object, key, { value, writable: true, enumerable: true, configurable: true });
      const snapshot = options => {
        if (!dictionary(options)) return options;
        const copy = createBare(null);
        for (const key of keysOf(options)) own(copy, key, options[key]);
        for (const key of ['publicKey', 'mediation', 'signal']) own(copy, key, options[key]);
        return copy;
      };
      const passkey = options => Boolean(options && typeof options === 'object' && options.publicKey !== undefined && options.publicKey !== null);
      const wrap = (owner, name, decide, copyOptions) => {
        const original = owner[name];
        if (typeof original !== 'function') return;
        const guarded = new Proxy(original, { apply(target, self, args) {
          let given = args;
          // Only the first argument means anything to get()/create(); an array literal is built without setters or iterators.
          if (copyOptions && args.length) { try { given = [snapshot(args[0])]; } catch (error) { return PromiseOf.reject(error); } }
          const answer = decide(given); return answer === undefined ? apply(target, self, given) : answer;
        } });
        define(owner, name, { value: guarded, writable: true, configurable: true, enumerable: true });
      };
      // args[0], not a destructured ([options]): destructuring would go through Array.prototype[Symbol.iterator], which the page can replace.
      wrap(proto, 'get', args => {
        const options = args[0];
        if (!passkey(options)) return undefined;
        if (options.mediation === 'conditional') return untilAborted(options.signal);
        if (mac) return onMac(options, false);
        if (!open()) return refuse('The operation either timed out or was not allowed.');
        return fresh() ? undefined : refuse('Signing in with a passkey needs a click or tap on this page first.');
      }, true);
      wrap(proto, 'create', args => {
        const options = args[0];
        if (!passkey(options)) return undefined;
        if (mac) return options.mediation === 'conditional' ? refuse('Automatic passkey creation is not available.') : onMac(options, true);
        if (!open()) return refuse('The operation either timed out or was not allowed.');
        if (options.mediation === 'conditional') return refuse('Automatic passkey creation is not available.');
        return fresh() ? undefined : refuse('Creating a passkey needs a click or tap on this page first.');
      }, true);
      const Key = w.PublicKeyCredential;
      if (Key) {
        wrap(Key, 'isConditionalMediationAvailable', () => PromiseOf.resolve(false));
        wrap(Key, 'isUserVerifyingPlatformAuthenticatorAvailable', () => (!mac && open() ? undefined : PromiseOf.resolve(false)));
        const capabilities = Key.getClientCapabilities;
        if (typeof capabilities === 'function') Object.defineProperty(Key, 'getClientCapabilities', { value: new Proxy(capabilities, { apply(target, self, args) {
          return PromiseOf.resolve(apply(target, self, args)).then(found => {
            // Mac: security keys and the extensions stay as the engine reports them; nothing that needs a sheet or a phone.
            if (mac) return Object.assign({}, found, { conditionalCreate: false, conditionalGet: false, hybridTransport: false, immediateGet: false, passkeyPlatformAuthenticator: false, userVerifyingPlatformAuthenticator: false });
            if (open()) return Object.assign({}, found, { conditionalGet: false, conditionalCreate: false });
            // Off: nothing is supported, whatever the engine knows (the known names stay present so a page reads false, not undefined).
            const none = {};
            for (const name of ['conditionalCreate', 'conditionalGet', 'hybridTransport', 'passkeyPlatformAuthenticator', 'userVerifyingPlatformAuthenticator', 'relatedOrigins', 'signalAllAcceptedCredentials', 'signalCurrentUserDetails', 'signalUnknownCredential']) none[name] = false;
            if (found && typeof found === 'object') for (const name of Object.keys(found)) none[name] = false;
            return none;
          });
        } }), writable: true, configurable: true, enumerable: true });
      }
      // Child frames with nothing loaded yet share this page's origin: guard them the moment this frame reaches them.
      const cover = child => { try { if (child && child !== w && child.location.href === 'about:blank') install(child); } catch (error) { /* Another origin. */ } return child; };
      for (const Frame of [w.HTMLIFrameElement, w.HTMLFrameElement, w.HTMLObjectElement]) {
        if (!Frame) continue;
        for (const [name, reach] of [['contentWindow', value => cover(value)], ['contentDocument', value => { try { if (value) cover(value.defaultView); } catch (error) { /* Another origin. */ } return value; }]]) {
          const descriptor = Object.getOwnPropertyDescriptor(Frame.prototype, name);
          if (!descriptor || typeof descriptor.get !== 'function') continue;
          const read = descriptor.get;
          Object.defineProperty(Frame.prototype, name, { ...descriptor, get: new Proxy(read, { apply(target, self, args) { return reach(apply(target, self, args)); } }) });
        }
      }
    } catch (error) { /* A page without credentials support. */ }
  };
  install(window);
};
if(process.platform==='win32'&&(/^(?:blob:)?https?:/.test(location.href)||location.href==='about:srcdoc')){
 try{
  // The live answer is asked of the main process at each call (a closed or missing answer reads as off), never cached in the page.
  const allowed=()=>{try{return ipcRenderer.sendSync('acira:passkeys-allowed')===true;}catch{return false;}};
  contextBridge.executeInMainWorld({func:guard,args:[allowed]});
 }catch{/* A closing window. */}
}else if(process.platform==='darwin'&&(/^(?:blob:)?https?:/.test(location.href)||location.href==='about:srcdoc')){
 // Registered before mac-passkey-preload.cjs: in a main frame where Apple's passkeys are approved, that bridge sits on top and hands
 // the guard only what it leaves to the engine (security keys, unsupported extensions).
 // The notice: asked of main from the top frame only; once main has shown it, never again in this document (this world's own state,
 // out of the page's reach). A page that was not on screen keeps its one notice for a later refusal.
 let notice='ready';
 const refused=()=>{if(notice!=='ready'||window.top!==window)return;notice='asking';ipcRenderer.invoke('acira:passkey-refused').then(shown=>{notice=shown===true?'shown':'ready';},()=>{notice='ready';});};
 try{contextBridge.executeInMainWorld({func:guard,args:[null,true,refused]});}catch{/* A closing window. */}
}
