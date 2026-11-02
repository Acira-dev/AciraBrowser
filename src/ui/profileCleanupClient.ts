import {runtime} from '../runtime/client';
import type {ProfileCleanupClient} from '../features/profile-privacy/cleanup-types';

export const profileCleanupClient:ProfileCleanupClient={
 async status(){const result=await runtime.service({type:'cleanup.status'});if(!result.cleanup||'cancelled'in result.cleanup)throw Error('Native cleanup status is unavailable.');return result.cleanup;},
 async set(choice){const result=await runtime.service({type:'cleanup.set',choice});if(!result.cleanup)throw Error('The native cleanup choice could not be verified.');return result.cleanup;}
};
