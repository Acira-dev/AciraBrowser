/* Failure classification and copy follow Chromium's error pages: the net-error table in
 * components/error_page/common/localized_error.cc and the strings in components/{error_page,ssl_errors,security_interstitials}_strings.grdp,
 * from chromium/chromium@d38ed7fc57696d0ea8e5431504ba37a0b5ec24bc. Chromium: BSD-3-Clause, Copyright 2015 The Chromium Authors.
 * Sentences are adapted (product name, host placeholders, shortened); the ERR_* → heading/cause mapping is kept. */
import type {ErrorKind} from '../features/errors/errorShapes';
import {t,type MessageId} from '../i18n';

export type FailureKind=ErrorKind;
export interface NavigationFailure{
 /** Chromium's symbolic name, for example ERR_CERT_AUTHORITY_INVALID. */
 code:string;
 /** Chromium's numeric code when the message carries one, for example -202. */
 number?:number;
 kind:FailureKind;
 title:string;
 /** One sentence: the cause. */
 message:string;
 /** Longer explanation for the Details section (certificate errors). */
 detail?:string;
 /** At most three short things to try. */
 steps:string[];
 /** Recovery by waiting or retrying makes sense (not for certificate decisions). */
 retryable:boolean;
}

export interface Destination{
 /** Address with credentials removed. */
 address:string;
 host:string;
 port:string;
 /** `host` or `host:port`, with brackets kept for IPv6. */
 hostPort:string;
 secure:boolean;
 local:boolean;
}

type Where=Partial<Pick<Destination,'host'|'hostPort'|'local'>>;
const offline=()=>[t('nf.offlineStep1'),t('nf.offlineStep2')];
const network=()=>[t('nf.checkConnection'),t('nf.networkStep2')];

/** Chromium's per-error certificate text: short cause (…_DESCRIPTION) and explanation (…_DETAILS). `{host}` is the destination. */
const certificateText:Array<[RegExp,MessageId,MessageId]>=[
 [/CERT_COMMON_NAME_INVALID/,'nf.certCn.short','nf.certCn.long'],
 [/CERT_DATE_INVALID/,'nf.certDate.short','nf.certDate.long'],
 [/CERT_AUTHORITY_INVALID|CERT_SELF_SIGNED_LOCAL_NETWORK/,'nf.certAuthority.short','nf.certAuthority.long'],
 [/CERT_CONTAINS_ERRORS|CERT_INVALID/,'nf.certErrors.short','nf.certErrors.long'],
 [/CERT_REVOKED/,'nf.certRevoked.short','nf.certRevoked.long'],
 [/CERT_NO_REVOCATION_MECHANISM|CERT_UNABLE_TO_CHECK_REVOCATION/,'nf.certNoRevocation.short','nf.certNoRevocation.long'],
 [/CERT_WEAK_SIGNATURE_ALGORITHM/,'nf.certWeakSig.short','nf.certWeakSig.long'],
 [/CERT_WEAK_KEY/,'nf.certWeakKey.short','nf.certWeakKey.long'],
 [/CERT_NAME_CONSTRAINT_VIOLATION/,'nf.certNameConstraint.short','nf.certNameConstraint.long'],
 [/CERT_NON_UNIQUE_NAME/,'nf.certNonUnique.short','nf.certNonUnique.long'],
 [/SSL_PINNED_KEY_NOT_IN_CERT_CHAIN/,'nf.certPinned.short','nf.certPinned.long'],
 [/CERT_VALIDITY_TOO_LONG|CERTIFICATE_TRANSPARENCY_REQUIRED|CERT_KNOWN_INTERCEPTION_BLOCKED|CERT_/,'nf.certRequirements.short','nf.certRequirements.long'],
];

/** Parse "ERR_NAME_NOT_RESOLVED (-105)" or "net::ERR_…" into a stable code, a number and a kind, with Chromium's cause and suggestions. */
export function navigationFailure(error:string,destination?:Where):NavigationFailure{
 const code=error.match(/ERR_[A-Z0-9_]+/)?.[0]||'NAVIGATION_FAILED',parsed=error.match(/\((-?\d+)\)\s*$/),number=parsed?Number(parsed[1]):undefined;
 const host=destination?.hostPort||destination?.host||t('nf.siteCap'),base={code,number};
 const cert=/CERT_|CERTIFICATE_|SSL_PINNED_KEY/.test(code)&&!/CLIENT_AUTH/.test(code)?certificateText.find(([pattern])=>pattern.test(code)):undefined;
 if(cert){const hint=/CERT_AUTHORITY_INVALID|CERT_SELF_SIGNED/.test(code)&&destination?.local?t('nf.hintLocal'):t('nf.hintAddress');return {...base,kind:'certificate',retryable:false,title:t('nf.certTitle'),message:t(cert[1],{host:destination?.host||t('nf.siteCap')}),detail:t(cert[2],{host:destination?.host||t('nf.siteLow')}),steps:[hint,t('nf.noPasswords')]};}
 if(/^ERR_(SSL_VERSION_OR_CIPHER_MISMATCH|SSL_OBSOLETE_CIPHER|SSL_OBSOLETE_VERSION)/.test(code))return {...base,kind:'secure',retryable:true,title:t('nf.secureTitle'),message:t('nf.unsupportedProtocol',{host}),steps:[t('nf.noCommonProtocol')]};
 if(/^ERR_SSL_SERVER_CERT_BAD_FORMAT/.test(code))return {...base,kind:'secure',retryable:true,title:t('nf.secureTitle'),message:t('nf.badStandards',{host}),steps:[t('nf.contactOwner')]};
 if(/^ERR_(SSL_PROTOCOL_ERROR|SSL_UNRECOGNIZED_NAME_ALERT)|^ERR_SSL_/.test(code)&&!/CLIENT_AUTH/.test(code))return {...base,kind:'secure',retryable:true,title:t('nf.secureTitle'),message:t('nf.invalidResponse',{host}),steps:[t('nf.tryHttp'),t('nf.localHttps')]};
 if(/CLIENT_AUTH/.test(code))return {...base,kind:'blocked',retryable:false,title:t('nf.accessDenied'),message:/CERT_NO_PRIVATE_KEY|SIGNATURE|NO_COMMON|BAD_FORMAT/.test(code)?t('nf.certProblem'):t('nf.certNotAccepted',{host}),steps:[t('nf.contactAdmin')]};
 if(/INTERNET_DISCONNECTED/.test(code))return {...base,kind:'offline',retryable:true,title:t('nf.offlineTitle'),message:t('nf.offlineMsg'),steps:offline()};
 if(/PROXY_CONNECTION_FAILED/.test(code))return {...base,kind:'other',retryable:true,title:t('nf.proxyTitle'),message:t('nf.proxyMsg'),steps:[t('nf.proxyStep1'),t('nf.proxyStep2')]};
 if(/NETWORK_ACCESS_DENIED/.test(code))return {...base,kind:'blocked',retryable:true,title:t('nf.blockedNetTitle'),message:t('nf.blockedNetMsg'),steps:[t('nf.blockedNetStep')]};
 if(/NETWORK_CHANGED/.test(code))return {...base,kind:'reset',retryable:true,title:t('nf.interruptedTitle'),message:t('nf.networkChanged'),steps:[t('nf.tryAgain')]};
 if(/NETWORK_IO_SUSPENDED/.test(code))return {...base,kind:'reset',retryable:true,title:t('nf.interruptedTitle'),message:t('nf.asleep'),steps:[t('nf.tryAgain')]};
 if(/NAME_NOT_RESOLVED|DNS_|NAME_RESOLUTION_FAILED/.test(code))return {...base,kind:'dns',retryable:true,title:t('nf.unreachableTitle'),message:t('nf.dnsMsg',{host:destination?.host||t('nf.siteCap')}),steps:[t('nf.dnsStep1'),t('nf.checkConnection'),t('nf.dnsStep3')]};
 if(/ICANN_NAME_COLLISION/.test(code))return {...base,kind:'dns',retryable:false,title:t('nf.unreachableTitle'),message:t('nf.collision'),steps:[t('nf.contactAdmin')]};
 if(/TIMED_OUT/.test(code))return {...base,kind:'timeout',retryable:true,title:t('nf.unreachableTitle'),message:t('nf.timedOut',{host}),steps:network()};
 if(/ADDRESS_UNREACHABLE|ADDRESS_INVALID/.test(code))return {...base,kind:'timeout',retryable:true,title:t('nf.unreachableTitle'),message:t('nf.addrUnreachable',{host}),steps:[t('nf.checkAddrPort'),t('nf.proxyFirewall')]};
 if(/CONNECTION_REFUSED/.test(code)){if(destination?.local)return {...base,kind:'refused',retryable:true,title:t('nf.localRefusedTitle',{host}),message:t('nf.localRefusedMsg'),steps:[t('nf.localRefusedStep1'),t('nf.localRefusedStep2')]};return {...base,kind:'refused',retryable:true,title:t('nf.unreachableTitle'),message:t('nf.refused',{host}),steps:network()};}
 if(/CONNECTION_FAILED/.test(code))return {...base,kind:'timeout',retryable:true,title:t('nf.unreachableTitle'),message:t('nf.unreachableNow',{host}),steps:network()};
 if(/CONNECTION_RESET/.test(code))return {...base,kind:'reset',retryable:true,title:t('nf.unreachableTitle'),message:t('nf.reset'),steps:network()};
 if(/CONNECTION_CLOSED|CONNECTION_ABORTED/.test(code))return {...base,kind:'reset',retryable:true,title:t('nf.unreachableTitle'),message:t('nf.closed',{host}),steps:network()};
 if(/CONTENT_LENGTH_MISMATCH|INCOMPLETE_CHUNKED/.test(code))return {...base,kind:'reset',retryable:true,title:t('nf.notWorking'),message:t('nf.closed',{host}),steps:[t('nf.tryAgain'),t('nf.contactIfContinues')]};
 if(/EMPTY_RESPONSE/.test(code))return {...base,kind:'reset',retryable:true,title:t('nf.notWorking'),message:t('nf.noData',{host}),steps:[t('nf.tryAgain'),t('nf.contactIfContinues')]};
 if(/TOO_MANY_REDIRECTS/.test(code))return {...base,kind:'other',retryable:true,title:t('nf.notWorking'),message:t('nf.redirects',{host}),steps:[t('nf.deleteCookies')]};
 if(/INVALID_HTTP_RESPONSE|INVALID_REDIRECT|RESPONSE_HEADERS_/.test(code))return {...base,kind:'other',retryable:true,title:t('nf.notWorking'),message:t('nf.invalidResponse',{host}),steps:[t('nf.tryAgain'),t('nf.contactIfContinues')]};
 if(/BLOCKED_BY_CLIENT/.test(code))return {...base,kind:'blocked',retryable:true,title:t('nf.blockedTitle',{host:destination?.host||t('nf.siteCap')}),message:t('nf.blockedExt'),steps:[t('nf.disableExt'),t('nf.siteControls')]};
 if(/BLOCKED_BY_CSP|BLOCKED_BY_RESPONSE/.test(code))return {...base,kind:'blocked',retryable:false,title:t('nf.blockedTitle',{host:destination?.host||t('nf.siteCap')}),message:t('nf.blockedCsp'),steps:[]};
 if(/BLOCKED_BY_LOCAL_NETWORK_ACCESS/.test(code))return {...base,kind:'blocked',retryable:false,title:t('nf.blockedTitle',{host:destination?.host||t('nf.siteCap')}),message:t('nf.blockedLocal'),steps:[]};
 if(/BLOCKED_BY_ADMINISTRATOR/.test(code))return {...base,kind:'blocked',retryable:false,title:t('nf.pageBlocked'),message:t('nf.admin'),steps:[t('nf.contactAdmin')]};
 if(/UNSAFE_PORT|ACCESS_DENIED/.test(code))return {...base,kind:'blocked',retryable:false,title:t('nf.pageBlocked'),message:/UNSAFE_PORT/.test(code)?t('nf.unsafePort',{host}):t('nf.noPermission'),steps:[t('nf.checkAddrPort')]};
 if(/CACHE_MISS|CACHE_READ_FAILURE/.test(code))return {...base,kind:'other',retryable:true,title:t('nf.cacheTitle'),message:t('nf.cacheMsg'),steps:[t('nf.tryAgain')]};
 return {...base,kind:'other',retryable:true,title:t('nf.notWorking'),message:t('nf.fallbackMsg',{host}),steps:[t('nf.fallbackStep1'),t('nf.fallbackStep2')]};
}

const privateHost=(host:string)=>{const value=host.replace(/^\[|\]$/g,'').toLowerCase();return value==='localhost'||value.endsWith('.localhost')||/^127\./.test(value)||/^10\./.test(value)||/^192\.168\./.test(value)||/^172\.(1[6-9]|2\d|3[01])\./.test(value)||/^169\.254\./.test(value)||value==='::1'||/^f[cd]/.test(value)||/^fe[89ab]/.test(value);};

/** Break an address into what a person reads: never credentials, host and port shown the way they typed them. */
export function describeDestination(value:string):Destination{
 try{const url=new URL(value);url.username='';url.password='';const secure=url.protocol==='https:',port=url.port||(secure?'443':url.protocol==='http:'?'80':''),host=url.hostname,shown=url.port?`${host}:${url.port}`:host;return {address:url.toString(),host,port,hostPort:shown,secure,local:privateHost(host)};}
 catch{return {address:value,host:value,port:'',hostPort:value,secure:false,local:false};}
}
export function safeDestination(value:string){return describeDestination(value).address;}

/** SHA-256 fingerprints arrive as lowercase hex; show them the way certificate viewers do. */
export function formatFingerprint(value:string|null|undefined){const hex=(value||'').replace(/[^0-9a-f]/gi,'').toUpperCase();return hex.length===64?hex.match(/.{2}/g)!.join(':'):'';}
