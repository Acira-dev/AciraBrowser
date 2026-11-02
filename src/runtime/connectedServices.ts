export interface SitePermission{requester:string;embedder:string;permission:string;decision:string;label:string;temporary?:boolean}
export interface SiteStatus{origin:string;hostname:string;profileId:string;private:boolean;connection:string;cookieCount:number;cookieScope:string;storageScope:string;storageBytes:number|null;permissions:SitePermission[];notice:string}
export type SiteDataCategory='cookies'|'storage'|'cache'|'permissions';
export interface SiteClearResult{cancelled?:boolean;cleared?:boolean;reloadRequired?:boolean;recoveryPaused?:boolean;results?:{category:string;status:string;scope?:string;error?:string}[]}
/** What the connection recorded about the site's certificate: who vouches for it and until when (plain words, no chain). */
export interface ConnectionCertificate{available:boolean;reason?:string;origin?:string;verified?:boolean;issuedBy?:string;issuedTo?:string;validFrom?:string|null;validUntil?:string|null}
export interface FilterListsStatus{source:string;updatedAt:number|null;lastAttempt:number|null;lastError:string|null;updating:boolean;checkedAt?:number|null;refreshIntervalHours:number;automatic:boolean;rollbackAvailable:boolean;lists:{id:string;title:string;url:string;sha256:string;bytes:number}[];notice:string}

export interface ReaderArticle{available:true;url:string;profileId:string;private:boolean;title:string;byline:string;siteName:string;language:string;direction:'ltr'|'rtl';html:string;readingMinutes:number}
export interface ExtensionToolbarTarget{supported:boolean;profileId:string|null;partition:string|null;webContentsId:number|null;pinnedIds:string[];actionIds:string[]}

export interface PersonalArtwork{id:string;name:string;url:string;width:number;height:number;bytes:number}
export interface PersonalArtworkLibrary{profileId:string;private:boolean;assets:PersonalArtwork[];addedId?:string;cancelled?:boolean}

export interface ForgetSitePreview{origin:string;cookieScope:string;storageScope:string;profileId:string;private:boolean;counts:{history:number;closedTabs:number;closedHistoryEntries:number;cookies:number;permissions:number};preserved:string[];notice:string}
export interface ForgetSiteResult extends SiteClearResult{origin?:string;cookieScope?:string;preserved?:string[];filesDeleted?:boolean}
