import {useMemo} from 'react';
import {useFeedbackView,type FeedbackView} from '../../runtime/feedback';
import type {BrowserSnapshot} from '../../runtime/types';
import {cardName,cardRank,cardSince,formatCardNumber,type MemberCardData,type MemberRank} from './cardData';
import {certificateTier} from '../feedback/sealNumbers';

/** The member's own number and the month the rank was granted ('2026-11'), for every rank (the real member number and the real join month).
 * Sources, in this order: the signed certificate for an Insider or a Founding Contributor (Beta 14, earlier work: `view.insider.member`, also `feedbackService().insider.member(profileId)`),
 * then the member record the rank system keeps for every rank (`view.member`, supplied by earlier work). This adapter is the one place that knows those names. */
export interface MemberRecord{number:number|null;since:string|null}
const asRecord=(value:unknown):MemberRecord|null=>{
 const raw=value as {number?:unknown;since?:unknown}|null|undefined;
 if(!raw||typeof raw!=='object')return null;
 const number=typeof raw.number==='number'&&Number.isInteger(raw.number)&&raw.number>=1?raw.number:null,since=typeof raw.since==='string'&&/^\d{4}-(0[1-9]|1[0-2])/.test(raw.since)?raw.since:null;
 return number===null&&since===null?null:{number,since};
};
export function memberRecordOf(view:FeedbackView,rank:MemberRank):MemberRecord|null{
 const certificate=(rank==='insider'||rank==='founding')?asRecord((view as unknown as {insider?:{member?:unknown}}).insider?.member):null;
 return certificate??asRecord((view as unknown as {member?:unknown}).member);
}

/** The card a certificate gives, by its number: 'founding' (No. 1 to 100) or 'insider' (101 and up); null when the profile shows no certificate (or one with no readable number). */
export function certificateCardRank(view:FeedbackView):MemberRank|null{
 if(view.rank!=='insider'&&view.rank!=='founding')return null;
 const number=(view as unknown as {insider?:{member?:{number?:unknown}|null}}).insider?.member?.number;
 return certificateTier(typeof number==='number'?number:null);
}

/** What a profile's own card says, or null when it has no card (no rank and no Early Member mark, a private or Tor window, the contributor switch off, or no real number and month).
 * Never a number or a month nobody was given, never dashes, never "first drawn on this device". */
export function memberCardData(view:FeedbackView,profileName:string|undefined):MemberCardData|null{
 if(view.privateOrTor||view.off||view.key==='none')return null;
 // A certificate holder's card is decided by the certificate's NUMBER (public 14.4): 1 to 100 the white Founding card, 101 and up the black Insider card; never by `by`, and never by the rank word alone. The feedback service sends rank 'founding' or 'insider' for
 // a certificate holder; a profile that is neither (a rank from the points copy, Early Member) never reads the certificate here. Without a certificate the card policy decides as before.
 const rank=certificateCardRank(view)??cardRank(view);if(!rank)return null;
 const record=memberRecordOf(view,rank);
 // no real number and month (no record from the server and, for an Insider, no signed certificate) means NO card: nothing is printed as dashes and the welcome and the viewer offer none
 if(!record||record.number===null||record.since===null)return null;
 return{rank,name:cardName(profileName),since:cardSince(record.since),number:formatCardNumber(record.number)};
}
/** The one question every place that offers the card asks: does this profile have a card to show? */
export const hasMemberCard=(view:FeedbackView):boolean=>memberCardData(view,undefined)!==null;
export function useMemberCardData(state:BrowserSnapshot,profileId:string):MemberCardData|null{
 const view=useFeedbackView('member-card');
 const name=state.browserProfiles.find(profile=>profile.id===profileId)?.name;
 return useMemo(()=>memberCardData(view,name),[view,name]);
}
