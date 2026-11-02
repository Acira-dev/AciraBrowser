import type {CertificateStatus} from '../runtime/types';

/** How long a deliberate exception lasts. Mirrors the native policy's default (certificate-policy.cjs, `ttlMs`). */
export const exceptionMinutes=5;

type Failure=NonNullable<CertificateStatus['failure']>;

/** Continue is offered only when native says this exact warning is overridable and it is still fresh and for this page. */
export function canOfferContinue(status:CertificateStatus|undefined,tabError:string|null|undefined,tabUrl:string,now=Date.now()):status is CertificateStatus&{failure:Failure}{
 const failure=status?.failure;
 if(!failure||!failure.canContinue||!failure.ticketId||failure.expiresAt<=now)return false;
 if(!tabError||!/CERT_|SSL_|TLS_/.test(tabError))return false;
 try{return new URL(failure.url).origin===new URL(tabUrl).origin;}catch{return false;}
}
