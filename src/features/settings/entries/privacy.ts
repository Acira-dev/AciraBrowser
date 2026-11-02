import { defineSettings } from '../model';

import { t } from '../../../i18n';
/** Stream E (privacy-release) controls. Anchors match the `id` on each SettingRow in panels/privacy.tsx and panels/extensions.tsx. */
const privacy = defineSettings('Privacy', [
  { id: 'protection-overview', title: t("privacy.protectionStatus"), group: 'Protection', description: t("privacy.whatAciraBlocksAndWhat"), aliases: ['what is blocked', 'shields', 'phishing', 'malware', 'safe browsing', 'telemetry', 'analytics', 'crash reports', 'webrtc', 'prefetch', 'topics', 'privacy sandbox'] },
  { id: 'third-party-cookies', title: t("privacy.thirdPartyCookies"), group: 'Cookies', description: t("privacy.blockOrAllowCookiesSet"), aliases: ['cross-site cookies', 'tracking cookies', 'block cookies', 'cookie blocking', 'sign in broken', 'login iframe', 'cookies'], when: 'regular-profile' },
  { id: 'secured-workspaces', title: t('workspaces.securedRow'), group: 'Secured workspaces', description: t('workspaces.securedRowDetail'), aliases: ['lock workspace', 'locked workspace', 'secured workspace', 'windows hello', 'lock after', 'auto lock'], when: 'regular-profile' },
  { id: 'https-only', title: t("privacy.alwaysUseHttps"), group: 'Secure connections', description: t("privacy.upgradeWebsitesToHttpsAnd"), aliases: ['https only', 'https-first', 'secure connections', 'http', 'insecure', 'upgrade', 'ssl', 'tls'], when: 'regular-profile' },
  { id: 'filter-lists-auto', title: t("privacy.updateListsAutomatically"), group: 'Protection lists', description: t("privacy.refreshAdAndTrackerLists"), aliases: ['auto update', 'filter updates', 'easylist', 'ublock origin', 'background requests', 'endpoints'], when: 'regular-profile' },
  { id: 'anti-cname', title: t("privacy.blockHiddenTrackers"), group: 'Anti-tracking', description: t("privacy.catchTrackersThatHideBehind"), aliases: ['cname', 'cname cloaking', 'uncloaking', 'first-party tracker', 'subdomain tracker', 'dns tracker'], when: 'regular-profile' },
  { id: 'anti-redirects', title: t("privacy.skipTrackingRedirects"), group: 'Anti-tracking', description: t("privacy.goStraightToTheDestination"), aliases: ['bounce tracking', 'debounce', 'redirect tracking', 'link tracking', 'click tracking', 'utm'], when: 'regular-profile' },
  { id: 'anti-params', title: t("privacy.removeTrackingParameters"), group: 'Anti-tracking', description: t("privacy.removeClickIdsSuchAs"), aliases: ['query parameters', 'query stripping', 'fbclid', 'gclid', 'utm', 'click id', 'url tracking', 'clean links'], when: 'regular-profile' },
  { id: 'anti-amp', title: t("privacy.openOriginalPagesInsteadOf"), group: 'Anti-tracking', description: t("privacy.openThePublisherSOwn"), aliases: ['amp', 'de-amp', 'google amp', 'accelerated mobile pages', 'canonical'], when: 'regular-profile' },
  { id: 'anti-fingerprint', title: t("privacy.fingerprintProtection"), group: 'Anti-tracking', description: t("privacy.makeYourDeviceLookSlightly"), aliases: ['fingerprinting', 'farbling', 'canvas', 'webgl', 'audio fingerprint', 'hardware concurrency', 'device memory', 'client hints', 'strict'], when: 'regular-profile' },
  { id: 'usage-metrics', title: t("privacy.anonymousUsage"), group: 'Anonymous usage', description: t("privacy.optionalOnceADayA"), aliases: ['telemetry', 'analytics', 'metrics', 'usage', 'statistics', 'data sent to acira', 'what is sent', 'tracking acira', 'diagnostics'], when: 'regular-profile' },
  { id: 'phishing-lists', title: t("privacy.phishingProtection"), group: 'Phishing and malware', description: t("privacy.warnBeforeOpeningPagesOn"), aliases: ['phishing', 'malware', 'scam', 'dangerous sites', 'dangerous pages', 'warn about dangerous pages', 'urlhaus', 'openphish', 'phishtank', 'block bad sites', 'safe browsing', 'warning page', 'protection'], when: 'regular-profile' },
  { id: 'page-warnings', title: t("privacy.warnAboutScamPages"), group: 'Phishing and malware', description: t("privacy.stopClickfixClipboardCommandsAnd"), aliases: ['clickfix', 'win+r', 'powershell', 'clipboard', 'fake captcha', 'look-alike', 'lookalike', 'homograph', 'punycode', 'typosquat', 'fake login', 'scam'], when: 'regular-profile' },
  { id: 'passkeys', title: t("privacy.passkeysAndSecurityKeys"), group: 'Passkeys and security keys', description: t("privacy.passkeysDetail"), aliases: ['passkey', 'passkeys', 'security key', 'security keys', 'webauthn', 'fido', 'fido2', 'yubikey', 'windows hello', 'choose a passkey', 'sign in with a passkey', 'windows security', 'biometric'], when: 'regular-profile' },
  { id: 'safe-browsing-key', title: t("privacy.safeBrowsingWithYourOwn"), group: 'Google Safe Browsing (optional)', description: t("privacy.optionalExtraWarningsFromGoogle"), aliases: ['phishing', 'malware', 'safe browsing', 'google safe browsing', 'api key', 'scam', 'dangerous sites'], when: 'regular-profile' },
  { id: 'clear-browsing-data', title: t("privacy.clearBrowsingData"), group: 'Clear browsing data', description: t("privacy.historyDownloadsListCookiesSite"), aliases: ['clear history', 'delete history', 'clear cookies', 'clear cache', 'clear downloads', 'ctrl shift delete', 'wipe', 'privacy cleanup'], when: 'regular-profile' },
  { id: 'clear-browsing-data-range', title: t("privacy.clearBrowsingDataTimeRange"), group: 'Clear browsing data', description: t("privacy.lastHourDayWeek4"), aliases: ['last hour', 'last day', 'time range', 'past week', 'all time'], when: 'regular-profile' },
]);

// R3-74: how this profile reaches the internet lives in Connection, with the VPN app and Tor.
const proxyEntries = defineSettings('Connection', [
  { id: 'proxy', title: t("privacy.proxyForThisProfile"), group: 'Proxy', description: t("privacy.systemNoProxyOrA"), aliases: ['privacy', 'connection', 'internet', 'http proxy', 'socks', 'socks5', 'proxy server', 'vpn', 'network proxy'], when: 'regular-profile' },
]);

const extensions = defineSettings('Extensions', [
  { id: 'extensions-manager', title: t("privacy.chromeWebStoreExtensions"), description: t("privacy.installPinUpdateAndRemove"), aliases: ['add-ons', 'addons', 'plugins', 'bitwarden', 'password manager', '1password', 'ublock', 'chrome web store', 'install extension', 'load unpacked'], when: 'regular-profile' },
]);

export default [...privacy, ...proxyEntries, ...extensions];
