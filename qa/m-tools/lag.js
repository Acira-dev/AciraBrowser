(() => {
  if (window.__lag && window.__lag.stop) window.__lag.stop();
  const L = window.__lag = { frames: [], appear: null, stopped: false };
  const org = performance.timeOrigin;
  const tick = t => { if (L.stopped) return; L.frames.push(org + t); if (L.frames.length < 400) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const mo = new MutationObserver(() => { if (L.appear == null && document.querySelector('.browser-popup')) L.appear = org + performance.now(); });
  mo.observe(document.body, { childList: true, subtree: true });
  L.stop = () => { L.stopped = true; mo.disconnect(); };
  return 'armed';
})()
