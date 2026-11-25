'use strict';
// Beta 14, Zap: the page side. Runs in the main frame of every website, in the preload's own world (the page cannot see it, call it or change it), before the page's scripts.
//   1. Start: the rules for this site arrive in the frame's boot answer (zap.cjs through frame-boot.cjs, no extra round trip) and go in as ONE user-origin style sheet of
//      `selector { display: none !important }` before anything is laid out: the part is never painted, never flashes, and the page can neither see that sheet nor remove it, restyle
//      it or block it with a content security policy. Nothing is deleted from the page, so its own scripts keep finding what they look for.
//   2. Picking (main drives it, the picker's layer above the page draws it): finds the part under the pointer, widens and narrows the pick, builds the rule on commit.
//   3. The leave and the return: the part leaves with the vapor blur-and-fade while the page closes the gap; coming back is the exact reverse (a symmetric curve both ways).
//   4. Keeping it gone: a part that comes back under another name (a script that re-inserts it) is found by what it is and hidden too; a scroll lock the part set is released.
// Selectors are built from stable things only (ids, custom tags, attributes, stable classes, the place under a stable ancestor) and each is tested on the live page: it must find
// exactly the picked part. Nothing here is copied from another project: the ideas (candidate selectors tested against the page, a stable-name filter, widening by ancestor, an
// early user-origin sheet) are the common practice of uBlock Origin's picker, Brave's and AdGuard's, written anew (see THIRD_PARTY_NOTICES.md, "Zap").
const {ipcRenderer, webFrame} = require('electron');
if (process.isMainFrame && /^https?:/.test(location.href)) {
  /* frame-boot client (frame-boot.cjs) */const bootAnswer=(channel,...args)=>{try{const KEY=Symbol.for('acira.frame-boot');let boot=globalThis[KEY];if(!boot)boot=globalThis[KEY]=ipcRenderer.sendSync('acira:frame-boot',location.href,process.isMainFrame,window===window.top)||{};if(Object.prototype.hasOwnProperty.call(boot,channel))return boot[channel];}catch{/* ask directly */}return ipcRenderer.sendSync(channel,...args);};/* end frame-boot client */
  const CHANNEL = 'acira:zap', EVENT = 'acira:zap-event';
  // A scroll lock released the way the banner code does it (content-filter-preload.cjs): high specificity, so a site's own rule cannot win. Like every rule here it is switched off by a token on
  // the root (`u`), never taken out: a user-origin sheet cannot be removed again in Electron.
  const GATE = 'data-zr', OFF = ':not([' + GATE + '~="u"])';
  const UNLOCK = ':root:not(#acira-u):not(#acira-u)' + OFF + ',:root:not(#acira-u):not(#acira-u)' + OFF + '>body:not(#acira-u){overflow-y:auto!important}';
  const UNFIX = ':root:not(#acira-u):not(#acira-u)' + OFF + '>body:not(#acira-u){position:unset!important}';
  const gateLine = (id, selector) => ':root:not([' + GATE + '~="' + id + '"]) ' + selector + '{display:none!important}';   // the same text as zap.cjs compile(): lines already put in are never put in twice
  const EASE = 'cubic-bezier(.45,0,.55,1)'; // symmetric: the return is the exact mirror of the leave (a reversed ease-out collapses its last pixels in one frame)
  const test = typeof __zapLab !== 'undefined' ? __zapLab : null;

  const state = {rules: [], lines: new Set(), off: new Set(), unlockIn: false, unlock: false, observer: null, watchTimer: 0, deepSheets: new WeakMap(), deepNodes: new Set(), motion: {ms: 180, reduced: false}, pick: null, busy: new Set()};
  const send = message => { try { ipcRenderer.send(EVENT, message); } catch { /* a closing page */ } };
  const num = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

  // ---------------------------------------------------------------------------------------------------------------------------------- the style sheet
  /** Puts in the lines of a style sheet that are not in yet (one user-origin sheet for what is new). The sheet only grows: see the gate above. */
  function addCss(css) {
    if (typeof css !== 'string' || !css) return;
    const fresh = css.split('\n').filter(line => line && !state.lines.has(line));
    if (!fresh.length) return;
    for (const line of fresh) state.lines.add(line);
    try { webFrame.insertCSS(fresh.join('\n'), {cssOrigin: 'user'}); } catch { for (const line of fresh) state.lines.delete(line); }
  }
  /** Switches a removal off (its part is back at once) or on again, by the token list on the root. */
  function setOff(id, on) {
    if (on === state.off.has(id)) return;
    if (on) state.off.add(id); else state.off.delete(id);
    const root = document.documentElement;
    if (!root) return;
    if (state.off.size) root.setAttribute(GATE, [...state.off].join(' ')); else root.removeAttribute(GATE);
  }
  /** After a change of the rule list: a rule that is no longer in it was restored, so it is switched off; one that is back is switched on. */
  function syncRules(next) {
    const now = new Set(next.map(rule => rule.id));
    for (const rule of state.rules) if (!now.has(rule.id)) setOff(rule.id, true);
    for (const rule of next) setOff(rule.id, false);
    state.rules = next;
  }
  function setUnlock(on, fixed) {
    if (on) { state.unlockIn = true; addCss(UNLOCK + '\n' + (fixed ? UNFIX : '')); setOff('u', false); }
    else if (state.unlockIn) setOff('u', true);
  }

  // -------------------------------------------------------------------------------------------------------------------- what is a stable name
  // A name a site's build made up on its own (CSS-in-JS and CSS-module hashes, framework counters, minified one-letter classes) changes on the next deploy or even the next load.
  const RANDOM_TOKEN = [/\d{3,}/, /^[a-z]{1,3}[-_]?[0-9a-f]{5,}$/i, /^(?:css|sc|jsx|js|emotion|svelte|astro|styled|tw|chakra|mui|makeStyles|jss)[-_][a-z0-9]{4,}$/i, /^_[a-z0-9]{3,10}$/i, /^[A-Za-z]{1,3}[0-9][A-Za-z0-9]{3,}$/, /^[a-z0-9]{1,2}$/i];
  function randomLooking(token) {
    if (!token || token.length > 40) return true;
    if (RANDOM_TOKEN.some(test => test.test(token))) return true;
    const tail = token.includes('__') ? token.slice(token.lastIndexOf('__') + 2) : ''; // CSS modules: Name_root__a3Fk2
    if (tail.length >= 4 && tail.length <= 8 && /^[A-Za-z0-9-]+$/.test(tail) && (/\d/.test(tail) || /[a-z][A-Z]/.test(tail))) return true;
    if (/^[^aeiouAEIOU\W_]{5,}$/.test(token) && !/^(?:html|css|svg)/i.test(token)) return true; // a run of consonants only
    if (token.length <= 8 && /[A-Z]/.test(token) && /[a-z]/.test(token) && /\d/.test(token)) return true;
    return false;
  }
  // `Banner_root__a3Fk2` (CSS modules) and `sc-hash-Name` keep a readable front: the part before the hash is stable and findable with [class*=].
  function modulePrefix(token) {
    const match = /^([A-Za-z][A-Za-z0-9-]*(?:_[A-Za-z0-9-]+)?__)[A-Za-z0-9_-]{4,10}$/.exec(token) || /^([A-Za-z][A-Za-z0-9-]{3,}_)[A-Za-z0-9_-]{5,8}$/.exec(token);
    return match && !randomLooking(match[1].replace(/[_-]+$/, '')) ? match[1] : '';
  }
  const esc = value => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : String(value).replace(/[^\w-]/g, ch => '\\' + ch));
  const quote = value => '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const STABLE_ATTRS = ['data-testid', 'data-test', 'data-test-id', 'data-cy', 'data-qa', 'data-id', 'data-component', 'data-component-name', 'data-name', 'data-type', 'data-role', 'data-section', 'data-widget', 'data-ad-slot', 'data-block', 'data-module', 'data-element', 'role', 'aria-label', 'aria-modal', 'name', 'title', 'alt', 'type', 'placeholder'];
  const attrNameOk = name => /^[a-z][a-z0-9-]{1,40}$/.test(name) && !/\d{4,}|[0-9a-f]{8}/.test(name) && !/^(?:data-reactid|data-react|data-v-|data-radix-\w*-\d|data-state|data-open|data-closed|data-focus|data-hover|data-active|data-selected|data-disabled|data-orientation|data-side|data-align|data-index|data-key)/.test(name);
  const attrValueOk = value => value.length > 0 && value.length <= 48 && !/[{};<>\n]/.test(value) && !randomLooking(value.replace(/[\s-]+/g, '')) || /^[a-z][a-z\s-]{2,40}$/i.test(value);

  /** The qualities of one element a selector can use, best first, each already checked to be stable-looking. */
  function features(el) {
    const tag = el.localName, out = {tag, id: '', custom: tag.includes('-') && !randomLooking(tag.replace(/-/g, '')), classes: [], prefixes: [], attrs: []};
    const id = el.getAttribute('id');
    if (id && !randomLooking(id) && !/\s/.test(id)) out.id = id;
    for (const token of el.classList) { if (!randomLooking(token) && !/[^\w-]/.test(token.replace(/\\/g, ''))) out.classes.push(token); else { const prefix = modulePrefix(token); if (prefix && !out.prefixes.includes(prefix)) out.prefixes.push(prefix); } }
    for (const name of el.getAttributeNames()) {
      if (name === 'class' || name === 'id' || name === 'style' || name === 'href' || name === 'src' || name.startsWith('on') || !attrNameOk(name)) continue;
      const value = el.getAttribute(name) || '';
      if (STABLE_ATTRS.includes(name) || name.startsWith('data-')) {
        if (value === '' && name.startsWith('data-')) out.attrs.push([name, null]);
        else if (attrValueOk(value)) out.attrs.push([name, value]);
        else if (name.startsWith('data-')) out.attrs.push([name, null]);
      }
    }
    if (tag === 'iframe' || tag === 'embed' || tag === 'object') {
      const src = el.getAttribute('src') || '';
      try { const url = new URL(src, location.href); if (url.host && url.host !== location.host) out.attrs.push(['src*', url.host]); else if (url.pathname.length > 2 && url.pathname.length < 60) out.attrs.push(['src*', url.pathname]); } catch { /* no address */ }
    }
    return out;
  }
  const attrSel = ([name, value]) => (name === 'src*' ? '[src*=' + quote(value) + ']' : value === null ? '[' + name + ']' : '[' + name + '=' + quote(value) + ']');

  // ---------------------------------------------------------------------------------------------------------------------------- the selector builder
  /** Selectors for `el` inside `scope` (the document or one shadow root), as [{sel, rank}] best first; each finds exactly `el`. rank: 0 id, 1 custom tag, 2 attribute, 3 classes, 4 class prefix, 5 under a stable ancestor, 6 the place in the page. */
  function candidates(el, scope, budget = {n: 0}) {
    const found = [], seen = new Set();
    const unique = selector => { if (budget.n++ > 160) return false; try { const hit = scope.querySelectorAll(selector); return hit.length === 1 && hit[0] === el; } catch { return false; } };
    const offer = (selector, rank) => { if (!selector || seen.has(selector)) return false; seen.add(selector); if (!unique(selector)) return false; found.push({sel: selector, rank}); return true; };
    const f = features(el), tag = f.tag;
    if (f.id) offer('#' + esc(f.id), 0) || offer(tag + '#' + esc(f.id), 0);
    if (f.custom) offer(tag, 1);
    for (const attr of f.attrs) offer(tag + attrSel(attr), 2);
    if (f.attrs.length > 1) offer(tag + f.attrs.slice(0, 2).map(attrSel).join(''), 2);
    for (const attr of f.attrs) offer(attrSel(attr), 2);
    if (f.classes.length) {
      for (const token of f.classes) offer(tag + '.' + esc(token), 3);
      for (let i = 0; i < f.classes.length; i += 1) for (let j = i + 1; j < f.classes.length; j += 1) offer(tag + '.' + esc(f.classes[i]) + '.' + esc(f.classes[j]), 3);
      offer(tag + f.classes.slice(0, 4).map(token => '.' + esc(token)).join(''), 3);
    }
    for (const prefix of f.prefixes) offer(tag + '[class*=' + quote(prefix) + ']', 4);
    if (found.length < 2) anchored(el, scope, f, offer, budget);
    if (!found.length || found[0].rank > 5) place(el, scope, offer);
    return found.sort((a, b) => a.rank - b.rank);
  }
  /** The part under its nearest stable ancestor: `ancestor > tag:nth-of-type(2) > tag.class`. */
  function anchored(el, scope, f, offer, budget) {
    const steps = [];
    let node = el;
    for (let depth = 0; depth < 6 && node && node.parentElement && node !== scope; depth += 1) {
      steps.unshift(step(node));
      const parent = node.parentElement;
      if (!parent || parent === document.documentElement || parent === document.body) break;
      const pf = features(parent);
      const anchors = [];
      if (pf.id) anchors.push('#' + esc(pf.id));
      if (pf.custom) anchors.push(pf.tag);
      for (const attr of pf.attrs.slice(0, 3)) anchors.push(pf.tag + attrSel(attr));
      for (const token of pf.classes.slice(0, 3)) anchors.push(pf.tag + '.' + esc(token));
      for (const anchor of anchors) { if (offer(anchor + ' > ' + steps.join(' > '), 5)) return; if (offer(anchor + ' ' + steps.join(' > '), 5)) return; }
      node = parent;
    }
  }
  function step(node) {
    const f = features(node), parent = node.parentElement, siblings = parent ? [...parent.children].filter(other => other.localName === node.localName) : [node];
    const same = parent ? [...parent.children].filter(other => other.localName === node.localName && f.classes.every(token => other.classList.contains(token))) : [node];
    if (f.classes.length && same.length === 1) return node.localName + '.' + esc(f.classes[0]);
    if (f.id) return '#' + esc(f.id);
    return siblings.length === 1 ? node.localName : node.localName + ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
  }
  /** The plainest way: its place from the top (weak, last). */
  function place(el, scope, offer) {
    const parts = [];
    let node = el;
    for (let depth = 0; depth < 10 && node && node.parentElement; depth += 1) {
      const parent = node.parentElement;
      parts.unshift(node.localName + ':nth-child(' + ([...parent.children].indexOf(node) + 1) + ')');
      if (parent === document.body || parent === document.documentElement) { parts.unshift(parent.localName); break; }
      if (offer(parts.join(' > '), 6)) return;
      node = parent;
    }
    offer(parts.join(' > '), 6);
  }

  // -------------------------------------------------------------------------------------------------------------------------------- shadow trees
  const shadowParent = node => node.parentElement || (node.getRootNode() instanceof ShadowRoot ? node.getRootNode().host : null);
  /** The element under a point, through open shadow trees. */
  function deepHit(x, y) {
    let node = document.elementFromPoint(x, y);
    for (let depth = 0; node && node.shadowRoot && depth < 8; depth += 1) { const inner = node.shadowRoot.elementFromPoint(x, y); if (!inner || inner === node) break; node = inner; }
    return node;
  }
  /** host, host, ..., el: the shadow hosts from the top document down to `el` (just [el] for a part of the page itself). */
  function hostPath(el) {
    const path = [el];
    for (let node = el; node; ) { const root = node.getRootNode(); if (root instanceof ShadowRoot) { path.unshift(root.host); node = root.host; } else break; }
    return path;
  }

  // ---------------------------------------------------------------------------------------------------------------------------- what the part is
  const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
  function place_(el) {
    for (let node = el; node && node.nodeType === 1; node = shadowParent(node)) { const position = getComputedStyle(node).position; if (position === 'fixed') return 'fixed'; if (position === 'sticky') return 'sticky'; if (position === 'absolute') return 'absolute'; }
    return 'flow';
  }
  function kindOf(el, where) {
    const tag = el.localName, box = el.getBoundingClientRect(), wide = box.width / Math.max(1, innerWidth), tall = box.height / Math.max(1, innerHeight);
    if (tag === 'iframe' || tag === 'embed' || tag === 'object') return 'frame';
    if (tag === 'video' || tag === 'audio' || el.querySelector?.('video')) return 'video';
    if (tag === 'img' || tag === 'picture' || tag === 'svg' || tag === 'canvas') return 'image';
    if (where === 'fixed' || where === 'sticky') {
      if (wide > .6 && tall < .35) return 'bar';
      if (wide > .35 && tall > .25 || (box.left > innerWidth * .15 && box.right < innerWidth * .85 && box.top > innerHeight * .1)) return 'popup';
      return 'widget';
    }
    return 'block';
  }
  function labelOf(el) {
    const direct = clean(el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt'));
    if (direct) return direct.slice(0, 80);
    const heading = el.querySelector?.('h1,h2,h3,h4,strong,b,[role=heading]');
    const text = clean(heading?.textContent) || clean(el.innerText || el.textContent);
    if (text) return text.length > 60 ? text.slice(0, 59).trimEnd() + '\u2026' : text;
    if (el.localName === 'iframe') { const src = el.getAttribute('src') || ''; try { return new URL(src, location.href).host; } catch { return ''; } }
    return '';
  }
  const textOf = el => clean(el.textContent).slice(0, 60);
  const bodyTextLength = () => (document.body ? clean(document.body.textContent).length : 0);
  /** A part the size of the page itself (the app's root, `main`, the article) is not a thing to remove; fixed and sticky layers are, whatever their size. */
  function pageSized(el, where, total) {
    if (el === document.body || el === document.documentElement) return true;
    if (where !== 'flow') return false;
    const box = el.getBoundingClientRect();
    if (box.width < innerWidth * .8 || box.height < innerHeight * .8) return false;
    return total > 200 && textOf(el).length > 0 && clean(el.textContent).length / total > .85;
  }

  /** The rule for one part: {sels, deep, hold, label, kind, fp, unlock?}, or null when it cannot be found again (nothing unique). */
  function buildRule(el) {
    const path = hostPath(el), budget = {n: 0}, sels = [], deep = [];
    let rank = 0;
    if (path.length === 1) {
      const list = candidates(el, document, budget);
      if (!list.length) return null;
      rank = list[0].rank;
      const families = new Set();
      for (const item of list) { const family = item.rank <= 1 ? 'a' : item.rank; if (sels.length < 3 && (!families.has(family) || sels.length === 0)) { families.add(family); sels.push(item.sel); } }
      for (const item of list) if (sels.length < 3 && !sels.includes(item.sel)) sels.push(item.sel);
    } else {
      const steps = [];
      for (let i = 0; i < path.length; i += 1) {
        const scope = i === 0 ? document : path[i - 1].shadowRoot;
        const list = scope ? candidates(path[i], scope, budget) : [];
        if (!list.length) return null;
        steps.push(list[0].sel); rank = Math.max(rank, list[0].rank);
      }
      deep.push(steps);
    }
    const where = place_(el);
    return {sels, deep, hold: rank <= 4 ? 'firm' : 'loose', label: labelOf(el), kind: kindOf(el, where), fp: {tag: el.localName, role: el.getAttribute('role') || '', text: textOf(el), place: where, src: el.localName === 'iframe' ? (el.getAttribute('src') || '').slice(0, 120) : ''}};
  }

  // ---------------------------------------------------------------------------------------------------------------- finding a rule's parts again
  const query = selector => { try { return [...document.querySelectorAll(selector)]; } catch { return []; } };
  function pathMatches(path) {
    let scopes = [document];
    for (const selector of path) { const next = []; for (const scope of scopes) { try { for (const hit of scope.querySelectorAll(selector)) next.push(hit); } catch { /* a selector this page does not take */ } } scopes = next.map(hit => hit.shadowRoot || hit); if (!scopes.length) return []; }
    return scopes.map(item => (item instanceof ShadowRoot ? item.host : item));
  }
  const partsOf = rule => { const parts = new Set(); for (const selector of rule.sels || []) for (const hit of query(selector)) parts.add(hit); for (const path of rule.deep || []) for (const hit of pathMatches(path)) parts.add(hit); return [...parts]; };

  // -------------------------------------------------------------------------------------------------------------- scroll locks
  // A fixed body never scrolls the window (Sourcepoint's lock); a body that scrolls itself is the page's own scroller, not a lock.
  function scrollLocked() {
    const root = document.documentElement, body = document.body;
    if (!body) return false;
    const rs = getComputedStyle(root), bs = getComputedStyle(body), closed = style => style.overflowY === 'hidden' || style.overflowY === 'clip';
    if (bs.position === 'fixed') return body.scrollHeight > innerHeight * 1.2;
    if (/^(auto|scroll)$/.test(bs.overflowY) && body.scrollHeight > body.clientHeight + 1) return false;
    return (closed(rs) || closed(bs)) && Math.max(root.scrollHeight, body.scrollHeight) > innerHeight * 1.2;
  }
  function releaseLock() { if (scrollLocked()) { setUnlock(true, getComputedStyle(document.body).position === 'fixed'); return true; } return false; }

  // ------------------------------------------------------------------------------------------------------------------------------ hiding in shadow trees
  // The user-origin sheet cannot reach into a shadow tree, so a part there is hidden by a sheet adopted into its own root (and inline as a second hold), kept in place by the watch.
  function hideDeep() {
    for (const rule of state.rules) for (const path of rule.deep || []) for (const host of pathMatches(path)) {
      const root = host.getRootNode();
      if (!(root instanceof ShadowRoot) && !host.isConnected) continue;
      try { host.style.setProperty('display', 'none', 'important'); state.deepNodes.add(host); } catch { /* none */ }
    }
  }
  const showDeep = rule => { for (const path of rule.deep || []) for (const host of pathMatches(path)) { try { host.style.removeProperty('display'); state.deepNodes.delete(host); } catch { /* none */ } } };

  // ------------------------------------------------------------------------------------------------------------------------------- the leave and the return
  const reduced = () => state.motion.reduced === true;
  const duration = () => Math.max(60, Math.round(state.motion.ms));
  function flowAxis(el) {
    const style = getComputedStyle(el), parent = el.parentElement, where = style.position;
    if (where === 'fixed' || where === 'absolute' || where === 'sticky' || style.display === 'contents' || style.display === 'none') return null;
    if (/^inline$/.test(style.display) || /^table/.test(style.display)) return null;
    const pd = parent ? getComputedStyle(parent) : null;
    if (pd && /flex/.test(pd.display) && /^row/.test(pd.flexDirection || 'row')) return 'width';
    return 'height';
  }
  // The leave: the part blurs and fades (first), and, while it does, the page closes the gap (from a third of the way, so the part is already half gone when the page starts to move).
  // Both are one-way keyframes with offsets inside ONE shared duration and a point-symmetric curve: played backwards they are the exact mirror, so the return is the leave in reverse
  // (a reversed ease-out would collapse its last pixels in one frame). The first keyframe is the part as it is, so nothing changes at the first frame.
  function leaveFrames(el) {
    const style = getComputedStyle(el), axis = reduced() ? null : flowAxis(el), filter = style.filter === 'none' ? '' : style.filter + ' ';
    const fade = reduced()
      ? [{offset: 0, opacity: num(Number(style.opacity), 1)}, {offset: 1, opacity: 0}]
      : [{offset: 0, opacity: num(Number(style.opacity), 1), filter: filter + 'blur(0px)'}, {offset: .6, opacity: 0, filter: filter + 'blur(8px)'}, {offset: 1, opacity: 0, filter: filter + 'blur(8px)'}];
    const shut = axis === 'width'
      ? {width: '0px', minWidth: '0px', marginLeft: '0px', marginRight: '0px', paddingLeft: '0px', paddingRight: '0px', borderLeftWidth: '0px', borderRightWidth: '0px'}
      : {height: '0px', minHeight: '0px', marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px'};
    const open = axis === 'width'
      ? {width: style.width, minWidth: style.width, marginLeft: style.marginLeft, marginRight: style.marginRight, paddingLeft: style.paddingLeft, paddingRight: style.paddingRight, borderLeftWidth: style.borderLeftWidth, borderRightWidth: style.borderRightWidth}
      : {height: style.height, minHeight: style.height, marginTop: style.marginTop, marginBottom: style.marginBottom, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, borderTopWidth: style.borderTopWidth, borderBottomWidth: style.borderBottomWidth};
    const collapse = axis ? [{offset: 0, ...open}, {offset: .3, ...open, overflow: 'hidden'}, {offset: 1, ...shut, overflow: 'hidden'}] : null;
    return {fade, collapse};
  }
  /** Plays the leave (or, with `back`, the return). Resolves when it has finished; the part stays at its end (fill forwards) until the caller changes the sheet. */
  function animate(el, back) {
    return new Promise(resolve => {
      let frames;
      try { frames = leaveFrames(el); } catch { resolve(); return; }
      const total = reduced() ? Math.min(140, duration()) : duration() + 160, direction = back ? 'reverse' : 'normal', animations = [];
      try {
        animations.push(el.animate(frames.fade, {duration: total, easing: EASE, fill: 'both', direction}));
        if (frames.collapse) animations.push(el.animate(frames.collapse, {duration: total, easing: EASE, fill: 'both', direction}));
      } catch { resolve(); return; }
      let done = 0;
      const finish = () => { if (++done === animations.length) resolve(animations); };
      for (const item of animations) { item.onfinish = finish; item.oncancel = finish; }
      state.busy.add(el);
    });
  }
  const settle = (animations, el) => { for (const item of animations || []) { try { item.cancel(); } catch { /* done */ } } if (el) state.busy.delete(el); };

  // ------------------------------------------------------------------------------------------------------------------------------------ picking
  function chainOf(hit, total) {
    const nodes = [];
    for (let node = hit; node && node.nodeType === 1 && node !== document.body && node !== document.documentElement; node = shadowParent(node)) nodes.push(node);
    const levels = [];
    for (const node of nodes) {
      const where = place_(node);
      if (pageSized(node, where, total)) break;
      const box = node.getBoundingClientRect(), last = levels[levels.length - 1];
      if (box.width < 1 || box.height < 1) continue;
      // Wrappers with the very same box as the part inside them are one step: the outermost one is the one to remove (nothing of it is left behind).
      if (last && Math.abs(last.box.left - box.left) < 1.5 && Math.abs(last.box.top - box.top) < 1.5 && Math.abs(last.box.width - box.width) < 1.5 && Math.abs(last.box.height - box.height) < 1.5) { last.node = node; last.box = box; continue; }
      levels.push({node, box});
    }
    return levels;
  }
  function hover() {
    const pick = state.pick;
    if (!pick) return;
    const level = pick.levels[Math.min(pick.level, pick.levels.length - 1)];
    if (!level) { send({type: 'hover', rect: null}); return; }
    if (!level.node.isConnected) { pick.hit = null; pick.sent = ''; pickAt(pick.x, pick.y); return; } // the page took the part away under the pointer: look again
    const box = level.node.getBoundingClientRect(), s = pick.scale;
    const rect = {x: box.left * s, y: box.top * s, width: box.width * s, height: box.height * s};
    // The outline follows the part's own corners (in the layer's units, never rounder than half the part's short side).
    const style = getComputedStyle(level.node), cap = Math.min(rect.width, rect.height) / 2;
    const radius = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].map(value => Math.min(cap, Math.max(0, (parseFloat(value) || 0) * s)));
    const key = [rect.x, rect.y, rect.width, rect.height, ...radius].map(Math.round).join(',') + '|' + pick.level;
    if (key === pick.sent) return;
    const moved = pick.target !== level.node;
    pick.target = level.node; pick.sent = key;
    send({type: 'hover', rect, radius, level: pick.level, levels: pick.levels.length, moved});
  }
  function track() {
    const pick = state.pick;
    if (!pick) return;
    pick.raf = requestAnimationFrame(() => { hover(); if (state.pick === pick) track(); });
  }
  function pickAt(x, y) {
    const pick = state.pick;
    if (!pick) return;
    pick.x = x; pick.y = y;
    const hit = deepHit(x / pick.scale, y / pick.scale);
    if (hit === pick.hit) return;
    pick.hit = hit;
    pick.levels = hit ? chainOf(hit, pick.total) : [];
    pick.level = 0;
    pick.sent = '';
    hover();
  }
  const HTML_DOCUMENT = /^(?:text\/html|application\/xhtml\+xml)$/i;
  let rehit = 0;
  const onScroll = () => { if (rehit || !state.pick) return; rehit = requestAnimationFrame(() => { rehit = 0; const pick = state.pick; if (pick) { pick.hit = null; pickAt(pick.x, pick.y); } }); };
  function startPick(message) {
    endPick(false);
    // A PDF, a picture or a text file is not a page with parts: there is nothing to take out of it.
    if (!HTML_DOCUMENT.test(document.contentType || 'text/html')) { send({type: 'refused', why: 'not-a-page'}); return; }
    state.pick = {scale: Math.max(.1, num(message.width, innerWidth) / Math.max(1, innerWidth)), hit: null, levels: [], level: 0, target: null, sent: '', raf: 0, total: bodyTextLength(), x: 0, y: 0};
    window.addEventListener('scroll', onScroll, true);
    if (Number.isFinite(message.x) && Number.isFinite(message.y)) pickAt(message.x, message.y);
    track();
  }
  function endPick(tell = true) {
    const pick = state.pick;
    if (!pick) return;
    cancelAnimationFrame(pick.raf); cancelAnimationFrame(rehit); rehit = 0; window.removeEventListener('scroll', onScroll, true); state.pick = null;
    if (tell) send({type: 'picking', on: false});
  }
  /** The page scrolls by keyboard while picking (the wheel widens and narrows the pick). */
  function scrollPage(dir) {
    const top = Math.abs(dir) === 2 ? (dir > 0 ? document.documentElement.scrollHeight : 0) : window.scrollY + dir * innerHeight * .85;
    try { window.scrollTo({top, behavior: reduced() ? 'auto' : 'smooth'}); } catch { window.scrollTo(0, top); }
  }
  function widen(delta) {
    const pick = state.pick;
    if (!pick || !pick.levels.length) return;
    const next = Math.max(0, Math.min(pick.levels.length - 1, pick.level + delta));
    if (next === pick.level) { send({type: 'limit', at: delta > 0 ? 'top' : 'bottom'}); return; }
    pick.level = next; pick.sent = ''; hover();
  }
  let tokens = 0;
  const jobs = new Map(); // a removal is two things that finish in either order: the leave animation here and main saving the rule
  function commit() {
    const pick = state.pick;
    if (!pick || !pick.levels.length) return;
    const level = pick.levels[Math.min(pick.level, pick.levels.length - 1)], el = level.node;
    const rule = buildRule(el);
    if (!rule) { send({type: 'refused', why: 'unreachable'}); return; }
    // The pick is released first: a part that is leaving must not stay picked, and the next pick starts clean.
    pick.hit = null; pick.levels = []; pick.target = null; pick.sent = ''; send({type: 'hover', rect: null});
    const job = {token: 't' + (++tokens) + Math.random().toString(36).slice(2, 6), el, wasLocked: scrollLocked(), animations: null, animated: false, saved: null};
    jobs.set(job.token, job);
    void animate(el, false).then(animations => { job.animations = animations; job.animated = true; finishJob(job); });
    send({type: 'commit', token: job.token, rule: {...rule, unlock: false}});
  }
  /** The leave has played and main has answered: the part is hidden for good (the sheet takes over from the animation's last frame with no change on screen), or, if main refused, it comes back. */
  function finishJob(job) {
    if (!job.animated || !job.saved) return;
    jobs.delete(job.token);
    const message = job.saved;
    if (message.ok) {
      if (Array.isArray(message.rules)) syncRules(message.rules); addCss(message.css); hideDeep();
      settle(job.animations, job.el);
      send({type: 'unlocked', id: message.id, value: job.wasLocked && releaseLock()});
    } else void animate(job.el, true).then(animations => settle(animations, job.el));
  }

  // ------------------------------------------------------------------------------------------------------------------- a part that comes back
  // A script that puts a removed part back under a new name (new classes, a new id) is found by what it is: same tag and role, same words, same kind of place. Only parts
  // added after the page started are looked at, only while some rule has nothing to hide right now, and only a close match is hidden (and learned, so the next visit starts hidden).
  function watch() {
    if (state.observer || !state.rules.length || typeof MutationObserver !== 'function') return;
    let queue = [], scheduled = 0;
    const look = () => {
      scheduled = 0;
      const batch = queue; queue = [];
      for (const rule of state.rules) {
        // Only layers (fixed, sticky, floating) and frames come back under a new name; a part of the page's own flow that cannot be found is left alone (its rule says 'may come back').
        if (!rule.fp || !rule.fp.tag || rule.fp.place === 'flow' || partsOf(rule).length) continue;
        for (const node of batch) {
          if (!node.isConnected || node.nodeType !== 1) continue;
          for (const hit of [node, ...(node.querySelectorAll ? [...node.querySelectorAll(rule.fp.tag)].slice(0, 30) : [])]) {
            if (hit.localName !== rule.fp.tag || (rule.fp.role && hit.getAttribute('role') !== rule.fp.role)) continue;
            if (!similar(hit, rule.fp)) continue;
            const again = buildRule(hit);
            if (again && again.sels.length) { hideNow(hit, again, rule.id); send({type: 'learn', id: rule.id, sels: again.sels, deep: again.deep, fp: again.fp}); rule.sels = [...again.sels, ...(rule.sels || [])].slice(0, 3); }
          }
        }
      }
    };
    state.observer = new MutationObserver(records => {
      if (!state.rules.some(rule => rule.fp && rule.fp.tag)) return;
      for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) queue.push(node);
      if (queue.length > 200) queue = queue.slice(-200);
      if (!scheduled && queue.length) scheduled = (typeof requestIdleCallback === 'function' ? requestIdleCallback(look, {timeout: 500}) : setTimeout(look, 120));
    });
    state.observer.observe(document.documentElement, {childList: true, subtree: true});
    state.watchTimer = setTimeout(() => { state.observer?.disconnect(); state.observer = null; }, 120000); // the first two minutes of the page: where scripts re-insert things
  }
  function similar(el, fp) {
    if (fp.text) {
      const words = textOf(el);
      // The same words, to the first 24 characters (a counter or a date further on may differ); a few words are not enough to recognise a part by.
      if (!words || (words.length < 8 && words !== fp.text) || !(words.startsWith(fp.text.slice(0, 24)) || fp.text.startsWith(words.slice(0, 24)))) return false;
    } else if (fp.src && el.localName === 'iframe') {
      try { if (new URL(el.getAttribute('src') || '', location.href).host !== new URL(fp.src, location.href).host) return false; } catch { return false; }
    } else return false; // nothing to recognise it by: never guess
    return fp.place === 'flow' || place_(el) === fp.place;
  }
  /** A part found again is hidden at once (the learned selector reaches the sheet with the next update from main). */
  function hideNow(el, again, id) { try { el.style.setProperty('display', 'none', 'important'); state.deepNodes.add(el); } catch { /* none */ } if (again && again.sels?.length) addCss(again.sels.map(selector => gateLine(id, selector)).join('\n')); }

  // -------------------------------------------------------------------------------------------------------- the lock a removed part set
  function armLock() {
    if (!state.rules.some(rule => rule.unlock) || typeof MutationObserver !== 'function') return;
    const check = () => { if (state.rules.some(rule => rule.unlock && partsOf(rule).length) && (!state.unlockIn || state.off.has('u'))) releaseLock(); };
    const observer = new MutationObserver(check);
    const watchNode = node => node && observer.observe(node, {attributes: true, attributeFilter: ['style', 'class']});
    watchNode(document.documentElement); if (document.body) watchNode(document.body); else document.addEventListener('DOMContentLoaded', () => { watchNode(document.body); check(); }, {once: true});
    window.addEventListener('load', check, {once: true});
    setTimeout(() => observer.disconnect(), 60000).unref?.();
  }

  // ------------------------------------------------------------------------------------------------- Ctrl+Z straight after a removal
  // For a few seconds after a removal main takes Ctrl+Z as "bring it back", but never while the person is typing somewhere on the page (there it is the field's own undo):
  // this tells main whether a text field has the keyboard.
  const typing = () => {
    let el = document.activeElement;
    for (let depth = 0; el && el.shadowRoot && el.shadowRoot.activeElement && depth < 8; depth += 1) el = el.shadowRoot.activeElement;
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.localName;
    return tag === 'textarea' || tag === 'select' || (tag === 'input' && !/^(?:button|checkbox|radio|submit|reset|range|color|image|file)$/i.test(el.type || 'text'));
  };
  let typingWatch = null;
  function watchTyping(on) {
    if (!on) { if (typingWatch) { document.removeEventListener('focusin', typingWatch, true); document.removeEventListener('focusout', typingWatch, true); typingWatch = null; } return; }
    if (typingWatch) return;
    let last = null;
    typingWatch = () => setTimeout(() => { const now = typing(); if (now !== last) { last = now; send({type: 'typing', value: now}); } }, 0);
    document.addEventListener('focusin', typingWatch, true); document.addEventListener('focusout', typingWatch, true);
    last = typing(); send({type: 'typing', value: last});
  }

  // ------------------------------------------------------------------------------------------------------------------------------------ messages
  function applyRules(message) {
    syncRules(Array.isArray(message.rules) ? message.rules : []);
    addCss(message.css);
    hideDeep(); watch(); armLock();
  }
  /** Rules were restored: their parts come back the way they left, measured as they show again and played backwards from the collapsed, blurred state, so nothing cuts in. */
  async function reveal(message) {
    const targets = [];
    for (const rule of message.revealed || []) for (const part of partsOf(rule)) targets.push({part, rule});
    for (const {rule} of targets) showDeep(rule);
    syncRules(Array.isArray(message.rules) ? message.rules : []);   // the restored ones are switched off here: their parts show again before the next frame
    addCss(message.css);
    hideDeep();
    if (!state.rules.some(rule => rule.unlock)) setUnlock(false);
    await Promise.all(targets.slice(0, 12).map(async ({part}) => {
      if (!part.isConnected || getComputedStyle(part).display === 'none') return;
      settle(await animate(part, true), part);
    }));
  }
  ipcRenderer.on(CHANNEL, (_event, message) => {
    try {
      if (!message || typeof message !== 'object') return;
      if (message.motion) state.motion = {ms: num(message.motion.ms, 180), reduced: message.motion.reduced === true};
      switch (message.op) {
        case 'sheet': if (message.revealed && message.revealed.length) void reveal(message); else applyRules(message); break;
        case 'saved': { const job = jobs.get(message.token); if (job) { job.saved = message; finishJob(job); } else if (message.ok) applyRules(message); break; }
        case 'pick-start': startPick(message); break;
        case 'pick-move': pickAt(num(message.x), num(message.y)); break;
        case 'pick-level': widen(num(message.delta) > 0 ? 1 : -1); break;
        case 'pick-commit': commit(); break;
        case 'pick-end': endPick(false); break;
        case 'scroll': scrollPage(num(message.dir)); break;
        case 'typing-watch': watchTyping(message.on === true); break;
        default: break;
      }
    } catch { /* a page never breaks because of this */ }
  });

  // -------------------------------------------------------------------------------------------------------------------------------------- start
  try {
    const early = bootAnswer('acira:zap-early', location.href);
    // A site whose removals are all inside shadow trees has no style sheet at all (css is empty) but still has rules to look for.
    if (early && Array.isArray(early.rules) && early.rules.length) { state.rules = early.rules; addCss(early.css); }
  } catch { /* a site with no removals, or a closing window */ }
  if (state.rules.length) {
    const ready = () => { hideDeep(); watch(); armLock(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, {once: true}); else ready();
    window.addEventListener('load', hideDeep, {once: true});
  }
  window.addEventListener('pagehide', () => { endPick(false); state.observer?.disconnect(); clearTimeout(state.watchTimer); }, {once: true});
  if (test) test.api = {features, candidates, buildRule, chainOf, deepHit, randomLooking, modulePrefix, pageSized, partsOf, hostPath, kindOf, labelOf, scrollLocked, state, startPick, pickAt, widen, commit, animate, finishJob, applyRules, reveal, jobs, typing, watchTyping, addCss, setOff, syncRules};
}
