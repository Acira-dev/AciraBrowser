'use strict';
// Navigation gate for Safe Browsing: a flagged address gets an Acira warning page instead of the site. "Continue" is
// allowed after the warning (the same address passes once, for ten minutes), because the user decides, not the list.
const THREATS = Object.freeze({
  MALWARE: ['This site may install harmful software', 'Google Safe Browsing lists this address as distributing malware.'],
  SOCIAL_ENGINEERING: ['This site may be trying to trick you', 'Google Safe Browsing lists this address as a phishing or deceptive site. It may try to steal passwords or payment details.'],
  UNWANTED_SOFTWARE: ['This site may offer unwanted software', 'Google Safe Browsing lists this address as offering software that changes your browsing in ways you would not expect.']
});
const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function warningPage(url, threat) {
  const [title, text] = THREATS[threat] || THREATS.SOCIAL_ENGINEERING, safe = escapeHtml(url);
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>:root{color-scheme:light dark;--fg:#1b1416;--bg:#faf7f7;--muted:rgba(27,20,22,.64);--line:rgba(27,20,22,.14);--bad:#b3261e}@media(prefers-color-scheme:dark){:root{--fg:#f4eeee;--bg:#161012;--muted:rgba(244,238,238,.64);--line:rgba(244,238,238,.16);--bad:#ff8a80}}html,body{height:100%;margin:0}body{display:grid;place-items:center;background:var(--bg);color:var(--fg);font:14px/1.5 Inter,system-ui,"Segoe UI",sans-serif}main{width:min(560px,100% - 48px);text-align:center;margin-top:-8vh}.kicker{font:500 11px/1 Inter,system-ui,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:.06em;text-transform:uppercase;color:var(--bad)}h1{font:500 28px/1.2 Inter,system-ui,sans-serif;margin:14px 0 10px}p{margin:0 auto 18px;max-width:46ch;color:var(--muted)}code{display:block;margin:0 auto 22px;padding:8px 12px;border:1px solid var(--line);border-radius:6px;font:12px/1.4 ui-monospace,monospace;word-break:break-all;text-align:left}.row{display:flex;gap:12px;justify-content:center;align-items:center}a.primary{background:var(--fg);color:var(--bg);padding:7px 14px;border-radius:4px;text-decoration:none;font-weight:500}a.quiet{color:var(--muted);font-size:12px}a:focus-visible{outline:2px solid var(--fg);outline-offset:2px}</style><main><div class="kicker">Safe Browsing warning</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p><code>${safe}</code><div class="row"><a class="primary" href="acira://new" autofocus>Back to safety</a><a class="quiet" href="${safe}">Continue to site (unsafe)</a></div></main>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}
function createSafeBrowsingGate({ safeBrowsing, now = Date.now, show }) {
  const allowed = new Map(), TTL = 10 * 60 * 1000, stats = { warned: 0 };
  return {
    /** Patch for a main-frame request: {} (go ahead) or a promise of {cancel:true} after the warning page was opened. */
    check(details, wc) {
      if (details.resourceType !== 'mainFrame' || details.method !== 'GET' || !/^https?:/i.test(details.url) || safeBrowsing.status().state === 'off-no-key') return {};
      const key = (wc?.id ?? 0) + '|' + details.url, until = allowed.get(key);
      if (until) { allowed.delete(key); if (until > now()) return {}; }
      return safeBrowsing.checkUrl(details.url).then(result => {
        if (result.safe) return {};
        allowed.set(key, now() + TTL); stats.warned++; show(wc, warningPage(details.url, result.threat)); return { cancel: true };
      }, () => ({}));
    },
    stats: () => ({ ...stats })
  };
}
module.exports = { createSafeBrowsingGate, warningPage, THREATS };
