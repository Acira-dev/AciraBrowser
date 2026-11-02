import type {WebsiteAuthClient} from '../features/WebsiteAuthDialog';
import {runtime} from '../runtime/client';

// The web preview has no native HTTP-authentication challenges.
export const websiteAuthClient:WebsiteAuthClient={
 snapshot:()=>runtime.websiteAuth?.({type:'snapshot'}).then(value=>'requests' in value?value:{revision:0,requests:[]})??Promise.resolve({revision:0,requests:[]}),
 subscribe:listener=>runtime.subscribeWebsiteAuth?.(listener)??(()=>{}),
 respond:response=>runtime.websiteAuth?.({type:'respond',response}).then(value=>'ok' in value?value:{ok:false,code:'INVALID_RESPONSE'})??Promise.resolve({ok:false,code:'UNAVAILABLE'})
};
