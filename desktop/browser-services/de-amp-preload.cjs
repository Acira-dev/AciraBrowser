'use strict';
// De-AMP (parity audit #8), the page half: in a top-level http(s) document, watch the markup as it is parsed; when the
// <html> tag says AMP (amp or ⚡, as brave-core de_amp_util.cc matches it) and a <link rel=canonical> appears, ask the main
// process (navigation-clean.cjs deAmpTarget: switches, per-site protection, allowlist, loop guard) and, if it agrees,
// replace this page with the canonical one. location.replace leaves no history entry, so Back skips the AMP page.
// Stops at DOMContentLoaded: a page without a canonical link by then is left alone.
const { ipcRenderer } = require('electron');
if (window.top === window && /^https?:/.test(location.href)) {
  let done = false;
  const amp = () => { const html = document.documentElement; return !!html && (html.hasAttribute('amp') || html.hasAttribute('⚡')); };
  const check = () => {
    if (done || !document.documentElement) return;
    if (!amp()) { done = true; observer.disconnect(); return; }
    const link = document.querySelector('link[rel~="canonical" i][href]'); if (!link) return;
    done = true; observer.disconnect();
    try {
      const target = ipcRenderer.sendSync('acira:de-amp', location.href, link.getAttribute('href'));
      if (typeof target === 'string' && /^https?:/.test(target)) location.replace(target);
    } catch { /* A closing window, or no answer: stay on the page. */ }
  };
  const observer = new MutationObserver(check);
  observer.observe(document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => { check(); done = true; observer.disconnect(); }, { once: true });
}
