// Stream M text-clipping scanner. Paste into the chrome UI page (or the overlay page) via the QA driver /eval or /oeval.
// Reports text that crosses or touches its clipping ancestor, or is clipped without an ellipsis. Ellipsis/line-clamp truncation is counted as deliberate.
// Known false positives: hidden live regions (width 1px) and off-screen drill-in panes inside overflow:hidden popups.
(() => {
  const hits = [], seen = new Set();
  const clipAnc = el => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p); if (o.overflowX !== 'visible' || o.overflowY !== 'visible') return p; } return document.documentElement; };
  let ellipsis = 0;
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;

    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
    if (!own.length) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const rg = document.createRange(); rg.selectNodeContents(el); const tr = rg.getBoundingClientRect();
    const text = el.textContent.replace(/\s+/g, ' ').trim().slice(0, 50);
    const anc = clipAnc(el), ar = anc.getBoundingClientRect(); const pad = anc === document.documentElement ? { l: 0, r: innerWidth } : { l: ar.left + parseFloat(getComputedStyle(anc).borderLeftWidth), r: ar.right - parseFloat(getComputedStyle(anc).borderRightWidth) };
    const ell = cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none';
    const trunc = el.scrollWidth > el.clientWidth + 1;
    let why = null;
    if (trunc && ell) { ellipsis++; continue; }
    if (trunc && cs.overflowX !== 'visible') why = 'clipped-no-ellipsis sw=' + el.scrollWidth + ' cw=' + el.clientWidth;
    else if (tr.right > pad.r + 0.5 && tr.width > 0) why = 'text crosses right edge by ' + (tr.right - pad.r).toFixed(1);
    else if (tr.left < pad.l - 0.5 && tr.width > 0) why = 'text crosses left edge by ' + (pad.l - tr.left).toFixed(1);
    else if (tr.right > pad.r - 1 && tr.right <= pad.r + 0.5 && anc !== document.documentElement && tr.width > 40) why = 'text touches right edge (' + (pad.r - tr.right).toFixed(1) + 'px)';
    if (why) { if (el.closest('[inert],[aria-hidden="true"],[hidden]')) continue; { let hid = false; for (let q = el, n = 0; q && q !== document.body && n < 8; q = q.parentElement, n++) { if (getComputedStyle(q).opacity === '0') { hid = true; break; } } if (hid) continue; } const k = text + why; if (!seen.has(k)) { seen.add(k); hits.push(why + ' :: "' + text + '" in <' + anc.tagName.toLowerCase() + '.' + String(anc.className).split(' ')[0].slice(0, 30) + '> rect=' + [tr.x, tr.y, tr.width].map(Math.round)); } }
  }
  return 'ellipsis(deliberate)=' + ellipsis + '\n' + (hits.slice(0, 25).join('\n') || 'no hits');
})()
