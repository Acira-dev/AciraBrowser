'use strict';
/**
 * Beta 14, the Electron side of "Search for this image" (the policy and the services are desktop/image-search.cjs; this wires them to the page menu and to the tab):
 *  - the row, through the page menu's registration hook (context-commands.cjs registerPageMenu): on images, linked images, an image's own tab (slot 'image') and on a paused video's
 *    current frame (slot 'media'); never on a CSS background, which has no image menu;
 *  - the first-use chooser, drawn by the page menu's own popup (rows with a second line);
 *  - reading the picture (a still frame, downscaled), the confirm, the POST on the tab's own session, and the result in a new foreground tab of the same kind.
 * One window attaches at a time per main process closure; the registry is process-wide, so each attachment answers for the pages of its own window only.
 */
const { registerPageMenu, menuData } = require('./browser-services/context-commands.cjs');
const { t: tr } = require('./browser-services/tx.cjs');
const search = require('./image-search.cjs');

const attached = new Set();
let registered = false;

const dataURLBytes = text => { const match = /^data:[^,]*?(;base64)?,(.*)$/s.exec(text); return match ? (match[1] ? Buffer.from(match[2], 'base64') : Buffer.from(decodeURIComponent(match[2]), 'binary')) : null; };

/** The picture of this click as bytes (at most a few MB): its address read with the tab's own cookies and route, a data: picture decoded, a blob: read by the page; whatever cannot be decoded (SVG)
 *  or a video's current frame is captured as it is shown. Then downscaled to what services accept, as one still JPEG (an animated picture sends its first frame). */
async function readPicture(deps, ctx, image) {
  const { wc, frame, params } = ctx, { nativeImage } = deps;
  const captured = async () => {
    const rect = await (frame || wc.mainFrame).executeJavaScript(`(() => { const e = document.elementFromPoint(${Number(params.x) || 0}, ${Number(params.y) || 0}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), width: Math.round(r.width), height: Math.round(r.height) }; })()`, true);
    if (!rect || rect.width < 2 || rect.height < 2) return null;
    return wc.capturePage(rect);
  };
  let picture = null;
  if (!image.frame) {
    let bytes = null;
    try {
      if (image.inline?.startsWith('data:')) bytes = dataURLBytes(image.inline);
      else if (image.src) { const response = await wc.session.fetch(image.src, { credentials: 'include', redirect: 'follow' }); if (response.ok) { const buffer = Buffer.from(await response.arrayBuffer()); if (buffer.length <= 25 * 1024 * 1024) bytes = buffer; } }
      else if (image.inline?.startsWith('blob:')) {
        const text = await (frame || wc.mainFrame).executeJavaScript(`fetch(${JSON.stringify(image.inline)}).then(r => r.ok ? r.blob() : null).then(b => !b || b.size > 25e6 ? null : new Promise(done => { const f = new FileReader(); f.onload = () => done(f.result); f.readAsDataURL(b); }))`, true);
        if (typeof text === 'string') bytes = dataURLBytes(text);
      }
    } catch { /* tried the way below */ }
    if (bytes?.length) { const decoded = nativeImage.createFromBuffer(bytes); if (!decoded.isEmpty()) picture = decoded; }
  }
  if (!picture) { const shot = await captured(); if (shot && !shot.isEmpty()) picture = shot; }
  if (!picture) return null;
  const { width, height } = picture.getSize(), longest = Math.max(width, height);
  const scaled = longest > search.MAX_EDGE ? picture.resize(width >= height ? { width: search.MAX_EDGE, quality: 'best' } : { height: search.MAX_EDGE, quality: 'best' }) : picture;
  let jpeg = scaled.toJPEG(88);
  for (let quality = 75; jpeg.length > search.MAX_BYTES && quality >= 35; quality -= 20) jpeg = scaled.toJPEG(quality);
  return jpeg.length <= search.MAX_BYTES ? { bytes: jpeg, type: 'image/jpeg' } : null;
}

/** Does the picture's address answer anyone, with no cookies, as a service fetching it would be answered? One small anonymous request by the tab's own route (the byte range 0-0), to the picture's own host,
 *  after the click: a picture behind a login answers 401, 403 or a login page and so goes by upload instead. */
async function reachableWithoutCookies(session, src) {
  try {
    const response = await session.fetch(src, { credentials: 'omit', redirect: 'follow', headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(4000) });
    const ok = (response.status === 200 || response.status === 206) && /^image\//i.test(response.headers.get('content-type') || '');
    try { await response.body?.cancel(); } catch { /* already read */ }
    return ok;
  } catch { return false; }
}

function describe(ctx) {
  const { params } = ctx, address = (() => { try { const url = new URL(params.srcURL); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } })();
  const inline = !address && typeof params.srcURL === 'string' && /^(?:data:image\/|blob:)/i.test(params.srcURL) ? params.srcURL : null;
  // A vector picture (an .svg address or data:image/svg+xml) is no picture a service can search by address: the frame as shown is uploaded instead.
  const vector = /\.svg(?:$|[?#])/i.test(address || '') || /^data:image\/svg\+xml/i.test(inline || '');
  if (vector) return { src: null, inline: null, frame: true };
  return { src: address, inline, frame: params.mediaType === 'video' || params.mediaType === 'canvas' || (!address && !inline) };
}

function forWindow(wc) { for (const deps of attached) { if (!deps.alive()) { attached.delete(deps); continue; } if (deps.owns(wc)) return deps; } return null; }

function ensureRegistered() {
  if (registered) return;
  registered = true;
  for (const slot of ['image', 'media']) {
    registerPageMenu({
      id: 'image-search-' + slot, slot,
      rows(ctx) {
        const { params } = ctx;
        if (slot === 'image' && params.mediaType !== 'image' && params.mediaType !== 'canvas') return;
        if (slot === 'media' && !(params.mediaType === 'video' && params.mediaFlags?.isPaused)) return;
        const deps = forWindow(ctx.wc);
        if (!deps) return;
        const label = search.menuLabel(deps.getSettings(), tr);
        return [ctx.item('image-search', label, () => deps.start(ctx), true)];
      },
    });
  }
}

/** Called once per window by main.cjs. `deps`: getSettings, saveSettings(patch), dispatch, promptDialog, getWindow, nativeImage, net, userAgent(session), showMenu(menu, anchor, tabId), pageBox(tabId), uiScale(), alive(), owns(wc). */
function attach(deps) {
  ensureRegistered();
  const flow = search.createImageSearch({
    getSettings: deps.getSettings, saveSettings: deps.saveSettings,
    choose: ctx => new Promise(resolve => {
      const done = value => { clearTimeout(timer); resolve(value); };
      const timer = setTimeout(() => done(null), 120000); timer.unref?.();
      const row = (id, name, detail) => ({ id: 'is-' + id, label: name, detail, click: () => done(id) });
      const template = [
        ...search.SERVICES.map(service => row(service.id, service.name, tr('imagesearch.about.' + service.id))),
        { type: 'separator' }, row('other', tr('imagesearch.other'), tr('imagesearch.otherAbout')),
        { type: 'separator' }, { id: 'is-note', label: tr('imagesearch.chooserNote'), header: true },
      ];
      const box = deps.pageBox(ctx.tabId) || { x: 0, y: 0 };
      // the previous menu is closing: the chooser opens a moment after it, at the same place
      setTimeout(() => deps.showMenu(menuData(template), { x: Math.round(box.x + (Number(ctx.params.x) || 0)), y: Math.round(box.y + (Number(ctx.params.y) || 0)), width: 1, height: 1 }, ctx.tabId, () => done(null)), 80);
    }),
    confirm: async ({ message, checkboxLabel }) => {
      const result = await deps.promptDialog.showMessageBox(deps.getWindow(), { type: 'question', message, buttons: [tr('main.cancel'), tr('imagesearch.send')], defaultId: 1, cancelId: 0, ...(checkboxLabel ? { checkboxLabel, checkboxChecked: false } : {}) });
      return { ok: result.response === 1, dontAsk: Boolean(result.checkboxChecked) };
    },
    reachable: (ctx, src) => reachableWithoutCookies(ctx.wc.session, src),
    readImage: (ctx, image) => readPicture(deps, ctx, image),
    post: (ctx, url, request) => deps.post(ctx.wc.session, url, request),
    openResult: (ctx, url) => deps.dispatch({ type: 'tab.new', url, background: false, browserProfileId: ctx.profileId, afterId: ctx.tabId, ...(ctx.owner.privateTab ? { privacy: ctx.owner.tor ? 'tor' : 'private' } : {}) }),
    openSettings: () => deps.dispatch({ type: 'tab.new', url: 'acira://settings' }),
    notify: text => deps.dispatch({ type: 'toast', text, tone: 'error' }),
    tr,
  });
  const entry = {
    alive: deps.alive, owns: deps.owns, getSettings: deps.getSettings,
    start: ctx => flow.run({ privateOrTor: Boolean(ctx.owner.private || ctx.owner.tor), tabId: ctx.tabId, profileId: ctx.profileId, owner: ctx.owner, wc: ctx.wc, frame: ctx.frame, params: ctx.params, image: describe(ctx) }),
  };
  attached.add(entry);
  return () => attached.delete(entry);
}

module.exports = { attach, readPicture, describe, dataURLBytes, reachableWithoutCookies };
