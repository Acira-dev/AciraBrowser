import {runtime} from '../runtime/client';

export {canOfferContinue,exceptionMinutes} from './certificateOffer';

/** Ask the main process for a temporary exception scoped to this tab, host, port, certificate and profile.
 * The native side re-validates the ticket; nothing here widens or stores the exception. */
export async function continueAnyway(tabId:string,ticketId:string){
 await runtime.service({type:'certificates.continue',tabId,ticketId});
}

/** Remove the exception and reload, restoring normal verification. */
export async function revokeException(tabId:string){
 await runtime.service({type:'certificates.revoke',tabId});
}
