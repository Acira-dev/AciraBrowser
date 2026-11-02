'use strict';
// Links meant for another app: mailto:, tel:, zoommtg:, slack:, spotify:, sms:, facetime:, msteams:… When an app on this computer
// handles the scheme, the person is asked by the app's name ("Open zoom.us?", as Chrome does) and Open hands the link to it. When
// none does, a toast says so instead of the click doing nothing. mailto: and tel: always ask (the system picks a mail or phone app).
// The browser's own schemes, in-page ones and handlers known to run code are never handed on.
const DENIED_EXTERNAL_SCHEMES = new Set([
  // the browser's own and in-page schemes
  'http', 'https', 'about', 'acira', 'acira-browser-ui', 'blob', 'chrome', 'chrome-extension', 'chrome-untrusted', 'data', 'devtools', 'file', 'filesystem', 'javascript', 'view-source', 'ws', 'wss',
  // Chromium's denied external schemes (ExternalProtocolHandler) and Windows handlers that run code
  'afp', 'disk', 'disks', 'hcp', 'ie.http', 'livescript', 'mhtml', 'mocha', 'ms-help', 'ms-its', 'ms-msdt', 'ms-officecmd', 'ms-cxh', 'ms-cxh-full', 'search', 'search-ms', 'res', 'shell', 'vbscript', 'vnd.ms.radio',
]);

/** Decides what a clicked app link does. appName(url) is the handling app's name ('' for none); ask resolves true for Open. */
async function openAppLink(url, {t, appName, ask, toast, open}) {
  let parsed; try { parsed = new URL(url); } catch { return 'invalid'; }
  const scheme = parsed.protocol.slice(0, -1).toLowerCase();
  if (DENIED_EXTERNAL_SCHEMES.has(scheme)) return 'denied';
  let name = ''; try { name = String(appName(url) || '').replace(/\.app$/i, '').trim(); } catch { /* No answer is no app. */ }
  if (!name && scheme !== 'mailto' && scheme !== 'tel') { toast(t('main.noAppForLinks', {scheme: scheme + ':'})); return 'no-app'; }
  if (!await ask({message: name ? t('main.openApp', {app: name}) : t('main.openAnExternalApplication'), detail: url})) return 'cancelled';
  open(url); return 'opened';
}

module.exports = {openAppLink, DENIED_EXTERNAL_SCHEMES};
