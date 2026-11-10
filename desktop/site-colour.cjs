'use strict';
/**
 * The open site's colour, for the frame's glow (beta.13, item 19). Researcher A's pipeline, built for real.
 *
 * What it answers: "what colour would a person call this site's?" A brand colour: saturated, neither near-black nor near-white. Most big
 * sites paint white or black along their top edge, so the answer is often NOTHING, and then the frame shows no glow (it is absent, never
 * black). Sources, in this order, the first that holds a brand colour wins:
 *   1. <meta name=theme-color>, as Chromium resolved it (the `did-change-theme-color` event: media queries and alpha done)
 *   2. the page's own top edge: one thin capturePage of the top 24 DIP, when it is one flat colour
 *   3. the site's icon, from the icon store the sidebar already uses (nothing is fetched: a brand colour of the icon's colourful pixels)
 * A reading never repaints at once: `createHold` (math module) shows a new colour only when it is more than dE 3.5 from the shown one and
 * the same candidate was read twice over 220 ms. A navigation to another site skips the dwell, not the distance. Re-reads happen on the
 * triggers in researcher A's table (load + 250 ms, +1.5 s, +4 s; an in-page navigation +400 ms; a theme-color change; an icon change),
 * never on a timer and never while the tab is off screen. Nothing leaves the machine: pixels are reduced to one #rrggbb string here.
 *
 * Never sampled, never emitted: Off, a private, Tor or secured tab, a window in private or Tor mode. The colour is not saved
 * (core.persistedSnapshot drops it); a colour per site is remembered in memory for this run only, in normal windows only.
 */
const math = require('./site-color-math.cjs');

const STRIP_DIP = 24, FLAT_SHARE = .85, SEGMENT_AGREE = 6, TIMEOUT_MS = 3000, HOST_MEMORY = 200;
const rgbOf = hex => { const p = math.fromHex(hex); return p ? p.slice(0, 3) : null; };
/** A colour a person would call the site's colour (A: saturated, luminance between near-black and near-white). */
function isBrand(rgb) {
  if (!rgb || rgb.length < 3) return false;
  const lum = math.luminance(rgb);
  return math.saturation(rgb) >= .3 && lum > .02 && lum < .8;
}
const hostOf = url => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, '').toLowerCase() : null; } catch { return null; } };

/** The colour of one flat strip, or null: the strip's mode colour when at least 85% of it sits in one cell and its left, middle and right
 *  fifths agree (so a photo, a gradient or a half-and-half header gives nothing). `bitmap` is BGRA. */
function flatStrip(bitmap, width, height) {
  const rows = Math.max(1, Math.min(height, height)), region = (a, b) => math.summarise(bitmap, width, height, { x0: Math.round(width * a), y0: 0, x1: Math.round(width * b), y1: rows }, 2);
  const whole = region(0, 1); if (!whole || whole.share < FLAT_SHARE) return null;
  const parts = [region(0, .2), region(.4, .6), region(.8, 1)]; if (parts.some(p => !p)) return null;
  for (let i = 1; i < parts.length; i++) if (math.deltaE(math.fromHex(parts[0].hex), math.fromHex(parts[i].hex)) > SEGMENT_AGREE) return null;
  return { rgb: whole.rgb, hex: whole.hex, share: whole.share };
}

/** The brand colour of a stored icon (a data URL) via the bitmap the caller decoded: {rgb} or null. */
function iconBrand(bitmap, width, height) {
  const colours = math.iconColours(bitmap, width, height);
  return colours.brand && colours.brand.share >= .05 ? { rgb: math.fromHex(colours.brand.hex).slice(0, 3), hex: colours.brand.hex } : null;
}

/** How long after a page's first declared theme-color a following one is still part of the page settling (applied without the hold's dwell). */
const SETTLE_MS = 600;

function createSiteColour({
  now = () => Date.now(), schedule = setTimeout, cancel = clearTimeout,
  level = () => 'soft',            // 'off' | 'soft' | 'rich' (the setting)
  blocked = () => false,           // private, Tor, secured: no sampling, no colour
  visible = () => true,            // is this tab's page on screen right now
  stripOf = async () => null,      // (tabId) -> {bitmap,width,height} of the top 24 DIP, or null
  iconOf = async () => null,       // (tabId, urls) -> '#rrggbb' brand colour of the icon the page announced, or null (one cached fetch, never repeated)
  rememberHosts = true,
} = {}) {
  const tabs = new Map(), hostMemory = new Map();
  const remember = (host, hex) => { if (!rememberHosts || !host) return; hostMemory.delete(host); hostMemory.set(host, hex); if (hostMemory.size > HOST_MEMORY) hostMemory.delete(hostMemory.keys().next().value); };

  function attach(tabId, { emit, url = () => '' }) {
    const tab = { id: tabId, emit, url, host: null, theme: null, themeSeen: false, settleUntil: 0, hold: math.createHold(), shown: null, none: 0, timers: new Set(), generation: 0, force: false, disposed: false, icons: [], iconColour: undefined, sampledVisible: false };
    tabs.set(tabId, tab);
    const later = (ms, fn) => { const t = schedule(() => { tab.timers.delete(t); if (!tab.disposed) fn(); }, ms); t.unref?.(); tab.timers.add(t); return t; };
    const clear = () => { for (const t of tab.timers) cancel(t); tab.timers.clear(); };
    const publish = hex => { if (hex === tab.shown) return; tab.shown = hex; emit({ siteColor: hex }); };

    async function resolve() {
      if (tab.disposed) return;
      if (level() === 'off' || blocked(tabId)) { tab.none = 0; if (tab.shown) publish(null); return; }
      const token = ++tab.generation;
      let found = null;
      if (tab.theme && isBrand(tab.theme)) found = { rgb: tab.theme, from: 'theme-color' };
      if (!found && visible(tabId)) {
        const strip = await stripOf(tabId).catch(() => null);
        if (token !== tab.generation || tab.disposed) return;
        const flat = strip && flatStrip(strip.bitmap, strip.width, strip.height);
        if (flat && isBrand(flat.rgb)) found = { rgb: flat.rgb, from: 'edge' };
      }
      if (!found && tab.icons.length) {
        if (tab.iconColour === undefined) { tab.iconColour = null; const hex = await iconOf(tabId, tab.icons).catch(() => null); if (token !== tab.generation || tab.disposed) return; tab.iconColour = hex || null; }
        if (tab.iconColour) found = { rgb: rgbOf(tab.iconColour), from: 'icon' };
      }
      if (token !== tab.generation || tab.disposed) return;
      const force = tab.force; tab.force = false;
      if (found) {
        tab.none = 0;
        const result = tab.hold.push(found.rgb, now(), { force });
        // The hold's first colour shows at once; later ones only past dE 3.5 and a dwell. Fading back from nothing counts as a first.
        if (tab.shown === null && tab.hold.shown) { const hex = math.toHex(tab.hold.shown); publish(hex); remember(tab.host, hex); }
        else if (result.changed) { const hex = math.toHex(result.rgb); publish(hex); remember(tab.host, hex); }
        return;
      }
      // Nothing with a brand colour: the glow goes away, but only when it is not a one-off (twice, or right after a change of site).
      tab.none++;
      if (tab.shown && (force || tab.none >= 2)) { tab.hold = math.createHold(); publish(null); remember(tab.host, null); }
      else if (tab.shown) later(500, () => resolve());
    }

    const schedulePass = () => { clear(); later(250, () => resolve()); later(1500, () => resolve()); later(4000, () => resolve()); };
    return {
      /** A main-frame navigation committed: keep the last colour; another site resets the hold and gets the remembered colour at once. */
      navigated(newUrl) {
        tab.themeSeen = false; tab.settleUntil = 0; // a new page: its first declared colour is applied at once (themeColor below), the same site or not
        const host = hostOf(newUrl);
        if (host !== tab.host) {
          tab.host = host; tab.theme = null; tab.hold = math.createHold(); tab.force = true; tab.none = 0; tab.icons = []; tab.iconColour = undefined;
          if (host && hostMemory.has(host) && level() !== 'off' && !blocked(tabId)) { const hex = hostMemory.get(host); if (hex !== tab.shown) { tab.shown = hex; emit({ siteColor: hex }); if (hex) tab.hold.push(rgbOf(hex), now(), { force: true }); } }
        }
        clear();
      },
      loaded() { schedulePass(); },
      inPage() { clear(); later(400, () => resolve()); },
      /** A page's theme-color. The FIRST brand colour a page declares after a navigation is applied at once, with no debounce and no dwell (13.5: the glow used to start about 165 ms
       *  after the page knew its colour, and a same-site page that changed colour waited for the 1.5 s pass for its second read). Declared colours that follow within SETTLE_MS (a page
       *  that boots with a default and then sets its own) are applied after the short debounce, also without the dwell; after that a change is debounced and goes through the hold
       *  as before, so a page that animates its theme-color cannot flicker the glow. Anything that is not a brand colour (white, black, grey) keeps the old path. */
      themeColor(color) {
        tab.theme = color ? rgbOf(color) : null; clear();
        const declared = !!(tab.theme && isBrand(tab.theme)), first = !tab.themeSeen; tab.themeSeen = true;
        if (declared && first) { tab.settleUntil = now() + SETTLE_MS; tab.force = true; later(0, () => resolve()); return; }
        if (declared && now() < tab.settleUntil) { tab.force = true; later(120, () => resolve()); return; }
        later(120, () => resolve());
      },
      iconChanged(urls) { tab.icons = Array.isArray(urls) ? urls.filter(u => typeof u === 'string').slice(0, 4) : []; tab.iconColour = undefined; later(600, () => resolve()); },
      /** The tab came on screen (or the setting changed): read it once now. */
      shown() { clear(); later(300, () => resolve()); },
      /** Called whenever the tab is on screen (cheap): the first time it is seen with nothing read yet, read it. */
      visibleNow() { if (!tab.sampledVisible) { tab.sampledVisible = true; later(300, () => resolve()); } },
      recheck() { clear(); later(0, () => resolve()); },
      get current() { return tab.shown; },
      dispose() { tab.disposed = true; clear(); tabs.delete(tabId); },
    };
  }
  return { attach, get tabs() { return tabs; }, hostMemory, forgetMemory: () => hostMemory.clear() };
}

/** Electron glue: a thin capture of the top strip of a page, as BGRA. */
async function captureStrip(wc, { dip = STRIP_DIP, width: viewWidth = 1200 } = {}) {
  const width = Math.max(200, Math.round(viewWidth));
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), TIMEOUT_MS));
  const image = await Promise.race([wc.capturePage({ x: 0, y: 0, width, height: dip }, { stayHidden: true, stayAwake: false }).catch(() => null), timeout]);
  if (!image || image.isEmpty()) return null;
  const size = image.getSize(1), bitmap = image.toBitmap({ scaleFactor: 1 });
  return bitmap.length === size.width * size.height * 4 ? { bitmap, width: size.width, height: size.height } : null;
}
/** Electron glue: the brand colour of the icon a page announced (A: SVG by the colours the file names; ICO by its bitmap; PNG and the rest through
 *  nativeImage). Fetched through the TAB's own session, without cookies, answered from the HTTP cache when the page just loaded it; at most 400 KB, 4 s. */
async function iconColour(wc, urls, { nativeImage, iconImage }) {
  const withTimeout = (promise, ms) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(null), ms))]);
  for (const url of urls) {
    if (!/^https?:\/\//i.test(url)) continue;
    try {
      const response = await withTimeout(wc.session.fetch(url, { credentials: 'omit', cache: 'force-cache' }), 4000);
      if (!response || !response.ok) continue;
      const bytes = Buffer.from(await response.arrayBuffer()).subarray(0, 400000), kind = iconImage.sniff(bytes);
      if (kind === 'svg') {
        const list = math.svgColours(bytes.toString('utf8')), brand = list.find(item => isBrand(math.fromHex(item.hex).slice(0, 3)));
        if (brand) return brand.hex; continue;
      }
      let size = null, bitmap = null;
      if (kind === 'ico') {
        const pictures = iconImage.icoPictures(bytes), best = pictures && iconImage.icoPreference(pictures, 64)[0];
        if (!best) continue;
        if (best.png) { const image = nativeImage.createFromBuffer(Buffer.from(bytes.subarray(best.offset, best.offset + best.size))); if (!image.isEmpty()) { size = image.getSize(1); bitmap = image.toBitmap({ scaleFactor: 1 }); } }
        else { const dib = math.decodeIcoBitmap(bytes, best.offset); if (dib) { size = { width: dib.width, height: dib.height }; bitmap = dib.bgra; } }
      } else { const image = nativeImage.createFromBuffer(bytes); if (!image.isEmpty()) { size = image.getSize(1); bitmap = image.toBitmap({ scaleFactor: 1 }); } }
      if (!bitmap || bitmap.length !== size.width * size.height * 4) continue;
      const brand = iconBrand(bitmap, size.width, size.height);
      if (brand) return brand.hex; return null;
    } catch { /* an icon that does not load gives nothing */ }
  }
  return null;
}
/** Kept for tests: a stored icon (data URL) as BGRA. */
function decodeIcon(nativeImage, dataUrl) {
  if (!dataUrl) return null;
  try { const image = nativeImage.createFromDataURL(dataUrl); if (image.isEmpty()) return null; const size = image.getSize(1), bitmap = image.toBitmap({ scaleFactor: 1 }); return bitmap.length === size.width * size.height * 4 ? { bitmap, width: size.width, height: size.height } : null; } catch { return null; }
}

module.exports = { createSiteColour, isBrand, flatStrip, iconBrand, hostOf, captureStrip, decodeIcon, iconColour };
