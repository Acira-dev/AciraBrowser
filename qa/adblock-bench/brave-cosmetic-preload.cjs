'use strict';
// Benchmark-only content script that delivers adblock-rust cosmetic data the way brave-core does:
//  1. url cosmetic resources (hide + style selectors, injected scriptlet script) at document start,
//  2. generic hiding by observed ids/classes via hiddenClassIdSelectors, batched on DOM mutations.
const { ipcRenderer, webFrame } = require('electron');
if (/^https?:/.test(location.href)) {
  let data = { hide: [], style: {}, script: '', generichide: false, exceptions: [] };
  try { data = ipcRenderer.sendSync('brave:url-cosmetic') || data; } catch { }
  if (data.script) void webFrame.executeJavaScript(data.script);
  const css = [];
  if (data.hide.length) css.push(data.hide.join(',\n') + '{display:none!important}');
  for (const [selector, styles] of Object.entries(data.style || {})) css.push(selector + '{' + styles.join(';') + '}');
  if (css.length) { try { webFrame.insertCSS(css.join('\n'), { cssOrigin: 'user' }); } catch { } }
  if (!data.generichide) {
    const seenClasses = new Set(), seenIds = new Set(), hidden = new Set(), pendingClasses = new Set(), pendingIds = new Set(); let timer = null;
    const note = el => { if (!el || el.nodeType !== 1) return; if (el.id && !seenIds.has(el.id)) { seenIds.add(el.id); pendingIds.add(el.id); } if (el.classList) for (const c of el.classList) if (!seenClasses.has(c)) { seenClasses.add(c); pendingClasses.add(c); } };
    const scan = root => { note(root); if (root.querySelectorAll) for (const el of root.querySelectorAll('[id],[class]')) note(el); };
    const flush = async () => { timer = null; if (!pendingClasses.size && !pendingIds.size) return; const classes = [...pendingClasses], ids = [...pendingIds]; pendingClasses.clear(); pendingIds.clear(); try { const selectors = await ipcRenderer.invoke('brave:hidden', classes, ids, [...hidden]); const fresh = (selectors || []).filter(s => !hidden.has(s)); if (fresh.length) { for (const s of fresh) hidden.add(s); webFrame.insertCSS(fresh.join(',\n') + '{display:none!important}', { cssOrigin: 'user' }); } } catch { } };
    const queue = () => { if (!timer) timer = setTimeout(flush, 100); };
    const start = () => { scan(document.documentElement); queue(); new MutationObserver(records => { for (const r of records) { if (r.type === 'attributes') note(r.target); else for (const n of r.addedNodes) if (n.nodeType === 1) scan(n); } queue(); }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['id', 'class'] }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  }
}
