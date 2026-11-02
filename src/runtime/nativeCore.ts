/** Requests for window.acira.native(): everyday-browser services owned by the native core. */
export interface ShortcutCommand{id:string;label:string;category:string;defaults:string[];defaultsDisplay:string[];bindings:string[];display:string[];customized:boolean;unbound:boolean}
export interface ShortcutProbe{accelerator:string|null;display?:string;valid:boolean;reason:string|null;code?:string|null;conflict:{id:string;label:string}|null}
export interface ShortcutChange{ok:boolean;code?:'unknown'|'invalid'|'reserved'|'needs-modifier'|'conflict';message?:string;conflict?:{id:string;label:string};binding?:string;display?:string;replaced?:{id:string;label:string}|null;commands?:ShortcutCommand[]}
export interface SpellcheckChoice{enabled:boolean;languages:string[]}
export interface SpellcheckStatus{profileId:string;privateMode:boolean;languageMode:'system'|'selected';choice:SpellcheckChoice;current:SpellcheckChoice;matchesSaved:boolean;needsLanguageChoice:boolean;available?:string[]}
export type NativeRequest=
 | {type:'shortcuts.list'|'shortcuts.reset-all'|'shortcuts.record-start'|'shortcuts.record-stop'|'shortcuts.export'}
 | {type:'shortcuts.set';id:string;accelerator:string;replace?:boolean}
 | {type:'shortcuts.clear'|'shortcuts.reset';id:string}
 | {type:'shortcuts.describe';accelerator:string;id?:string}
 | {type:'shortcuts.import';json:string}
 | {type:'shortcuts.run';id:string}
 | {type:'profiles.remove';id:string}
 | {type:'permissions.list'|'permissions.reset-all'}|{type:'permissions.reset';requester:string;embedder:string;permission:string}
 | {type:'downloads.preferences'|'downloads.choose-folder'}|{type:'downloads.preferences.set';askWhere?:boolean;folder?:string|null}
 | {type:'tor.vault-status'|'tor.vault-bookmark'|'tor.vault-list'|'tor.vault-reopen'|'tor.vault-clear'}|{type:'tor.vault-set';enabled:boolean}|{type:'tor.vault-remove';id:string}
 | {type:'tor.update-status'|'tor.update-check'}|{type:'tor.update-set';auto:boolean}
 | {type:'tor.bridges'}|{type:'tor.bridges-set';bridges:TorBridgeChoice}|{type:'tor.bridges-check';text:string}
 | {type:'tor.moat-fetch'}|{type:'tor.moat-check';transport:string;challenge:string;solution:string}
 | {type:'spellcheck.status'}|{type:'spellcheck.set';enabled:boolean;languages:string[]};
export interface ProfileRemoval{ok:boolean;reason?:'unknown'|'private'|'last-profile'|'busy'|'vetoed';failures?:string[];folderPending?:boolean}
export interface DownloadPreferences{askWhere:boolean;folder:string;defaultFolder:string;customFolder:boolean;folderMissing:boolean}
export interface SitePermission{requester:string;embedder:string;permission:string;decision:'allow'|'block';label:string;temporary?:boolean}
export interface TorUpdateStatus{auto:boolean;state:'idle'|'checking'|'downloading';current:string;tor:string;latest:string|null;lastChecked:number;updatePending:boolean;error:string|null}
export interface TorVaultStatus{enabled:boolean;available:boolean;hasItems:boolean;bookmarks?:{id:string;url:string;title:string;addedAt:number}[]}
/** Tor bridges (desktop/browser-services/tor-bridges.cjs): off, a built-in type (Tor Browser 15's list), or lines the person knows. */
export type TorBridgeType='obfs4'|'snowflake'|'meek';
export interface TorBridgeChoice{mode:'off'|'builtin'|'custom';builtin?:TorBridgeType;custom?:string}
export interface TorBridgeLineError{line:number;code:'long'|'characters'|'transport'|'address'|'fingerprint'|'argument'|'obfs4'|'webtunnel'|'meek'|'many';transport?:string}
export interface TorBridgesStatus{mode:'off'|'builtin'|'custom';builtin:TorBridgeType;custom:string[];types:{id:TorBridgeType;count:number}[];recommended:TorBridgeType;installed:boolean;ok?:boolean;code?:string;errors?:TorBridgeLineError[]}
/** Moat ("Request a bridge" from bridges.torproject.org): a CAPTCHA (base64 JPEG) to answer, then the outcome. */
export interface TorMoatResult{transport?:string;image?:string;challenge?:string;ok?:boolean;wrong?:boolean;count?:number}
export interface NativeResult{torMoat?:TorMoatResult;torBridges?:TorBridgesStatus;torBridgeCheck?:{count:number;errors:TorBridgeLineError[];empty:boolean};torVault?:TorVaultStatus;saved?:'saved'|'already';reopened?:number;torUpdate?:TorUpdateStatus;permissions?:{rows:SitePermission[]};downloads?:{preferences:DownloadPreferences;cancelled?:boolean};profiles?:ProfileRemoval;spellcheck?:SpellcheckStatus;shortcuts?:ShortcutChange&Partial<ShortcutProbe>&{ran?:string;commands?:ShortcutCommand[];recording?:boolean;hints?:Record<string,string>;json?:string}}
