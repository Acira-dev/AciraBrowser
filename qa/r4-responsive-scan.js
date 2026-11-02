// R4-39 responsive geometry scanner. Evaluate in the chrome UI page or the overlay (popup) page, then call
//   window.__resp.scan({ zoom, origin:[x,y], pageViews:[[x,y,w,h]...], captionCss, captionH, surface })
// All rectangles are CSS px of the page being scanned; native view rectangles come in as DIPs (css * zoom).
// Categories (sev = error | warn):
//   overlap     two interactive controls whose visible boxes intersect (neither contains the other)           error
//   covered     the centre of a control hits some other element (something sits on top of it)                  warn
//   offscreen   a control's visible box leaves the viewport (and no scroller owns the overflow)                error
//   cut         a control is partly clipped by a non-scrolling overflow ancestor                               warn
//   caption     a control sits under the Windows caption buttons (top-right corner)                            error
//   toolbar     toolbar fit: menu button beyond the usable edge, address bar < 100px, leading/actions overlap  error
//   scrollbar   a visible horizontal scrollbar, a document-level scrollbar, or a vertical one on chrome frame error / warn
//   ellipsis    a control label (button, menu row, heading) truncated with an ellipsis                         warn
//   underPage   a chrome control whose box intersects a native website view (the page would cover it)          error / warn
(() => {
  const CONTROL = 'button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=menuitem],[role=switch],[role=checkbox],[role=radio],[role=option],[role=link],[role=slider],[tabindex]:not([tabindex="-1"])';
  const GRIP = /resize|separator|splitter|grip/i;
  // The sidebar's hover "+" (new tab in group) overlays its own group header. That is the design only while the group name stops before the button.
  const addOverOwnHeader = (add, header) => !!(add.matches && add.matches('.sb-header-add') && header.matches && header.matches('.sb-group-header') && add.parentElement === header.parentElement && (() => { const name = header.querySelector('.sb-group-name'); return !name || name.getBoundingClientRect().right <= add.getBoundingClientRect().left + 0.5; })());
  const r1 = n => Math.round(n * 10) / 10;
  const box = r => [r1(r.left), r1(r.top), r1(r.width), r1(r.height)];
  const sel = e => { const p = []; for (let q = e, n = 0; q && n < 3 && q !== document.body && q !== document.documentElement; q = q.parentElement, n++) { let s = q.tagName.toLowerCase(); const c = typeof q.className === 'string' ? q.className.trim().split(/\s+/).filter(x => x && !/^(is-|has-|css-|sc-)/.test(x))[0] : ''; if (c) s += '.' + c; if (n === 0) { const lab = q.getAttribute('aria-label') || q.getAttribute('data-toolbar-item') || ''; if (lab) s += '[' + String(lab).replace(/\s+/g, ' ').slice(0, 28) + ']'; } p.push(s); } return p.reverse().join(' > '); };
  const live = e => { if (!e.isConnected || e.closest('[inert],[aria-hidden="true"],[hidden],[data-motion-ghost],.popup-vapor')) return false; try { return e.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true }); } catch { return e.getClientRects().length > 0; } };
  /** The part of `r` that survives every overflow-clipping ancestor (absolute children skip ancestors that are not their containing block). */
  const visibleRect = (e, r) => {
    let l = r.left, t = r.top, rt = r.right, b = r.bottom, by = null, skipping = getComputedStyle(e).position === 'absolute';
    if (getComputedStyle(e).position === 'fixed') return { l, t, r: rt, b, by };
    for (let q = e.parentElement; q && q !== document.documentElement; q = q.parentElement) {
      const c = getComputedStyle(q);
      if (skipping) { if (c.position === 'static' && c.transform === 'none') continue; skipping = c.position === 'absolute'; }
      if (c.position === 'fixed' && !skipping) { /* fixed ancestors still clip their own descendants */ }
      const ox = c.overflowX !== 'visible', oy = c.overflowY !== 'visible'; if (!ox && !oy) continue;
      const q2 = q.getBoundingClientRect();
      if (ox) { if (q2.left > l) { l = q2.left; by = q; } if (q2.right < rt) { rt = q2.right; by = q; } }
      if (oy) { if (q2.top > t) { t = q2.top; by = q; } if (q2.bottom < b) { b = q2.bottom; by = q; } }
    }
    return { l, t, r: rt, b, by };
  };
  const area = v => Math.max(0, v.r - v.l) * Math.max(0, v.b - v.t);
  const scrolls = q => q && (q.scrollHeight > q.clientHeight + 1 || q.scrollWidth > q.clientWidth + 1);

  const scan = (opts = {}) => {
    const vw = innerWidth, vh = innerHeight, zoom = opts.zoom || 1, out = [], counts = {};
    const add = (cat, sev, sig, text, extra) => { counts[cat] = (counts[cat] || 0) + 1; if (counts[cat] <= 14) out.push({ cat, sev, sig: cat + ':' + sig, text, ...extra }); };
    const ctl = [];
    for (const e of document.querySelectorAll(CONTROL)) {
      if (!live(e)) continue; const cs = getComputedStyle(e); if (cs.pointerEvents === 'none') continue;
      const r = e.getBoundingClientRect(); if (r.width < 3 || r.height < 3) continue;
      const v = visibleRect(e, r); ctl.push({ e, r, v, s: sel(e) });
    }
    // overlap + off-screen + cut + covered + caption + under-page
    const capW = opts.captionCss || 0, capH = opts.captionH || 0;
    for (let i = 0; i < ctl.length; i++) {
      const a = ctl[i], full = a.r.width * a.r.height, va = area(a.v);
      if (va < 4) continue; // clipped away entirely (scrolled out, folded, collapsed)
      if (a.v.l < -0.5 || a.v.t < -0.5 || a.v.r > vw + 0.5 || a.v.b > vh + 0.5) {
        const owner = a.v.by; if (!(owner && scrolls(owner) && a.v.by.getBoundingClientRect().right <= vw + 0.5 && a.v.by.getBoundingClientRect().bottom <= vh + 0.5)) add('offscreen', 'error', a.s, `${a.s} leaves the ${vw}x${vh} viewport`, { box: box(a.r) });
      } else if (va < full * 0.9 && a.v.by && !scrolls(a.v.by)) add('cut', 'warn', a.s + ' by ' + sel(a.v.by), `${a.s} is cut ${Math.round((1 - va / full) * 100)}% by ${sel(a.v.by)}`, { box: box(a.r) });
      if (capW && capH && !a.e.closest('.compact-caption-space,[data-drag-region]')) { const iw = Math.min(a.v.r, vw) - Math.max(a.v.l, vw - capW), ih = Math.min(a.v.b, capH) - Math.max(a.v.t, 0); if (iw > 2 && ih > 2) add('caption', 'error', a.s, `${a.s} sits under the caption buttons (${r1(iw)}x${r1(ih)} overlap)`, { box: box(a.r) }); }
      // centre hit test
      const cx = (a.v.l + a.v.r) / 2, cy = (a.v.t + a.v.b) / 2;
      if (cx > 0 && cy > 0 && cx < vw && cy < vh && va >= full * 0.5) {
        const hit = document.elementFromPoint(cx, cy);
        if (hit && hit !== a.e && !a.e.contains(hit) && !hit.contains(a.e) && !GRIP.test(sel(hit))) { const lab = hit.closest('label'); if (!(lab && lab.control === a.e)) add('covered', 'warn', a.s + ' by ' + sel(hit), `${a.s} is covered at its centre by ${sel(hit)}`, { box: box(a.r) }); }
      }
      if (opts.pageViews && opts.pageViews.length) {
        const ox = (opts.origin || [0, 0])[0], oy = (opts.origin || [0, 0])[1];
        for (const pv of opts.pageViews) {
          const iw = Math.min(a.v.r * zoom + ox, pv[0] + pv[2]) - Math.max(a.v.l * zoom + ox, pv[0]), ih = Math.min(a.v.b * zoom + oy, pv[1] + pv[3]) - Math.max(a.v.t * zoom + oy, pv[1]);
          if (iw > 2 && ih > 2) { const inPane = !!a.e.closest('.page-area,.page-pane,.split-label,[class*=split]'); add('underPage', inPane ? 'warn' : 'error', a.s, `${a.s} intersects a native page view by ${r1(iw)}x${r1(ih)} DIP`, { box: box(a.r), page: pv.map(Math.round) }); break; }
        }
      }
      for (let j = i + 1; j < ctl.length; j++) {
        const b = ctl[j]; if (area(b.v) < 4 || a.e.contains(b.e) || b.e.contains(a.e) || GRIP.test(a.s) || GRIP.test(b.s)) continue; // drag grips straddle the edge they resize on purpose
        if (addOverOwnHeader(a.e, b.e) || addOverOwnHeader(b.e, a.e)) continue; // the hover "+" sits over its own group header on purpose; the name is laid out to stop where it starts
        const iw = Math.min(a.v.r, b.v.r) - Math.max(a.v.l, b.v.l), ih = Math.min(a.v.b, b.v.b) - Math.max(a.v.t, b.v.t);
        if (iw > 1.5 && ih > 1.5) add('overlap', 'error', [a.s, b.s].sort().join(' | '), `${a.s} overlaps ${b.s} by ${r1(iw)}x${r1(ih)}`, { a: box(a.r), b: box(b.r) });
      }
    }
    // toolbar fit (ported from the R3 toolbar-fit sweep)
    const liveOne = s => [...document.querySelectorAll(s)].find(live), bx = n => n ? n.getBoundingClientRect() : null;
    const tb = document.querySelector('.acira-persistent-toolbar');
    if (tb && live(tb)) {
      const cap = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--caption-width')) || 0) / zoom;
      const tr = tb.getBoundingClientRect(), capOver = tr.top < 20, limit = capOver ? vw - cap : vw - 12;
      const menu = bx(liveOne('.toolbar-menu-control')), addr = bx(liveOne('.address-bar')), lead = bx(liveOne('.acira-leading-controls')), acts = bx(liveOne('.toolbar-actions'));
      let right = 0, rightName = ''; for (const n of tb.querySelectorAll('button,input,a,form,.toolbar-private-chip')) { if (!live(n)) continue; const r = n.getBoundingClientRect(); if (r.width && r.right > right) { right = r.right; rightName = sel(n); } }
      if (menu && menu.right > limit + 1) add('toolbar', 'error', 'menu-beyond-edge', `menu button ends at ${r1(menu.right)} beyond ${r1(limit)}`, {});
      if (right > limit + 1) add('toolbar', 'error', 'control-beyond-edge', `${rightName} ends at ${r1(right)} beyond ${r1(limit)}`, {});
      if (addr && addr.width < 100) add('toolbar', 'error', 'address-narrow', `address bar only ${r1(addr.width)}px wide`, {});
      if (lead && addr && lead.right - addr.left > 0.6) add('toolbar', 'error', 'leading-address-overlap', `leading controls overlap the address bar by ${r1(lead.right - addr.left)}px`, {});
      if (addr && acts && addr.right - acts.left > 0.6) add('toolbar', 'error', 'address-actions-overlap', `address bar overlaps the toolbar actions by ${r1(addr.right - acts.left)}px`, {});
      if (!menu && !document.querySelector('.browser-shell[data-layout=focus]')) add('toolbar', 'warn', 'menu-missing', 'no live Acira menu button in the toolbar', {});
    }
    // scrollbars: a classic scrollbar takes layout space (offset - client - borders)
    const de = document.documentElement;
    if (!opts.skipDocScroll && de.scrollWidth > vw + 1) add('scrollbar', 'error', 'document-x', `the document scrolls sideways (${de.scrollWidth} > ${vw})`, {});
    if (!opts.skipDocScroll && de.scrollHeight > vh + 1 && getComputedStyle(de).overflowY !== 'hidden' && getComputedStyle(document.body).overflowY !== 'hidden') add('scrollbar', 'error', 'document-y', `the document scrolls vertically (${de.scrollHeight} > ${vh})`, {});
    const EXPECT_V = /settings|history|library|downloads|bookmarks|sidebar|sb-|popup|menu|sheet|workspace|newtab|new-tab|list|panel|rewind|routines|palette|tab-switcher|switcher|scroll|content|step|fr-|onboarding|gallery/i;
    const seenSb = new Set();
    for (const e of document.querySelectorAll('*')) {
      const c = getComputedStyle(e); if (!/auto|scroll/.test(c.overflowX + c.overflowY)) continue; if (!live(e)) continue;
      const hs = e.offsetHeight - e.clientHeight - (parseFloat(c.borderTopWidth) || 0) - (parseFloat(c.borderBottomWidth) || 0), vs = e.offsetWidth - e.clientWidth - (parseFloat(c.borderLeftWidth) || 0) - (parseFloat(c.borderRightWidth) || 0);
      if (hs > 2 && /auto|scroll/.test(c.overflowX)) { const s = sel(e); if (!seenSb.has('h' + s)) { seenSb.add('h' + s); add('scrollbar', 'error', 'x ' + s, `horizontal scrollbar (${r1(hs)}px) on ${s}`, { box: box(e.getBoundingClientRect()) }); } }
      if (vs > 2 && /auto|scroll/.test(c.overflowY)) { const s = sel(e); if (!seenSb.has('v' + s)) { seenSb.add('v' + s); add('scrollbar', EXPECT_V.test(s + ' ' + String(e.className)) ? 'info' : 'warn', 'y ' + s, `vertical scrollbar (${r1(vs)}px) on ${s}`, { box: box(e.getBoundingClientRect()) }); } }
    }
    // control labels truncated with an ellipsis
    const DELIB = '.browser-tab,[class*=tab-title],[class*=bookmark],.address-bar,[class*=sb-tab],[class*=sb-app],[class*=compact-tab],[data-tab-id],[class*=history],[class*=download],[class*=suggest],[class*=url],[class*=select-trigger],[class*=select-value]';
    for (const e of document.querySelectorAll('button *,[role=menuitem] *,[role=option] *,label *,summary *,h1,h2,h3,button,[role=menuitem],label,summary')) {
      const c = getComputedStyle(e); if (!(c.textOverflow === 'ellipsis' || c.webkitLineClamp !== 'none')) continue;
      if (!(e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1) || !live(e) || e.closest(DELIB)) continue;
      add('ellipsis', 'warn', sel(e), `"${(e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 36)}" is truncated in ${sel(e)} (${e.scrollWidth}>${e.clientWidth})`, { box: box(e.getBoundingClientRect()) });
    }
    return { vw, vh, scrollW: de.scrollWidth, scrollH: de.scrollHeight, controls: ctl.length, counts, findings: out };
  };
  window.__resp = { scan, sel, live };
  return 'responsive scanner ready';
})()
