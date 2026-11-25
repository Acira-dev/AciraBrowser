import {t} from '../../i18n';
import {useProfileRing} from '../../runtime/feedback';
import './feedback.css';

/** The small quiet dot on a profile button while something waits in the profile viewer (a note, or after the aura). It is gone once the viewer has been opened. The button must be position:relative. */
export function ProfileDot({profileId}:{profileId?:string}){
 const ring=useProfileRing(profileId);
 /* An <i>, not a <span>: the profile buttons restyle every span inside them (the avatar rule), which would turn the dot into a second avatar. */
 return ring.dot?<i className="fb-dot" role="img" aria-label={t('feedback.dot')}/>:null;
}
