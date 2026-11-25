'use strict';
// D46 (reported 18 Nov, circled on a real take: a white strip at the page's far edge while the sidebar closes). What a page's view shows where its page has not
// painted is the view's BACKING: Chromium fills it with the document's own background colour, which is the page's root colour when the root has one and the default
// white canvas when it has none. A page whose canvas is painted by a gradient and no colour (body { background: linear-gradient(...) }) therefore has a WHITE backing
// under a dark page, and every place the page has not reached yet shows it: the far strip of a page that is resized a frame at a time with the sidebar's glide
// (page-motion.cjs, the live sideways glide: 7 to 19 pt for up to ten frames in the real window, beside the sidebar when it is on the right).
//
// The rule (the team, 19 Nov): a page view's backing is never a colour the page is not.
//   - the canvas has an opaque colour (html's, or body's handed up to it): that colour. Chromium already shows it; saying it again costs nothing and holds through a
//     view that has no frame yet.
//   - the canvas is painted by gradients only, every stop opaque, tiled over the whole canvas: one of the gradient's own colours (the far end of a gradient that runs
//     sideways, where the strip stands; the middle of its two ends otherwise).
//   - anything else: NO backing of ours, the default stays. A page that declares no background relies on the white canvas, and the backing IS that canvas (Electron
//     gives a view's colour to the page as its base colour): colouring it would colour the page. A picture (url) may leave parts of the canvas bare, a see-through
//     colour mixes with the canvas, a colour I cannot read is not a colour I know: all of them keep the default.
// The New Tab pages keep their own backdrop (main.cjs newTabBackdrop): an entry that has one is left alone.
const WORLD = 2078;
/** Runs in the page's isolated world. Reads only: the computed background of the root and of the body. */
const READ = `(()=>{const f=e=>{if(!e)return null;const s=getComputedStyle(e);return{color:s.backgroundColor,image:s.backgroundImage,repeat:s.backgroundRepeat};};return{html:f(document.documentElement),body:f(document.body)};})()`;

/** A computed colour as [r, g, b, alpha], or null when it is not a plain rgb()/rgba() (another colour space, a keyword: not read, so not known). */
function parseColour(text) {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(String(text || '').trim());
  if (!m) return null;
  const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  const rgb = [m[1], m[2], m[3]].map(Number);
  if (rgb.some(v => !Number.isFinite(v) || v < 0 || v > 255) || !Number.isFinite(alpha)) return null;
  return [...rgb.map(Math.round), Math.max(0, Math.min(1, alpha))];
}
const hex = rgb => '#' + rgb.slice(0, 3).map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
/** A colour that shows: anything but fully transparent. A colour I cannot read counts as showing (its element is then the canvas's, and is refused below). */
const shows = text => { const colour = parseColour(text), raw = String(text || '').trim(); return colour ? colour[3] > 0 : raw !== '' && !/^transparent$/i.test(raw); };
const painted = style => !!style && ((typeof style.image === 'string' && style.image.trim() !== '' && style.image.trim() !== 'none') || shows(style.color));
/** The element whose background paints the canvas: the root when it has any background, else the body (CSS hands the body's background up to the canvas). */
const canvasStyle = facts => (painted(facts?.html) ? facts.html : painted(facts?.body) ? facts.body : null);
/** The top-level layers of a computed background-image ("linear-gradient(...), url(...)"), split at commas outside brackets. */
function layersOf(image) {
  const out = []; let depth = 0, from = 0;
  for (let i = 0; i < image.length; i++) { const c = image[i]; if (c === '(') depth++; else if (c === ')') depth--; else if (c === ',' && depth === 0) { out.push(image.slice(from, i).trim()); from = i + 1; } }
  out.push(image.slice(from).trim());
  return out.filter(Boolean);
}
/** One gradient layer's own colour for the far strip, or null when it is not a gradient whose every stop is an opaque rgb() I can read. */
function gradientColour(layer) {
  const m = /^(repeating-)?(linear|radial|conic)-gradient\((.*)\)$/is.exec(layer);
  if (!m) return null;
  const body = m[3], stops = [...body.matchAll(/rgba?\([^)]*\)/gi)].map(found => parseColour(found[0]));
  if (stops.length < 1 || stops.some(stop => !stop || stop[3] < 1)) return null;
  // nothing else in it may be a colour: what is left after the stops I read holds only angles, sides, shapes, lengths and percentages
  const rest = body.replace(/rgba?\([^)]*\)/gi, ' ').split(/[\s,/]+/).filter(Boolean);
  const plain = /^(?:-?[\d.]+(?:deg|grad|rad|turn|px|em|rem|vw|vh|vmin|vmax|%)?|to|at|from|top|bottom|left|right|center|circle|ellipse|closest-side|closest-corner|farthest-side|farthest-corner)$/i;
  if (rest.some(token => !plain.test(token))) return null;
  const first = stops[0], last = stops[stops.length - 1];
  if (m[2] === 'linear') {
    const head = body.slice(0, body.search(/rgba?\(/i)).toLowerCase();
    const angle = /(-?[\d.]+)deg/.exec(head);
    const turn = angle ? ((parseFloat(angle[1]) % 360) + 360) % 360 : null;
    if (/to\s+(?:\w+\s+)?right/.test(head) || (turn !== null && turn > 45 && turn < 135)) return last;      // it runs to the right: the far edge is its last colour
    if (/to\s+(?:\w+\s+)?left/.test(head) || (turn !== null && turn > 225 && turn < 315)) return first;    // it runs to the left: its first
  }
  return [0, 1, 2].map(i => (first[i] + last[i]) / 2);
}
/** The backing for a page with these facts ("#rrggbb"), or null: leave the default. Pure. */
function backingOf(facts) {
  const style = canvasStyle(facts);
  if (!style) return null;
  const colour = parseColour(style.color);
  if (colour && colour[3] >= 1) return hex(colour);
  if (!colour || colour[3] > 0) return null;   // a see-through colour mixes with the canvas; one I cannot read is not one I know
  const image = typeof style.image === 'string' ? style.image.trim() : '';
  if (!image || image === 'none') return null;
  const layers = layersOf(image), repeats = layersOf(String(style.repeat || 'repeat'));
  // every layer tiles over the whole canvas ("repeat"; one value stands for all layers when fewer are given)
  if (layers.some((_, i) => (repeats[i] ?? repeats[repeats.length - 1] ?? 'repeat').trim() !== 'repeat')) return null;
  // the top layer decides what is seen, and it must be an opaque gradient; the layers under it are covered by it
  const top = gradientColour(layers[0]);
  return top ? hex(top) : null;
}

/** `apply(entry, colour)` gives the view its backing ("#rrggbb"), `apply(entry, null)` the default back. `skip(entry)`: this entry's backing is somebody else's (a New Tab page). */
function createPageBacking({ apply, skip = () => false, timeoutMs = 1500 }) {
  const read = wc => new Promise(resolve => {
    let done = false; const end = value => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => end(undefined), timeoutMs);
    try { Promise.resolve(wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: READ }], false)).then(end, () => end(undefined)); } catch { end(undefined); }
  });
  const set = (entry, colour) => { if ((entry.backing ?? null) === colour) return; entry.backing = colour; try { apply(entry, colour); } catch { /* a view that is going away */ } };
  /** Reads the page's canvas and gives the view the backing it calls for. A read that a later one overtook, or that failed, changes nothing. */
  async function refresh(entry) {
    const wc = entry?.view?.webContents;
    if (!wc || wc.isDestroyed?.() || skip(entry)) return;
    const turn = entry.backingTurn = (entry.backingTurn || 0) + 1;
    const facts = await read(wc);
    if (facts === undefined || entry.backingTurn !== turn || wc.isDestroyed?.() || skip(entry)) return;
    set(entry, backingOf(facts));
  }
  /** A new document has committed: the colour of the one before is not this one's. The default comes back at once; the new page's own is read when it has a body. */
  function committed(entry) { entry.backingTurn = (entry.backingTurn || 0) + 1; if (!skip(entry)) set(entry, null); }
  /** Watches a page's own events. Returns nothing: the listeners go with the WebContents. */
  function attach(entry) {
    const wc = entry?.view?.webContents;
    if (!wc || typeof wc.on !== 'function') return;
    const go = () => { void refresh(entry); };
    // The colour is kept by the view and handed to the next frame the page makes (Electron applies a view's colour to every new render frame): it goes back to the default when a new document STARTS, so a page that
    // relies on the white canvas never has its first frame painted on the last page's colour; and again at the commit.
    wc.on('did-start-navigation', details => { if (details && details.isMainFrame && !details.isSameDocument) committed(entry); });
    wc.on('did-navigate', () => committed(entry));
    for (const name of ['dom-ready', 'did-finish-load', 'did-navigate-in-page', 'did-change-theme-color']) wc.on(name, go);
  }
  return { attach, refresh, committed };
}

module.exports = { createPageBacking, backingOf, parseColour, layersOf, gradientColour, READ, WORLD };
