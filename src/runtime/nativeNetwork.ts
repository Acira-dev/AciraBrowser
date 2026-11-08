export interface NativeNetworkChoice{gpc:boolean;dns:{mode:'system'|'off'|'secure';servers:string[]};/** Application-wide third-party cookie mode, applied at startup. Omitted on save keeps the saved value. */cookies?:'block'|'allow'}
export interface NativeNetworkStatus{saved:NativeNetworkChoice;current:NativeNetworkChoice;restartRequired:boolean;ready:boolean;error:string|null;scope:'application';/** What this running process was actually started with. */engine?:{thirdPartyCookies:'block'|'allow'|'unknown';adApis:'removed'|'available'|'unknown'}|null}

/** Structured, honest protection status for the Settings overview (service `protection.status`). */
export interface ProtectionRow{id:string;title:string;state:'on'|'off'|'optional'|'system'|'unavailable'|'preparing';detail:string}
export interface ProtectionSummary{rows:ProtectionRow[];scope:string}

/** Phishing and malware warnings (services `safebrowsing.status|set-key|clear-key`). Off until a Google Safe Browsing key exists; the key itself is never returned. */
export interface SafeBrowsingStatus{state:'off-no-key'|'initializing'|'ready'|'error';hasKey:boolean;lists:{type:string;prefixes:number;updatedAt:number|null}[];lastUpdate:number|null;nextUpdate:number|null;lastError:string|null}

/** Anti-tracking beyond lists (services `antitracking.status|set`): CNAME uncloaking, tracking-redirect skipping, fingerprint protection. */
export interface AntiTrackingChoice{cnameUncloaking:boolean;skipTrackingRedirects:boolean;stripTrackingParams:boolean;deAmp:boolean;fingerprint:'off'|'standard'|'strict';phishingLists:boolean;pageWarnings:boolean;passkeys:boolean}
/** The phishing and malware lists as the running browser sees them. */
export interface ThreatListsStatus{enabled:boolean;state:'off'|'loading'|'downloading'|'updating'|'partial'|'active'|'stale'|'error';lists:{id:string;title:string;credit:string;entries:number;updated:number|null}[];lastError:string|null;warned?:number;blocked?:number}
/** Why a page was blocked, for the warning page. */
export interface ThreatStatus{kind:'phishing'|'malware'|'lookalike';list:string;host:string;title:string;cause:string;detail:string}
export interface AntiTrackingStatus{settings:AntiTrackingChoice;rows:ProtectionRow[];stats:{cname?:{lookups?:number;cacheHits?:number;cloaked?:number;failures?:number;cached?:number;blocked?:number};debounce?:{debounced?:number;rules?:number;recent?:string[]};threats?:ThreatListsStatus};notes:{cname:string;bounce:string;fingerprint:string}}

/** Profile-wide Clear browsing data (services `data.status`, `data.clear`). Only history and download records accept a time range; the rest are all-time. */
export type BrowsingDataCategory='history'|'downloads'|'cookies'|'storage'|'cache';
export type BrowsingDataRange='hour'|'day'|'week'|'month'|'all';
export interface BrowsingDataStatus{capabilities:Record<BrowsingDataCategory,BrowsingDataRange[]>;notice:string}
export interface BrowsingDataResult{profileId:string;range:BrowsingDataRange;results:{category:BrowsingDataCategory;status:'cleared';note?:string}[];reloadRequired:boolean;notice:string}

/** Strict HTTPS-only (services `https.status|set|allow|revoke`). `https.set` is per ordinary profile; failures open a native Allow-HTTP prompt for this tab only, and `upgradeFailure` lets the error page offer the same via `https.allow`. */
export interface HttpsOnlyStatus{enabled?:boolean;profileId?:string;private?:boolean;upgradeFailure?:{ticketId:string;originalURL:string;secureURL:string;error:string;expiresAt:number;canAllowHTTP:boolean;requiresResubmit:boolean}|null;temporaryHTTP?:{origin:string;active:boolean;scope:string}|null;reloadRequired?:boolean;scope?:string;profile?:{profileId:string;enabled:boolean;scope:string;reloadRequired:boolean}|null;allowed?:boolean;cancelled?:boolean;revoked?:boolean}

/** Per-profile proxy (services `proxy.status|set|route`). System by default; manual HTTP/SOCKS5 without credentials. This is a proxy, not a VPN. */
export type ProxyChoice={mode:'system'|'direct'}|{mode:'fixed_servers';server:{scheme:'http'|'socks5';host:string;port:number};bypassHosts?:string[]};
export interface ProxyStatus{/** An extension (chrome.proxy.settings) holds this profile's proxy; the person's own `choice` is kept and applies again when it lets go. */controlledBy?:{extensionId:string;name:string;mode:'direct'|'system'|'auto_detect'|'pac_script'|'fixed_servers'};effectiveMode?:string;profileId?:string;private?:boolean;choice?:ProxyChoice;applied?:boolean;busy?:boolean;error?:string|null;authenticationSupported?:false;scope?:string;cancelled?:boolean;origin?:string;route?:string;test?:{ok:boolean;message:string}}

/** App updates from GitHub Releases (services `update.status|check|download|pause|resume|install|auto`). */
export interface UpdateStatus{status:'unsupported'|'idle'|'checking'|'available'|'downloading'|'paused'|'ready'|'current'|'error';/** Acira's own download runs (or is paused): it can pause and resume where it stopped. */pausable?:boolean;version:string;available:string|null;progress:number|null;/** Bytes received and expected, and bytes a second, while an update downloads. */transferred:number|null;total:number|null;speed:number|null;/** The downloaded version's release notes as plain text. */notes:string;lastChecked:number|null;error:string|null;/** After repeated failed downloads (main clears it on any success): the page to download Acira from by hand. *//** A failed download of a known update (status 'error'), set by main: `interrupted` is true when an update with a known size stopped (a failed check with nothing known is false); `retry` how many tries failed in a row and when main tries again by itself (null once the quick tries are used up or while one runs); `cause` why. */interrupted?:boolean;retry?:{failures:number;at:number|null};cause?:'network'|'file'|'other'|null;lastResort?:{url:string;platform:'mac'|'windows'|'linux';arch:'arm64'|'x64'|null;version:string|null;kind:string}|null;autoDownload:boolean;channel:'stable'|'beta';supported:boolean;reason:string|null;/** The update just finished downloading and nobody has been asked about it yet. */prompt:boolean;/** The app just restarted into a new version that came with notes, and nobody has been shown them yet. */welcome:boolean;/** That new version and its notes (plain text), once per launch it is the version that just installed. */whatsNew:{version:string;notes:string}|null;installing?:boolean;/** update.prompt only: this caller is the one that shows the question. */claimed?:boolean}
