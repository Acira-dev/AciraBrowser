'use strict';
const { t } = require('./tx.cjs');
// Scam-page checks beyond address lists. Rules only, no learned model: everything here is a pattern a person could read and argue with.
//   1. ClickFix lures: a page that copies a command to your clipboard while telling you to open the Run box (Win+R) or a terminal and paste it.
//   2. Look-alike addresses: mixed-alphabet hosts, homoglyph or one-letter typos of a well-known site, a brand name used as a subdomain of someone else's domain.
//   3. Look-alike sign-in pages: a password form whose title says it is a known brand's sign-in on a domain that brand does not own.
// What Acira tells the person is written here, never taken from the page.
const { domainToUnicode } = require('node:url'), { getDomain } = require('tldts');
const BRANDS = require('./lookalike-brands.json');

// ---------------------------------------------------------------- ClickFix: the page's own copy of these runs in the page (see pageScript)
const COMMAND = [
  /\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]{0,200}?(?:-(?:w|win|windowstyle)\s*:?\s*h(?:idden)?|-e(?:nc|ncodedcommand)?\s+[a-z0-9+/=]{20,}|-ep\s+bypass|-executionpolicy\s+bypass|\biex\b|invoke-expression|downloadstring|downloadfile|\biwr\b|\birm\b|invoke-webrequest|invoke-restmethod|start-process)/i,
  /\bcmd(?:\.exe)?\s*\/[ck]\b[^\n]{0,200}?(?:mshta|curl|certutil|bitsadmin|powershell|pwsh|wscript|cscript|rundll32|regsvr32|msiexec)/i,
  /\bmshta(?:\.exe)?\s+(?:https?:|\\\\|vbscript:|javascript:)/i,
  /\bmsiexec(?:\.exe)?\b[^\n]{0,80}\s\/(?:i|package)\s+https?:/i,
  /\b(?:rundll32|regsvr32)(?:\.exe)?\b[^\n]{0,120}https?:\/\//i,
  /\b(?:curl|wget)\b[^\n|]{0,200}\|\s*(?:sh|bash|zsh|cmd|powershell|pwsh)\b/i,
  /\bbash\s+-c\s+["']?\$\(\s*(?:curl|wget)/i,
  /\bosascript\s+-e\b[^\n]{0,200}(?:curl|do shell script)/i
];
const CUE_RUN = /(?:\bwin(?:dows)?(?:\s*key)?\s*(?:\+|plus|and)\s*r\b|⊞\s*\+?\s*r\b|\brun (?:dialog|window|box|command)\b|\bopen (?:the )?run\b|\bpress\s+(?:the\s+)?windows\b|\bopen (?:a |the )?(?:terminal|powershell|command prompt)\b)/i;
const CUE_PASTE = /(?:\b(?:ctrl|control|cmd|command|⌘)\s*(?:\+|plus)\s*v\b|\bpaste (?:it|the|this|that|(?:the )?(?:command|code|text))\b|\bright[- ]click (?:and )?paste\b)/i;
const CUE_VERIFY = /\b(?:verify|verification|captcha|i(?:'|’)?m not a robot|not a robot|human|robot|fix (?:it|this|the (?:error|issue|problem))|how to fix|browser (?:error|update)|to (?:continue|proceed|view|access|download))\b/i;
const squash = text => String(text || '').replace(/\s+/g, ' ').slice(0, 200000);
/** Is this clipboard text a command a scam would want pasted? */
const isCommand = text => COMMAND.some(pattern => pattern.test(squash(text)));
/** Does the page tell the person to run what was copied? Run box, or paste plus a verification story. */
const hasInstruction = text => { const page = squash(text); return CUE_RUN.test(page) && CUE_PASTE.test(page) || CUE_RUN.test(page) && CUE_VERIFY.test(page) || CUE_PASTE.test(page) && CUE_VERIFY.test(page) && /\b(?:run|terminal|powershell|command|win)/i.test(page); };
const isClickFix = (clipboardText, pageText) => isCommand(clipboardText) && hasInstruction(pageText);
/** The script that runs inside the page, before its own scripts: refuses a clipboard write that is both a command and part of a Run-box lure. */
function pageScript(rules = { COMMAND, CUE_RUN, CUE_PASTE, CUE_VERIFY }) {
  const body = `(() => {
    const once = Symbol.for('acira.clickfix'); if (window[once]) return; Object.defineProperty(window, once, { value: true });
    const COMMAND = [${rules.COMMAND.map(r => r.toString()).join(',')}], CUE_RUN = ${rules.CUE_RUN}, CUE_PASTE = ${rules.CUE_PASTE}, CUE_VERIFY = ${rules.CUE_VERIFY};
    const squash = ${squash.toString()}, isCommand = ${isCommand.toString()}, hasInstruction = ${hasInstruction.toString()};
    let reported = 0;
    const lure = text => { try { const clip = String(text == null ? '' : text); if (!isCommand(clip)) return false; const page = (document.body && document.body.innerText || '') + ' ' + (document.title || ''); return hasInstruction(page); } catch { return false; } };
    const report = () => { if (reported++ < 3) try { window.dispatchEvent(new CustomEvent('acira-clickfix')); } catch {} };
    const deny = () => { report(); return new DOMException('Acira stopped this page from copying a command.', 'NotAllowedError'); };
    const clipboard = navigator.clipboard && Object.getPrototypeOf(navigator.clipboard);
    if (clipboard && clipboard.writeText) { const original = clipboard.writeText; Object.defineProperty(clipboard, 'writeText', { configurable: true, writable: true, value: function (text) { return lure(text) ? Promise.reject(deny()) : original.apply(this, arguments); } }); }
    if (clipboard && clipboard.write) { const original = clipboard.write; Object.defineProperty(clipboard, 'write', { configurable: true, writable: true, value: async function (items) { try { for (const item of items || []) if (item.types && item.types.includes('text/plain') && lure(await (await item.getType('text/plain')).text())) throw deny(); } catch (error) { if (error && error.name === 'NotAllowedError') throw error; } return original.apply(this, arguments); } }); }
    const exec = document.execCommand; if (exec) Object.defineProperty(Document.prototype, 'execCommand', { configurable: true, writable: true, value: function (name) { if (String(name).toLowerCase() === 'copy') { let text = ''; try { const active = document.activeElement; text = active && /^(INPUT|TEXTAREA)$/.test(active.tagName) ? String(active.value || '').slice(active.selectionStart || 0, active.selectionEnd || 0) || String(active.value || '') : String(getSelection()); } catch {} if (lure(text)) { report(); return false; } } return exec.apply(this, arguments); } });
    const setData = DataTransfer.prototype.setData; Object.defineProperty(DataTransfer.prototype, 'setData', { configurable: true, writable: true, value: function (type, data) { if (/^text\\/plain$/i.test(String(type)) && lure(data)) { report(); return; } return setData.apply(this, arguments); } });
  })();`;
  return body;
}

// ---------------------------------------------------------------- Look-alike addresses
const CONFUSABLE = new Map(Object.entries({ '0': 'o', '1': 'l', '3': 'e', '5': 's', '$': 's', 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ɡ': 'g', 'ο': 'o', 'ν': 'v', 'ι': 'i', 'α': 'a', 'ρ': 'p', 'ı': 'i', 'ɩ': 'l', 'ǀ': 'l', 'ⅼ': 'l', 'ո': 'n', 'ս': 'u', 'ց': 'g', 'ʏ': 'y' }));
const skeleton = label => { let out = ''; for (const ch of String(label).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')) out += CONFUSABLE.get(ch) || ch; return out.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/-/g, ''); };
const SCRIPTS = [['Latin', /\p{Script=Latin}/u], ['Cyrillic', /\p{Script=Cyrillic}/u], ['Greek', /\p{Script=Greek}/u], ['Armenian', /\p{Script=Armenian}/u], ['Hebrew', /\p{Script=Hebrew}/u], ['Arabic', /\p{Script=Arabic}/u]];
const scriptsIn = label => SCRIPTS.filter(([, pattern]) => pattern.test(label)).map(([name]) => name);
function distanceOne(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++edits > 1) return false; if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; } }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
const OWNED = new Map(); for (const brand of BRANDS) for (const domain of brand.domains) { const key = getDomain(domain) || domain; if (!OWNED.has(key)) OWNED.set(key, brand); }
const LABELS = BRANDS.map(brand => ({ brand, label: brand.domains[0].split('.')[0], domain: getDomain(brand.domains[0]) || brand.domains[0] }));
/** Why this address might be imitating a known site, or null. Never fires for a domain a brand owns. */
function hostRisk(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[') || host === 'localhost' || host.endsWith('.localhost')) return null;
  const registrable = getDomain(host); if (!registrable || OWNED.has(registrable)) return null;
  const unicode = domainToUnicode(host), labels = unicode.split('.');
  for (const label of labels) { const scripts = scriptsIn(label); if (scripts.length > 1 && scripts.includes('Latin')) return { reason: 'mixed-script', brand: null, domain: null }; }
  const mine = domainToUnicode(registrable).split('.')[0], mineSkeleton = skeleton(mine);
  for (const { brand, label, domain } of LABELS) {
    if (label.length < 5) continue;
    if (mine !== label && mineSkeleton === skeleton(label)) return { reason: 'homoglyph', brand: brand.name, domain };
    if (mine.length >= 6 && distanceOne(mine, label) && !OWNED.has(registrable)) return { reason: 'typo', brand: brand.name, domain };
  }
  const subdomain = unicode.slice(0, Math.max(0, unicode.length - registrable.length - 1));
  if (subdomain) for (const part of subdomain.split('.')) for (const { brand, label, domain } of LABELS) if (label.length >= 5 && skeleton(part).replace(/[^a-z0-9]/g, '') === skeleton(label) ) return { reason: 'brand-subdomain', brand: brand.name, domain };
  return null;
}

// ---------------------------------------------------------------- Look-alike sign-in pages
const ALIASES = []; for (const brand of BRANDS) for (const alias of brand.aliases) ALIASES.push({ brand, alias: alias.toLowerCase() });
ALIASES.sort((a, b) => b.alias.length - a.alias.length);
const SIGNIN = /\b(?:sign[\s-]?in|log[\s-]?in|login|signin|verify|verification|secure|account|password|security (?:check|alert)|confirm)\b/i;
/** The brand a sign-in page's own title or heading claims to be, if its address is not one that brand owns. `text` is title plus first heading, nothing else. */
function loginRisk(hostname, text) {
  const registrable = getDomain(String(hostname || '').toLowerCase()); if (!registrable) return null;
  const claim = String(text || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 300);
  if (!SIGNIN.test(claim) || /\b(?:sign|log)[\s-]?in with\b|\bcontinue with\b|\bor (?:sign|log) in\b/.test(claim)) return null;
  for (const { brand, alias } of ALIASES) {
    const at = claim.search(new RegExp('(?:^|[^a-z0-9])' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^a-z0-9])'));
    if (at < 0) continue;
    if (brand.domains.some(domain => (getDomain(domain) || domain) === registrable)) return null;
    return { reason: 'brand-login', brand: brand.name, domain: getDomain(brand.domains[0]) || brand.domains[0] };
  }
  return null;
}

// ---------------------------------------------------------------- What the person sees
const REASONS = Object.freeze({
  'clipboard-command': hint => ({ kind: 'clickfix', title: t('risk.clipboard.title'), detail: t('risk.clipboard.detail') }),
  'brand-login': hint => ({ kind: 'lookalike', title: t('risk.brandLogin.title', { brand: hint.brand, domain: hint.domain }), detail: t('risk.brandLogin.detail', { brand: hint.brand, domain: hint.domain }) }),
  'mixed-script': () => ({ kind: 'lookalike', title: t('risk.mixedScript.title'), detail: t('risk.mixedScript.detail') }),
  homoglyph: hint => ({ kind: 'lookalike', title: t('risk.homoglyph.title', { brand: hint.brand }), detail: t('risk.homoglyph.detail', { domain: hint.domain }) }),
  typo: hint => ({ kind: 'lookalike', title: t('risk.typo.title', { brand: hint.brand }), detail: t('risk.typo.detail', { domain: hint.domain }) }),
  'brand-subdomain': hint => ({ kind: 'lookalike', title: t('risk.subdomain.title', { brand: hint.brand }), detail: t('risk.subdomain.detail', { brand: hint.brand, domain: hint.domain }) })
});
function explain(reason, hint = {}) { const make = REASONS[reason]; return make ? make(hint) : null; }

/**
 * Wires the page checks to tabs. `send` is the tab's state channel ({risk}); the frame script only reports that a rule fired, and what is shown comes from `explain`.
 * @param {{ipcMain: object, enabled: () => boolean, ownerOf: (wc: object) => boolean}} options
 */
function createPageRisk({ ipcMain, enabled, ownerOf = () => true }) {
  const tabs = new Map(), stats = { clipboardStopped: 0, loginLookalikes: 0 };
  const mainFrameOnly = event => event.senderFrame && event.sender && event.senderFrame === event.sender.mainFrame;
  ipcMain.on('acira:page-risk-config', event => { event.returnValue = { enabled: !!enabled() && tabs.has(event.sender.id) }; });
  ipcMain.on('acira:page-risk-script', event => { event.returnValue = enabled() && tabs.has(event.sender.id) ? pageScript() : ''; });
  ipcMain.on('acira:page-risk', (event, message) => {
    const entry = tabs.get(event.sender.id); if (!entry || !enabled() || !mainFrameOnly(event) || !message || typeof message !== 'object') return;
    let url; try { url = new URL(event.senderFrame.url); } catch { return; } if (!/^https?:$/.test(url.protocol)) return;
    if (message.kind === 'clipboard-command') { stats.clipboardStopped++; entry.set(explain('clipboard-command')); }
    else if (message.kind === 'login-form' && typeof message.text === 'string') { const hit = loginRisk(url.hostname, message.text.slice(0, 400)); if (hit) { stats.loginLookalikes++; entry.set(explain(hit.reason, hit)); } }
  });
  return {
    /** Starts watching a tab's contents; clears its caution at every top-level navigation. */
    attach(wc, send) {
      if (tabs.has(wc.id)) return;
      const entry = { set: risk => { if (wc.isDestroyed() || !risk) return; entry.current = risk; send({ risk }); }, current: null };
      tabs.set(wc.id, entry);
      wc.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace && entry.current) { entry.current = null; send({ risk: null }); } });
      wc.once('destroyed', () => tabs.delete(wc.id));
    },
    pageScript, stats: () => ({ ...stats })
  };
}
module.exports = { isCommand, hasInstruction, isClickFix, pageScript, hostRisk, loginRisk, explain, skeleton, createPageRisk, BRANDS };
