// Acira API surface probe: walks chrome/browser in this context, then calls the members the rig planned (read-only or self-scoped calls
// only; arguments come from Chromium's schema), each with a 1 s limit, and posts the report to the rig's local server.
// Placeholders in planned arguments: "__TAB__" (a real tab id), "__WIN__" (a real window id), "__ID__" (this extension's id), "__CB__"
// (a callback that reads chrome.runtime.lastError).
(function () {
  const g = typeof globalThis !== 'undefined' ? globalThis : self;
  function kindOf(v) {
    if (typeof v === 'function') return 'function';
    if (v && typeof v === 'object') return typeof v.addListener === 'function' && typeof v.removeListener === 'function' ? 'event' : 'object';
    return v === undefined ? 'undefined' : 'value:' + typeof v;
  }
  function keysOf(obj) {
    const set = new Set();
    try { for (const k in obj) set.add(k); } catch (e) {}
    // Chromium's native bindings put methods on prototypes (e.g. StorageArea.get), so walk the chain up to the built-in prototypes.
    try { for (let o = obj; o && o !== Object.prototype && o !== Function.prototype; o = Object.getPrototypeOf(o)) for (const k of Object.getOwnPropertyNames(o)) set.add(k); } catch (e) {}
    return [...set].filter(k => k !== 'constructor' && k !== 'prototype' && k !== '__proto__');
  }
  function walk(obj, prefix, depth, out, seen) {
    for (const k of keysOf(obj)) {
      let v;
      try { v = obj[k]; } catch (e) { out[prefix + k] = 'getter-threw'; continue; }
      const kind = kindOf(v);
      out[prefix + k] = kind;
      if (kind !== 'object' || depth >= 3) continue;
      // The same object under two names (e.g. storage.sync === storage.local) is walked under both; the depth limit bounds cycles.
      if (seen.has(v)) out[prefix + k + '#sameObjectAs'] = seen.get(v); else seen.set(v, prefix + k);
      walk(v, prefix + k + '.', depth + 1, out, seen);
    }
  }
  function describe(v) {
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array(' + v.length + ')';
    if (typeof v === 'object') { let keys = []; try { keys = Object.keys(v).slice(0, 8); } catch (e) {} return 'object{' + keys.join(',') + '}'; }
    return typeof v + ':' + String(v).slice(0, 40);
  }
  function resolvePath(root, path) {
    const parts = path.split('.'); let self = null, value = root;
    for (const p of parts) { if (value == null) return {value: undefined}; self = value; try { value = value[p]; } catch (e) { return {value: undefined, threw: String(e)}; } }
    return {self, value};
  }
  function materialize(args, ids) {
    const sub = v => (v === '__TAB__' ? ids.tab : v === '__WIN__' ? ids.win : v === '__ID__' ? ids.id : v === '__FN__' ? function () {} : Array.isArray(v) ? v.map(sub) :
      v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sub(x)])) : v);
    return (args || []).map(sub);
  }
  function call(root, path, args) {
    return new Promise(resolve => {
      const {self: target, value: fn} = resolvePath(root, path);
      if (typeof fn !== 'function') { resolve({status: 'absent'}); return; }
      let done = false, timer;
      const finish = r => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
      timer = setTimeout(() => finish({status: 'timeout'}), 1000);
      const cbAt = args.indexOf('__CB__');
      if (cbAt >= 0) args[cbAt] = function () { let le; try { le = root.runtime && root.runtime.lastError; } catch (e) {} finish(le ? {status: 'error', message: String(le.message).slice(0, 200)} : {status: 'ok', value: describe(arguments[0])}); };
      let r;
      try { r = fn.apply(target, args); } catch (e) { finish({status: 'threw', message: String(e && e.message || e).slice(0, 300)}); return; }
      if (cbAt >= 0) return;
      if (r && typeof r.then === 'function') r.then(v => finish({status: 'ok', value: describe(v)}), e => finish({status: 'error', message: String(e && e.message || e).slice(0, 300)}));
      else finish({status: 'sync', value: describe(r)});
    });
  }
  async function ids(root) {
    const out = {id: root.runtime && root.runtime.id};
    try { const tabs = await root.tabs.query({}); const t = tabs.find(x => /^https?:/.test(x.url || '')) || tabs[0]; if (t) { out.tab = t.id; out.win = t.windowId; } } catch (e) {}
    if (out.win === undefined) try { const w = await root.windows.getLastFocused(); out.win = w && w.id; } catch (e) {}
    return out;
  }
  g.aciraProbe = async function (context, config) {
    const started = Date.now();
    const report = {context, started: new Date().toISOString(), surface: {}, browserSurface: {}, calls: {}, validation: {}, ids: null};
    const chromeRoot = g.chrome, browserRoot = g.browser;
    if (chromeRoot) walk(chromeRoot, '', 0, report.surface, new Map());
    if (browserRoot) walk(browserRoot, '', 0, report.browserSurface, new Map());
    report.browserIsChrome = browserRoot === chromeRoot;
    const post = (part, body) => fetch(config.server + '/report?context=' + encodeURIComponent(context) + '&part=' + part, {method: 'POST', body: JSON.stringify(body)}).catch(() => {});
    // The walk is posted on its own first, so a crash during the calls still leaves the surface (and the last batch tried) on record.
    await post('surface', {surface: report.surface, browserSurface: report.browserSurface, browserIsChrome: report.browserIsChrome});
    const plan = (config.plans && config.plans[context]) || [];
    report.ids = await ids(chromeRoot).catch(() => ({}));
    // One call at a time, each announced first: if a call takes the browser down, the last announced path names it.
    for (let i = 0; i < plan.length; i += 1) {
      const batch = plan.slice(i, i + 1);
      await post('progress', {batch: batch.map(e => e.path), done: Object.keys(report.calls).length});
      await Promise.all(batch.map(async entry => {
        let result = await call(chromeRoot, entry.path, materialize(entry.args, report.ids));
        // A promise-returning Chrome API that answered synchronously with nothing: try the callback form too.
        if (result.status === 'sync' && entry.async && result.value === 'undefined') {
          const again = await call(chromeRoot, entry.path, materialize(entry.args, report.ids).concat('__CB__'));
          result = {...result, callbackForm: again};
        }
        report.calls[entry.path] = result;
        if (entry.validate) {
          // Chromium rejects more arguments than the signature has with "No matching signature." before anything runs.
          const tooMany = new Array(entry.validate).fill('__acira_invalid__');
          report.validation[entry.path] = await call(chromeRoot, entry.path, tooMany);
        }
      }));
    }
    report.ms = Date.now() - started;
    await post('final', report);
    return report;
  };
})();
