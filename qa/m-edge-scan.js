// Stream M edge-gap scanner. Defines window.__edge in the current page (chrome UI or overlay popups). Evaluate this file first, then:
//   __edge.static()          -> findings for everything painted at rest (rows, pills, chips, selected/current rows, panels)
//   __edge.candidates()      -> interactive elements worth hovering (rows, buttons, tabs, options)
//   __edge.el(element)       -> findings for one element's text/icons against the nearest painted box (call after hovering it)
// A finding = text line or icon whose gap to the painted box behind it is too small. Painted box = nearest ancestor (or self) with a
// visible background, border, shadow rim or outline. Text lines come from Range rects (wrapping counts); ellipsis text is clamped to
// its clipping container. Thresholds (CSS px): horizontal < 8 (< 6 for pills/chips/kbd/badges), vertical < 2, and any touch/cross.
// Driver endpoint: POST /edgescan?page=ui|overlay&hover=1&cap=120  (qa/m-driver.mjs) drives real mouse hover over each candidate.
(() => {
  const visible = e => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; if (r.bottom < 0 || r.top > innerHeight + 1 || r.right < 0 || r.left > innerWidth + 1) return false; { const d = e.closest('details'); if (d && !d.open && !e.closest('summary')) return false; } { const pop = e.closest('.browser-popup'); if (pop) { const pr = pop.getBoundingClientRect(); if (r.top > pr.bottom || r.bottom < pr.top) return false; } } for (let q = e, n = 0; q && n < 10; q = q.parentElement, n++) { const c = getComputedStyle(q); if (c.display === 'none' || c.visibility === 'hidden' || c.opacity === '0') return false; } return true; };
  const alpha = c => { const m = c.match(/rgba?\(([^)]+)\)|color\(srgb ([^)]+)\)/); if (!m) return 0; const p = (m[1] || m[2]).split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; };
  const parentBg = e => { for (let q = e.parentElement; q; q = q.parentElement) { const b = getComputedStyle(q).backgroundColor; if (alpha(b) > 0.03) return b; } return ''; };
  const painted = e => {
    const c = getComputedStyle(e); if (alpha(c.backgroundColor) > 0.03 && c.backgroundColor === parentBg(e) && c.backgroundImage === 'none') return null; // same colour as what is behind it: invisible box (sticky header fills)
    if (alpha(c.backgroundColor) > 0.03 || (c.backgroundImage !== 'none' && !/(^|\s)[0-3](\.\d+)?px(\s|,|$)/.test(c.backgroundSize.split(',')[0].split(' ').slice(1).join(' ') || ''))) return 'bg'; // gradient hairlines (background-size: 100% 1px) are dividers, not boxes
    if (['Left', 'Right'].every(s => parseFloat(c['border' + s + 'Width']) > 0 && alpha(c['border' + s + 'Color']) > 0.05 && c['border' + s + 'Style'] !== 'none')) return 'border'; // top/bottom-only borders are divider rules, not boxes
    if (c.boxShadow !== 'none' && c.boxShadow.split(/,(?![^(]*\))/).some(sh => { const m = sh.match(/(-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px/); return m && +m[1] === 0 && +m[2] === 0 && +m[3] === 0 && +m[4] > 0; })) return 'rim'; // only a full ring counts, not a one-side inset rule
    if (parseFloat(c.outlineWidth) > 0 && c.outlineStyle !== 'none' && alpha(c.outlineColor) > 0.05) return 'outline';
    return null;
  };
  const nearestPainted = n => { for (let q = n.nodeType === 3 ? n.parentElement : n; q && q !== document.body && q !== document.documentElement; q = q.parentElement) { const k = painted(q); if (k) { const r = q.getBoundingClientRect(); if (r.width > 0 && r.height > 0 && r.width < innerWidth * 0.97 && !(r.width > 560 && r.height > 360)) return { el: q, kind: k }; return null; } } return null; };
  const small = (q, r) => { const c = getComputedStyle(q); const cls = String(q.className); return /kbd|chip|pill|badge|tag/i.test(cls) || q.tagName === 'KBD' || (r.height <= 26 && parseFloat(c.borderRadius) >= r.height / 2 - 1); };
  const sel = e => { const p = []; for (let q = e, n = 0; q && n < 3 && q !== document.body; q = q.parentElement, n++) p.push(q.tagName.toLowerCase() + (q.className && typeof q.className === 'string' ? '.' + q.className.trim().split(/\s+/)[0] : '')); return p.reverse().join(' > '); };
  const clipRight = (e, r) => { for (let q = e; q && q !== document.body; q = q.parentElement) { const c = getComputedStyle(q); if (c.textOverflow === 'ellipsis' || (c.maskImage && c.maskImage !== 'none') || (c.webkitMaskImage && c.webkitMaskImage !== 'none') || c.webkitLineClamp !== 'none' || (c.overflowX !== 'visible' && q.scrollWidth > q.clientWidth + 1)) { const b = q.getBoundingClientRect(); return Math.min(r.right, b.right); } } return r.right; };
  const check = (el0, box, kind, why, hover, out, seen) => {
    const br = box.getBoundingClientRect(), cs = getComputedStyle(box); const bl = parseFloat(cs.borderLeftWidth) || 0, brw = parseFloat(cs.borderRightWidth) || 0;
    const L = br.left + bl, R = br.right - brw, T = br.top, B = br.bottom, sm = small(box, br), hmin = sm ? 6 : 8;
    const rects = [];
    if (el0.nodeType === 3) { const rg = document.createRange(); rg.selectNodeContents(el0); for (const r of rg.getClientRects()) if (r.width > 1 && r.height > 1) rects.push({ left: r.left, right: clipRight(el0.parentElement, r), top: r.top, bottom: r.bottom, what: 'text "' + el0.textContent.trim().slice(0, 28) + '"' }); }
    else { const r = el0.getBoundingClientRect(); rects.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, what: 'icon ' + (el0.tagName.toLowerCase()) }); }
    for (const r of rects) {
      const gl = r.left - L, gr = R - r.right, gt = r.top - T, gb = B - r.bottom; const horiz = Math.min(gl, gr); let bad = null;
      if (horiz < 0 || gt < 0 || gb < 0) bad = 'crosses box (L ' + gl.toFixed(1) + ' R ' + gr.toFixed(1) + ' T ' + gt.toFixed(1) + ' B ' + gb.toFixed(1) + ')';
      else if (horiz < hmin - 0.05) bad = 'horizontal gap ' + horiz.toFixed(1) + ' < ' + hmin + ' (L ' + gl.toFixed(1) + ' R ' + gr.toFixed(1) + ')';
      else if (Math.min(gt, gb) < 2) bad = 'vertical gap ' + Math.min(gt, gb).toFixed(1) + ' < 2';
      if (bad) { const key = sel(box) + r.what + bad; if (seen.has(key)) continue; seen.add(key); out.push({ state: hover ? 'hover' : 'rest', box: sel(box), kind, what: r.what, problem: bad, boxRect: [br.x, br.y, br.width, br.height].map(Math.round) }); }
    }
  };
  const scanWithin = (root, hover) => {
    const out = [], seen = new Set();
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
    for (let n = w.currentNode; n; n = w.nextNode()) {
      const isText = n.nodeType === 3 && n.textContent.trim(), isIcon = n.nodeType === 1 && /^(svg|img)$/i.test(n.tagName);
      if (!isText && !isIcon) continue; const host = isText ? n.parentElement : n; if (!host || !visible(host)) continue; if (host.closest('.tab-title,.sb-title,[class*=tab-title]')) continue;
      if (host.closest('[aria-hidden="true"],[inert],[hidden],script,style')) continue;
      if (isIcon && (host.getBoundingClientRect().width > 40)) continue;
      const p = nearestPainted(n); if (!p || p.el === host && isIcon) continue; check(n, p.el, p.kind, '', hover, out, seen);
    }
    return out;
  };
  window.__edge = {
    static: () => scanWithin(document.body, false),
    candidates: () => [...document.querySelectorAll('button,a,[role=menuitem],[role=option],[role=tab],[role=row],li,label,summary,.sb-tab,.browser-tab,.acira-compact-tab,[class*=row],[class*=item]')].filter(e => visible(e) && !e.closest('[aria-hidden="true"],[inert]') && e.getBoundingClientRect().width < 700 && e.getBoundingClientRect().height < 120 && e.textContent.trim().length + e.querySelectorAll('svg').length > 0),
    el: e => scanWithin(e.parentElement && painted(e.parentElement) ? e.parentElement : e, true),
    focus: () => {
      const e = document.activeElement; if (!e || e === document.body || !visible(e)) return null;
      const c = getComputedStyle(e), r = e.getBoundingClientRect(), ow = parseFloat(c.outlineWidth) || 0, off = parseFloat(c.outlineOffset) || 0, ring = c.outlineStyle !== 'none' && ow > 0;
      const out = [], e2 = ring ? off + ow : 0, rr = { l: r.left - e2, t: r.top - e2, r: r.right + e2, b: r.bottom + e2 };
      if (!ring && !(c.boxShadow !== 'none')) out.push({ state: 'focus', box: sel(e), kind: 'ring', what: 'focused element', problem: 'no visible focus ring (outline none, no shadow)', boxRect: [r.x, r.y, r.width, r.height].map(Math.round) });
      for (let q = e.parentElement; q && q !== document.documentElement; q = q.parentElement) {
        const qc = getComputedStyle(q); if (qc.overflowX === 'visible' && qc.overflowY === 'visible') continue;
        const qr = q.getBoundingClientRect();
        const clip = Math.min(rr.l - qr.left, rr.t - qr.top, qr.right - rr.r, qr.bottom - rr.b);
        if (clip < -0.5) { out.push({ state: 'focus', box: sel(e), kind: 'ring', what: 'focus ring', problem: 'ring clipped by ' + sel(q) + ' by ' + (-clip).toFixed(1) + 'px', boxRect: [r.x, r.y, r.width, r.height].map(Math.round) }); break; }
        if (clip < 1) { out.push({ state: 'focus', box: sel(e), kind: 'ring', what: 'focus ring', problem: 'ring touches ' + sel(q) + ' edge (' + clip.toFixed(1) + 'px)', boxRect: [r.x, r.y, r.width, r.height].map(Math.round) }); break; }
      }
      const host = painted(e) ? e : e.parentElement && painted(e.parentElement) ? e.parentElement : e;
      return { label: (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30), findings: out.concat(scanWithin(host, true).map(f => ({ ...f, state: 'focus' }))) };
    },
    rect: e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }
  };
  return 'edge scanner ready';
})()
