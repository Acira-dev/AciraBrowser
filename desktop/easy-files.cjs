'use strict';
// Easy Files (Beta 14, section AB): when a page asks for a file (an <input type=file>, a click on a styled upload button, input.click(), showPicker()),
// Acira shows a small glass pop-up at the upload button with the clipboard picture, the newest screenshots and the latest downloads, instead of the
// system file window opening straight away. One click attaches the file; Esc or a click away cancels; "Browse all files…" is the system window.
//
// How the request is caught (Electron 44 has no file-chooser event, so this is the page's debugger connection, shared through page-debugger.cjs):
//   Page.setInterceptFileChooserDialog {enabled:true}  Chromium shows NO system window and tells us instead: Page.fileChooserOpened {backendNodeId, mode, frameId}
//   DOM.setFileInputFiles {files, backendNodeId}       the page gets input + change exactly as from the system window (a trusted FileList of the real files)
//   cancel                                             the input is sent the 'cancel' event Chromium sends when the system window is dismissed
//   Target.setAutoAttach {flatten, filter:[iframe]}    a cross-origin frame is its own process: it is intercepted in its own session (never a worker: see site-appearance.cjs)
// The connection is made only for a page the person is using (its first pointer or key event, or when it is the page on screen), never for a page
// that sits in the background, and only while the setting allows it for that kind of window. The site learns nothing about the list: names, sizes and
// thumbnails go to Acira's own interface only; paths never leave this file; the page receives only the file that is picked.
//
// Tests never see a system file window: the interception IS the seam (nothing opens natively while it is on), "Browse all files…" goes through
// dialog.showOpenDialog (a stand-in in tests), and in a test profile (ACIRA_BROWSER_TEST_DATA) every page is intercepted even where the feature is
// off, so a click can never reach the system window (see `testSeam`).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/** What the pop-up offers (one place to change a number the team may want different). */
const LIMITS = Object.freeze({
  screenshots: 24,                 // pictures in the row (the clipboard picture comes first and is not counted)
  screenshotDays: 30,              // a screenshot older than this is not "recent"
  downloads: 3,                    // download rows
  thumb: 240,                      // thumbnail edge in px (2x of a 112 x 70 tile, 7x of a 32 px row)
  thumbMs: 5000,                   // a thumbnail that takes longer than this is given up (and asked for again next time)
  thumbCache: 160,                 // thumbnails kept in memory (never on disk)
  firstFrameTiles: 4,              // the pictures on the pop-up's first frame (2.9 tiles show, the next one peeks out): they are waited for, so the pop-up opens with its pictures in place
  firstFrameMs: 300,               // ...but never longer than this: a slow thumbnail fills its tile in afterwards instead of holding the pop-up back
  offerMs: 10 * 60 * 1000,         // a pop-up nobody answers is cancelled after this
  scanFiles: 400,                  // directory entries looked at when looking for screenshots
  tempDays: 1,                     // a pasted picture written for a pick is removed after this
});

const IMAGE = /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif|tiff?)$/i;
const MIME = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml', ico: 'image/x-icon',
  pdf: 'application/pdf', zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar', '7z': 'application/x-7z-compressed', rar: 'application/vnd.rar', json: 'application/json', xml: 'application/xml',
  txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', html: 'text/html', htm: 'text/html', rtf: 'application/rtf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', odt: 'application/vnd.oasis.opendocument.text',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', flac: 'audio/flac',
});
const extOf = name => (path.extname(String(name)).slice(1) || '').toLowerCase();

/** accept="image/*,.pdf,application/zip" → does this file name pass? An empty list takes everything; so does a list none of whose entries is understood (the system window then shows every file too). */
function accepts(accept, name) {
  const tokens = String(accept || '').split(',').map(token => token.trim().toLowerCase()).filter(Boolean);
  if (!tokens.length) return true;
  const known = token => token.startsWith('.') || token.endsWith('/*') || Object.values(MIME).includes(token);
  if (!tokens.some(known)) return true;
  const ext = extOf(name), mime = MIME[ext] || '';
  return tokens.some(token => token.startsWith('.') ? token === '.' + ext : token.endsWith('/*') ? mime.startsWith(token.slice(0, -1)) : token === mime);
}

/** The system window's file-type filters for the same accept list ("Accepted files", then "All files"). */
function dialogFilters(accept) {
  const tokens = String(accept || '').split(',').map(token => token.trim().toLowerCase()).filter(Boolean);
  const extensions = new Set();
  for (const token of tokens) {
    if (token.startsWith('.')) extensions.add(token.slice(1));
    else for (const [ext, mime] of Object.entries(MIME)) if (token.endsWith('/*') ? mime.startsWith(token.slice(0, -1)) : mime === token) extensions.add(ext);
  }
  return extensions.size ? [{ name: 'Accepted files', extensions: [...extensions] }, { name: 'All files', extensions: ['*'] }] : undefined;
}

/** The names the system gives its screenshots (macOS "Screenshot 2026-11-13 at 10.00.00.png" and the older "Screen Shot …", Windows "Screenshot (12).png", GNOME "Screenshot from …", KDE "Screenshot_…"). */
const SCREENSHOT_NAME = /^(screen ?shot|screenshot|screen capture|bildschirmfoto|capture d.écran|captura de pantalla|スクリーンショット|截屏|截图)/i;
const looksLikeScreenshot = name => IMAGE.test(name) && SCREENSHOT_NAME.test(name);

/** Where the system keeps screenshots, best guess first (a folder the person never put screenshots in simply lists nothing). `read` gives a macOS preference; tests give their own. */
function screenshotFolders({ platform = process.platform, getPath, env = process.env, read = () => '' }) {
  const place = name => { try { return getPath(name); } catch { return ''; } };
  if (env.ACIRA_EASY_FILES_SCREENSHOTS) return [{ dir: env.ACIRA_EASY_FILES_SCREENSHOTS, named: false }];
  const pictures = place('pictures'), folders = [];
  if (platform === 'darwin') {
    const configured = read();
    folders.push({ dir: configured || place('desktop'), named: true });
  } else {
    if (pictures) folders.push({ dir: path.join(pictures, 'Screenshots'), named: false });
    if (pictures) folders.push({ dir: pictures, named: true });
  }
  return folders.filter(folder => folder.dir);
}

function createEasyFiles(deps) {
  const {
    app, clipboard, nativeImage, dialog, pageDebugger, settings, downloads, emit,
    window = () => null, isPrivate = () => false, env = process.env, now = Date.now, log = () => {}, ownScreenshots = () => [], isOwnScreenshotName = () => false, macScreenshotFolder = null,
  } = deps;
  /** macOS lets the person move the screenshots (defaults com.apple.screencapture location): asked in the background, never while a pop-up waits. */
  let macFolder = '';
  const readMacFolder = () => { if (typeof macScreenshotFolder === 'function') Promise.resolve().then(macScreenshotFolder).then(dir => { macFolder = typeof dir === 'string' ? dir : ''; }, () => {}); };
  const tempRoot = deps.tempRoot || path.join(app.getPath('temp'), 'acira-easy-files');
  // In a test profile no page may ever reach the system window: every page is intercepted whatever the setting says.
  const testSeam = deps.testSeam ?? (() => Boolean(env.ACIRA_BROWSER_TEST_DATA));
  const AUTO = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: 'iframe' }, { exclude: true }] }; // frames only: a worker is never attached (and never detached)
  const api = { pending: null, events: [], watchers: new Map(), browsing: false };
  const note = (...parts) => { api.events.push(parts.join(' ')); if (api.events.length > 80) api.events.shift(); try { log(...parts); } catch { /* a logger never stops the feature */ } };
  const withTimeout = (promise, ms) => { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The page did not answer.')), ms); timer.unref?.(); })]).finally(() => clearTimeout(timer)); };

  // ---------------------------------------------------------------------------------------------------------------- what to offer
  const thumbs = new Map(); // path|size|mtime → Promise<dataURL|null>, in memory only
  /** A small picture for a tile or a row, made by the system's own thumbnailer (macOS, Windows: asynchronous, off this thread, a PDF's first page when it can).
   *  Elsewhere a picture is decoded here, one at a time with the loop free in between. Null: nothing better than an icon (the interface draws its own). */
  function thumbnail(file, stat) {
    const key = file + '|' + stat.size + '|' + stat.mtimeMs;
    if (thumbs.has(key)) { const hit = thumbs.get(key); thumbs.delete(key); thumbs.set(key, hit); return hit; }
    const made = (async () => {
      const edge = LIMITS.thumb;
      if (typeof nativeImage.createThumbnailFromPath === 'function') {
        try { const image = await nativeImage.createThumbnailFromPath(file, { width: edge, height: edge }); if (image && !image.isEmpty()) return image.toDataURL(); } catch { /* no thumbnail for this one: fall through */ }
      }
      if (!IMAGE.test(file) || stat.size > 40 * 1024 * 1024) return null;
      await new Promise(resolve => setImmediate(resolve));
      try {
        const image = nativeImage.createFromBuffer(await fs.promises.readFile(file));
        if (image.isEmpty()) return null;
        const { width, height } = image.getSize(), k = Math.min(1, edge / width, edge / height);
        return (k < 1 ? image.resize({ width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)), quality: 'good' }) : image).toDataURL();
      } catch { return null; }
    })();
    // A thumbnailer that never answers (a slow network volume) must not hold every later pop-up for the same file: it is given up after a while and asked again next time.
    let timer; const guarded = Promise.race([made.finally(() => clearTimeout(timer)), new Promise(resolve => { timer = setTimeout(() => { if (thumbs.get(key) === guarded) thumbs.delete(key); resolve(null); }, LIMITS.thumbMs); timer.unref?.(); })]);
    thumbs.set(key, guarded);
    while (thumbs.size > LIMITS.thumbCache) thumbs.delete(thumbs.keys().next().value);
    return guarded;
  }

  /** The clipboard's picture, if it holds one (read now, when the pop-up opens; never kept). Electron 44's clipboard is the asynchronous one. */
  async function clipboardImage() {
    // A test profile never reads the real clipboard (it is the person's): it reads the picture the rig names, or has none.
    if (testSeam()) {
      try { const image = env.ACIRA_EASY_FILES_CLIPBOARD ? nativeImage.createFromPath(env.ACIRA_EASY_FILES_CLIPBOARD) : null; return image && !image.isEmpty() ? image : null; } catch { return null; }
    }
    try {
      if (!(await clipboard.has('image/png'))) return null;
      for (const item of await clipboard.read()) {
        if (!item.types.includes('image/png')) continue;
        const image = nativeImage.createFromBuffer(Buffer.from(await (await item.getType('image/png')).arrayBuffer()));
        return image.isEmpty() ? null : image;
      }
    } catch (error) { note('clipboard', error.message); }
    return null;
  }

  /** The newest screenshots: the system's folder, plus Acira's own screenshots (section R) first. Only file names are read, then only the newest few are looked at. */
  function screenshots(accept, ctx = {}) {
    const found = [], seen = new Set(), cutoff = now() - LIMITS.screenshotDays * 86400000;
    const add = (file, stat) => { if (seen.has(file) || !stat.isFile() || stat.mtimeMs < cutoff || !accepts(accept, path.basename(file))) return; seen.add(file); found.push({ file, name: path.basename(file), stat, own: false }); };
    try {
      // Section R saves a page screenshot into the downloads folder and lists it like any download (a private tab's file carries the private mark): the downloads list, under the same
      // window / profile / private rules as the Downloads rows, is where Acira's own screenshots are found; the hook can name more.
      const own = [...ownScreenshots(ctx) || [], ...finishedDownloads(ctx.privateWindow, ctx.profileId).filter(item => isOwnScreenshotName(item.name || path.basename(item.path))).map(item => item.path)];
      for (const file of own) { try { add(file, fs.statSync(file)); const last = found[found.length - 1]; if (last && last.file === file) last.own = true; } catch { /* gone */ } }
    } catch (error) { note('own-screenshots', error.message); }
    for (const folder of screenshotFolders({ getPath: name => app.getPath(name), env, read: () => macFolder })) {
      try {
        const names = fs.readdirSync(folder.dir).filter(name => (folder.named ? looksLikeScreenshot(name) : IMAGE.test(name))).slice(0, LIMITS.scanFiles);
        for (const name of names) { const file = path.join(folder.dir, name); try { add(file, fs.statSync(file)); } catch { /* gone */ } }
      } catch { /* no such folder: nothing to offer from it */ }
    }
    // Acira's own screenshots lead (a fresh one is what the person just took); everything else by time.
    found.sort((a, b) => Number(b.own) - Number(a.own) || b.stat.mtimeMs - a.stat.mtimeMs);
    return found.slice(0, LIMITS.screenshots);
  }

  /** Acira's own finished downloads whose file is still there, newest first. A normal window offers its profile's downloads (never a private tab's); a private window that is allowed to offer files offers only what that window downloaded. */
  function finishedDownloads(privateWindow, profileId) {
    const rows = (typeof downloads === 'function' ? downloads() : []) || [];
    return rows
      .filter(item => item && item.path && /^(complete|completed|done|ready|finished)$/i.test(String(item.status || '')) && Boolean(item.private) === Boolean(privateWindow) && (!item.browserProfileId || !profileId || item.browserProfileId === profileId))
      .sort((a, b) => (b.endedAt || b.startedAt || 0) - (a.endedAt || a.startedAt || 0));
  }
  /** `taken`: files the Pictures row already shows (Acira's own screenshots are in the downloads list too): a file is offered once. */
  function recentDownloads(accept, privateWindow, profileId, taken = new Set()) {
    return finishedDownloads(privateWindow, profileId)
      .filter(item => !taken.has(item.path))
      .filter(item => { try { return fs.statSync(item.path).isFile() && accepts(accept, item.name || path.basename(item.path)); } catch { return false; } })
      .slice(0, LIMITS.downloads);
  }

  /** Everything the pop-up offers, without thumbnails yet (they follow, tile by tile). `paths` stays here. */
  async function gather({ accept, privateWindow, profileId }) {
    const items = [], paths = new Map(), later = [];
    readMacFolder();
    const image = await clipboardImage();
    if (image && accepts(accept, 'clipboard.png')) {
      const { width, height } = image.getSize();
      items.push({ id: 'clip', section: 'clipboard', name: 'Clipboard', detail: `${width} × ${height}`, bytes: 0, at: now(), picture: true });
      paths.set('clip', { clipboard: image });                           // encoded to a file only if it is picked
      later.push({ id: 'clip', first: true, make: async () => { const edge = LIMITS.thumb, k = Math.min(1, edge / width, edge / height); return (k < 1 ? image.resize({ width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)), quality: 'good' }) : image).toDataURL(); } });
    }
    const shots = screenshots(accept, { privateWindow, profileId });
    shots.forEach((shot, index) => {
      const id = 'shot' + index;
      items.push({ id, section: 'screenshots', name: shot.name, bytes: shot.stat.size, at: shot.stat.mtimeMs, picture: true });
      paths.set(id, { file: shot.file });
      later.push({ id, first: items.filter(item => item.section !== 'downloads').length <= LIMITS.firstFrameTiles, make: () => thumbnail(shot.file, shot.stat) });
    });
    recentDownloads(accept, privateWindow, profileId, new Set(shots.map(shot => shot.file))).forEach((item, index) => {
      const id = 'dl' + index, stat = fs.statSync(item.path), name = item.name || path.basename(item.path), picture = IMAGE.test(name);
      items.push({ id, section: 'downloads', name, bytes: stat.size, at: item.endedAt || stat.mtimeMs, picture });
      paths.set(id, { file: item.path });
      if (picture || /\.pdf$/i.test(name)) later.push({ id, first: true, make: () => thumbnail(item.path, stat) });
    });
    return { items, paths, later };
  }

  // ---------------------------------------------------------------------------------------------------------------- where the upload button is
  /** The upload button's box in the page view's own pixels: the input itself when it shows; else the button that was just pressed (most upload buttons are a styled
   *  <button> or <label> over a hidden input, or a detached input a script clicks); else the focused element (the keyboard); else null (the middle of the page). */
  async function anchorOf(send, wc, backendNodeId, lastDown, frameOffset) {
    const zoom = wc.getZoomFactor ? wc.getZoomFactor() : 1;
    const { object } = await send('DOM.resolveNode', { backendNodeId });
    const fresh = lastDown && now() - lastDown.at < 3000;
    const down = fresh ? { x: lastDown.x / zoom - (frameOffset?.x || 0), y: lastDown.y / zoom - (frameOffset?.y || 0) } : null;
    const { result } = await send('Runtime.callFunctionOn', {
      objectId: object.objectId, returnByValue: true, arguments: [{ value: down }],
      functionDeclaration: `function (down) {
        const view = { w: innerWidth, h: innerHeight };
        // A box counts only when it has a size, is not hidden, and is (at least partly) inside the window: a hidden input parked at left:-9999px is not where the button is.
        const box = e => { if (!e || !e.getBoundingClientRect) return null; const r = e.getBoundingClientRect(); if (!(r.width > 1 && r.height > 1) || getComputedStyle(e).visibility === 'hidden') return null; if (r.right <= 0 || r.bottom <= 0 || r.left >= view.w || r.top >= view.h) return null; return { x: r.x, y: r.y, width: r.width, height: r.height }; };
        const deep = (x, y) => { let hit = document.elementFromPoint(x, y); while (hit && hit.shadowRoot && hit.shadowRoot.elementFromPoint) { const inner = hit.shadowRoot.elementFromPoint(x, y); if (!inner || inner === hit) break; hit = inner; } return hit; };
        const own = box(this);
        let pressed = null;
        if (down) { const hit = deep(down.x, down.y); pressed = box(hit && ((hit.closest && hit.closest('button,label,[role=button],a,input,summary')) || hit)); }
        // A menu item that closed itself before the script clicked its input (WhatsApp Web's attach menu) leaves the chat pane under the pointer: a box that covers much of the window is not
        // "the button": the pop-up then hangs from the point that was pressed.
        if (pressed && down && pressed.width * pressed.height > view.w * view.h * .4) pressed = { x: Math.max(0, down.x - 1), y: Math.max(0, down.y - 1), width: 2, height: 2 };
        // What the person actually pressed wins when the input is not under the pointer (a styled button over a hidden or parked input); the input itself wins when it is.
        const under = own && down && down.x >= own.x && down.x <= own.x + own.width && down.y >= own.y && down.y <= own.y + own.height;
        let at = null, how = '';
        if (own && (under || !pressed)) { at = own; how = 'input'; }
        else if (pressed) { at = pressed; how = 'pressed'; }
        if (!at) { let focus = document.activeElement; while (focus && focus.shadowRoot && focus.shadowRoot.activeElement) focus = focus.shadowRoot.activeElement; at = box(focus && focus !== document.body ? focus : null); how = at ? 'focused' : ''; }
        return { accept: String(this.accept || ''), multiple: !!this.multiple, directory: !!this.webkitdirectory, at, how };
      }`,
    });
    const value = result.value || {};
    if (value.at) value.at = { x: (value.at.x + (frameOffset?.x || 0)) * zoom, y: (value.at.y + (frameOffset?.y || 0)) * zoom, width: value.at.width * zoom, height: value.at.height * zoom };
    return { ...value, objectId: object.objectId };
  }

  // ---------------------------------------------------------------------------------------------------------------- the page watch
  const enabledFor = w => {
    let s = {}; try { s = settings() || {}; } catch { /* default */ }
    return isPrivate(w) ? s.easyFilesPrivate === true : s.easyFiles !== false;
  };
  const wanted = w => enabledFor(w) || testSeam();

  /** Take the page's debugger (shared, page-debugger.cjs) and switch interception on for the page and, as they appear, its cross-process frames. */
  async function connect(w) {
    if (w.lease && !w.lease.over) return true;
    if (w.connecting) return w.connecting;
    w.connecting = (async () => {
      if (w.wc.isDestroyed()) return false;
      const lease = pageDebugger.acquire(w.wc, 'easy-files');
      if (!lease) { note('no-lease', w.ctx.tabId); return false; }       // Tor, a hidden cookie page: somebody else's debugger; the page keeps the system window
      w.lease = lease; w.frames = new Map();
      lease.frames = true;                                              // site-appearance.cjs must not switch auto-attach off while this is held
      lease.onDetach(() => { if (w.lease === lease) { w.lease = null; w.frames = new Map(); note('detached', w.ctx.tabId); if (!w.dead) { w.lastTry = 0; setTimeout(() => { try { w.arm && w.arm(); } catch { /* gone */ } }, 150).unref?.(); } } });   // a page that was in use takes its debugger back at once (a cross-process navigation can end the session)
      w.listener = (_event, method, params, rawSession) => {
        try {
          const sessionId = rawSession || undefined;                     // the page's own messages carry '' (and '' is refused as a session id)
          if (method === 'Target.detachedFromTarget' && params?.sessionId) { w.frames.delete(params.sessionId); return; }
          if (method === 'Target.attachedToTarget' && params?.sessionId) {
            if (params.targetInfo?.type !== 'iframe') return;            // not ours: no command, above all no detach
            w.frames.set(params.sessionId, { url: String(params.targetInfo.url || ''), intercepted: false });
            void interceptIn(w, params.sessionId).then(() => { const frame = w.frames.get(params.sessionId); if (frame) frame.intercepted = true; note('intercepting frame', String(params.targetInfo.url || '').slice(0, 80)); }, error => note('frame-intercept-failed', error.message));
            return;
          }
          if (method === 'Page.fileChooserOpened') void onChooser(w, params || {}, sessionId);
        } catch (error) { note('message-failed', error.message); }
      };
      lease.on('message', w.listener);
      try {
        await interceptIn(w, undefined);
        note('intercepting', w.ctx.tabId);
        return true;
      } catch (error) { note('intercept-failed', error.message); await disconnect(w); return false; }
    })().finally(() => { w.connecting = null; });
    return w.connecting;
  }
  const interceptIn = async (w, sessionId) => {
    const lease = w.lease; if (!lease) return;
    const send = (method, params) => withTimeout(lease.sendCommand(method, params, sessionId), 4000);
    await send('Page.enable', {});
    await send('Page.setInterceptFileChooserDialog', { enabled: true });
    await send('Target.setAutoAttach', AUTO);                            // frames inside this one
  };
  /** Give the system window back to the page: interception off in every session we switched it on in, then let go of the lease (the debugger stays while others hold it). */
  async function disconnect(w) {
    const lease = w.lease; w.lease = null;
    if (!lease) return;
    try { if (w.listener) lease.removeListener('message', w.listener); } catch { /* gone */ }
    w.listener = null;
    if (!lease.over) {
      for (const sessionId of [...(w.frames ? w.frames.keys() : []), undefined]) { try { await withTimeout(lease.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }, sessionId), 2000); } catch { /* the frame is gone */ } }
    }
    w.frames = new Map();
    lease.release();
  }
  /** (Re)decide for one page: connect when the setting allows it and the page is in use, let go when it does not. */
  async function settle(w) {
    if (!w || w.dead) return;
    if (!wanted(w)) { if (api.pending?.w === w) await dismiss('setting', { cancelPage: true }); await disconnect(w); return; }
    if (w.armed) await connect(w);
  }

  function watch(wc, ctx) {
    const w = { wc, ctx, lease: null, frames: new Map(), armed: false, dead: false, lastDown: null, listener: null, connecting: null, lastTry: 0 };
    api.watchers.set(wc, w);
    // Armed once the page is used; and again whenever its debugger was lost (a detach, a crash and reload, another client): the next pointer, key or load reconnects it, at most every 500 ms.
    const arm = () => {
      if (w.dead) return;
      w.armed = true;
      if ((w.lease && !w.lease.over) || w.connecting || now() - w.lastTry < 500) return;
      w.lastTry = now(); void settle(w).catch(error => note('arm-failed', error.message));
    };
    w.arm = arm;
    wc.on('before-mouse-event', (_event, mouse) => { if (mouse.type === 'mouseDown') w.lastDown = { x: mouse.x, y: mouse.y, at: now() }; arm(); });
    wc.on('before-input-event', () => arm());
    wc.on('dom-ready', () => { try { if (ctx.visible?.()) arm(); } catch { /* not asked */ } });
    wc.on('did-start-navigation', (event, _url, inPlace, isMainFrame) => {
      const main = event && typeof event.isMainFrame === 'boolean' ? event.isMainFrame : isMainFrame !== false, same = event && typeof event.isSameDocument === 'boolean' ? event.isSameDocument : Boolean(inPlace);
      if (main && !same && api.pending?.w === w) void dismiss('navigated');
    });
    wc.on('render-process-gone', () => { if (api.pending?.w === w) void dismiss('crashed'); w.lease = null; w.frames = new Map(); });
    wc.once('destroyed', () => {
      w.dead = true; api.watchers.delete(wc);
      if (api.pending?.w === w) void dismiss('closed');
      const lease = w.lease; w.lease = null;
      try { if (lease) { if (w.listener) lease.removeListener('message', w.listener); lease.release(); } } catch { /* the page is gone */ }
    });
    try { if (ctx.visible?.()) arm(); } catch { /* not asked */ }
    return w;
  }
  /** The setting changed: every page that is in use is decided again. */
  const refresh = () => Promise.allSettled([...api.watchers.values()].map(settle));

  // ---------------------------------------------------------------------------------------------------------------- one request
  const cmdOf = (w, sessionId) => (method, params) => withTimeout(w.lease.sendCommand(method, params, sessionId), 4000);
  const setFiles = (p, files) => p.cmd('DOM.setFileInputFiles', { files, backendNodeId: p.backendNodeId });
  const sendCancel = p => p.cmd('Runtime.callFunctionOn', { objectId: p.objectId, functionDeclaration: 'function () { this.dispatchEvent(new Event("cancel", { bubbles: true })); }' }).catch(() => {});

  async function onChooser(w, params, sessionId) {
    if (api.pending) await dismiss('superseded', { cancelPage: true });
    const p = { w, sessionId, token: crypto.randomUUID(), backendNodeId: params.backendNodeId, mode: params.mode, cmd: null, objectId: null, multiple: params.mode === 'selectMultiple', accept: '', directory: false, paths: new Map(), settled: false };
    p.cmd = cmdOf(w, sessionId);
    api.pending = p;                                                     // from here a navigation, a closed tab or a newer request can end it
    const alive = () => api.pending === p && !w.dead && !w.wc.isDestroyed();
    try {
      if (api.browsing) throw Object.assign(new Error('busy'), { cancelOnly: true });
      // Where the frame sits in the top page: its <iframe> element's content box, found in the top page's own session (any frame that is not the page itself, in this
      // process or another). The main frame has no owner element: nothing to add.
      let frameOffset = null;
      if (params.frameId) {
        try {
          await w.lease.sendCommand('DOM.getDocument', { depth: 0 });
          const owner = await w.lease.sendCommand('DOM.getFrameOwner', { frameId: params.frameId });
          const quad = (await w.lease.sendCommand('DOM.getBoxModel', { backendNodeId: owner.backendNodeId })).model.content;
          frameOffset = { x: quad[0], y: quad[1] };
        } catch (error) { if (!/owner|belong|find|no frame/i.test(String(error.message))) note('frame-offset', error.message); }
      }
      const info = await anchorOf(p.cmd, w.wc, params.backendNodeId, w.lastDown, frameOffset);
      if (!alive()) return;
      Object.assign(p, { objectId: info.objectId, accept: info.accept, multiple: info.multiple || p.multiple, directory: info.directory });
      // The feature is off for this kind of window (only a test profile still intercepts), or the page wants a folder: the system window, as before.
      if (!enabledFor(w) || info.directory) return void (await browse(p));
      const { items, paths, later } = await gather({ accept: info.accept, privateWindow: isPrivate(w), profileId: w.ctx.profileId?.() });
      if (!alive()) return;
      p.paths = paths;
      if (!items.length) return void (await browse(p));                   // only "Browse all files…" would remain: skip the pop-up
      // The pictures on its first frame are waited for (all at once, at most LIMITS.firstFrameMs), so the pop-up opens with them in place; the others follow one by one.
      const early = await firstFrame(later);
      if (!alive()) return;
      const box = w.ctx.box(), at = info.at || { x: box.width / 2 - 60, y: box.height / 3, width: 120, height: 32 };
      p.offered = true;
      emit({
        type: 'ui', action: 'easy-files', targetTabId: w.ctx.tabId,
        anchor: { x: Math.round(box.x + at.x), y: Math.round(box.y + at.y), width: Math.max(2, Math.round(at.width)), height: Math.max(2, Math.round(at.height)) },
        easyFiles: { token: p.token, items, multiple: p.multiple, how: info.how || 'page', ...(Object.keys(early).length ? { thumbs: early } : {}) },
      });
      note('offered', items.length, info.how || 'page', Object.keys(early).length + ' pictures ready');
      p.timer = setTimeout(() => { void dismiss('timeout', { cancelPage: true }); }, LIMITS.offerMs); p.timer.unref?.();
      thumbnails(p, later, early);
    } catch (error) {
      if (api.pending === p) { note('chooser-failed', error.message); if (error.cancelOnly) await dismiss('busy', { cancelPage: true }); else await browse(p).catch(() => dismiss('failed', { cancelPage: true })); }
    }
  }

  /** The pictures that show on the pop-up's first frame, made side by side and waited for (never longer than LIMITS.firstFrameMs): {id: dataURL} of the ones ready by then.
   *  A job that is not ready keeps running and is sent afterwards like the rest. */
  async function firstFrame(later) {
    const ready = {}; let cut;
    const runs = later.filter(job => job.first).map(job => { job.run = Promise.resolve().then(job.make).then(src => src || null, () => null); return job.run.then(src => { if (src) ready[job.id] = src; }); });
    if (!runs.length) return ready;
    await Promise.race([Promise.all(runs), new Promise(resolve => { cut = setTimeout(resolve, LIMITS.firstFrameMs); cut.unref?.(); })]);
    clearTimeout(cut);
    return { ...ready };                                                   // a copy: what arrives after this moment is sent as its own message
  }

  /** What was not ready for the first frame follows the offer one by one (a tile fills in as its picture arrives). */
  function thumbnails(p, later, early = {}) {
    (async () => {
      for (const job of later) {
        if (api.pending !== p) return;
        if (early[job.id]) continue;
        let src = null; try { src = await (job.run || job.make()); } catch { src = null; }
        if (api.pending !== p) return;
        if (src) emit({ type: 'easy-files-thumb', token: p.token, id: job.id, src });
      }
    })().catch(error => note('thumbs-failed', error.message));
  }

  /** End the pending request without a pick. `cancelPage`: the page's input still hears 'cancel' (it does not when the page is gone or has moved on). */
  async function dismiss(reason, { cancelPage = false } = {}) {
    const p = api.pending; if (!p) return false;
    api.pending = null; clearTimeout(p.timer);
    if (p.offered) emit({ type: 'easy-files-close', token: p.token, reason });
    if (cancelPage && p.objectId && !p.w.dead && p.w.lease && !p.w.lease.over) await sendCancel(p);
    note('dismissed', reason);
    return true;
  }

  async function browse(p) {
    if (api.pending === p) api.pending = null;
    clearTimeout(p.timer);
    if (p.offered) emit({ type: 'easy-files-close', token: p.token, reason: 'browse' });
    api.browsing = true;
    try {
      // In a test profile the real system window is refused unless the rig says it has put its own stand-in in place (ACIRA_EASY_FILES_DIALOG_OK=1).
      if (testSeam() && env.ACIRA_EASY_FILES_DIALOG_OK !== '1') { await sendCancel(p); note('test-seam: the system window was not opened'); return { ok: true, cancelled: true }; }
      const properties = p.directory ? ['openDirectory'] : ['openFile', ...(p.multiple ? ['multiSelections'] : [])];
      const parent = window();
      const chosen = await (parent ? dialog.showOpenDialog(parent, { properties, filters: dialogFilters(p.accept) }) : dialog.showOpenDialog({ properties, filters: dialogFilters(p.accept) }));
      if (p.w.dead || !p.w.lease || p.w.lease.over) return { ok: true };
      if (!chosen || chosen.canceled || !chosen.filePaths?.length) { await sendCancel(p); note('browse-cancel'); return { ok: true, cancelled: true }; }
      await setFiles(p, chosen.filePaths); note('browsed', chosen.filePaths.length);
      return { ok: true };
    } finally { api.browsing = false; }
  }

  /** A picture from the clipboard becomes a file only now, when it is picked (the page needs a file to read), in a temporary folder that is emptied after a day. */
  function pasteFile(image) {
    const png = image.toPNG();
    fs.mkdirSync(tempRoot, { recursive: true });
    const d = new Date(now()), two = n => String(n).padStart(2, '0');
    const file = path.join(tempRoot, `Pasted picture ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}.png`);
    fs.writeFileSync(file, png);
    return file;
  }
  function pruneTemp() {
    try {
      for (const name of fs.readdirSync(tempRoot)) { const file = path.join(tempRoot, name); try { if (now() - fs.statSync(file).mtimeMs > LIMITS.tempDays * 86400000) fs.unlinkSync(file); } catch { /* in use or gone */ } }
    } catch { /* no folder */ }
  }

  /** The interface's answer: {token, type:'pick', ids:[...]} | {type:'browse'} | {type:'cancel'}. A late answer from a pop-up that is no longer the pending one is refused. */
  async function answer(request) {
    const p = api.pending;
    if (!request || typeof request !== 'object' || typeof request.token !== 'string') return { ok: false, code: 'invalid' };
    if (!p || p.token !== request.token) return { ok: false, code: 'stale' };
    if (request.type === 'cancel') { await dismiss(typeof request.reason === 'string' ? request.reason.slice(0, 40) : 'cancel', { cancelPage: true }); return { ok: true, cancelled: true }; }
    if (request.type === 'browse') return browse(p);
    if (request.type !== 'pick') return { ok: false, code: 'invalid' };
    const ids = Array.isArray(request.ids) ? request.ids.filter(id => typeof id === 'string').slice(0, 100) : [];
    if (!ids.length || ids.some(id => !p.paths.has(id)) || (ids.length > 1 && !p.multiple)) { await dismiss('invalid', { cancelPage: true }); return { ok: false, code: 'invalid' }; }
    api.pending = null; clearTimeout(p.timer);
    try {
      pruneTemp();
      const files = ids.map(id => { const entry = p.paths.get(id); return entry.file || pasteFile(entry.clipboard); });
      for (const file of files) fs.accessSync(file, fs.constants.R_OK);
      if (p.w.dead || !p.w.lease || p.w.lease.over) return { ok: true };
      const t0 = now(); await setFiles(p, files); note('picked', ids.length, `${now() - t0}ms`);
      return { ok: true };
    } catch (error) {
      note('pick-failed', error.message);
      await sendCancel(p);                                               // the file is gone (or the page is): the page hears 'cancel' and can ask again
      return { ok: false, code: 'gone' };
    }
  }

  /** For the rig (a test profile): is this page connected, and which of its cross-process frames are intercepted yet? A test never clicks in a frame before it is. */
  const statusOf = wc => { const w = api.watchers.get(wc); return w ? { armed: w.armed, connected: Boolean(w.lease && !w.lease.over), frames: [...w.frames.entries()].map(([sessionId, frame]) => ({ sessionId, ...frame })) } : null; };
  pruneTemp(); readMacFolder();
  Object.assign(api, { statusOf, watch, refresh, answer, dismiss, enabledFor, LIMITS, connect, settle });
  return api;
}

module.exports = { createEasyFiles, accepts, dialogFilters, looksLikeScreenshot, screenshotFolders, LIMITS };
