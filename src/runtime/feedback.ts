import {useEffect,useSyncExternalStore} from 'react';

/* Beta 14 section E, the interface's side of desktop/feedback/feedback-service.cjs. The interface never holds a secret or a server answer of its own: it asks main
   ('acira:feedback', window.acira.feedback) and shows what main's view says. Main tells every window when a profile's copy changes ('feedback-changed'). */

export type Rank='contributor'|'trusted'|'insider'|'founding';
export const RANKS:readonly Rank[]=['contributor','trusted','insider','founding'];
export type ReportKind='bug'|'idea';
export type ReportCategory='broken'|'looks'|'crash'|'site';
export const CATEGORIES:readonly ReportCategory[]=['broken','looks','crash','site'];
export interface FeedbackNote{id:string;kind:'accepted'|'shipped';reportId:string|null;points:number|null;rank:Rank|null;askName:boolean;release:string|null;at:string|null}
export interface FeedbackReport{id:string;kind:ReportKind;snippet:string;at:string|null;status:'received'|'working'|'fixed';release:string|null}
export interface FeedbackView{
 /** The server's addresses are set in this build: Send is offered only then. Marks, ranks and the viewer work without. */available:boolean;
 /** The switch in Settings: hides points, rank, ring, the aura and notes. Report status still works. */off:boolean;
 key:'ready'|'unreadable'|'none';privateOrTor:boolean;engaged:boolean;
 mark:'earlyMember'|null;rank:Rank|null;points:number;
 /** The member record of the card this profile shows (its top rank, else the Early Member mark): the number the server issued where the rank was granted and the month ('2026-11'); null until the server has issued one (the card prints dashes). */member:{number:number;since:string}|null;
 /** What the next rank needs, from the server's own thresholds ("19 points away from Trusted Contributor"); away is null when it is not about points (the first accepted report). */next:{rank:Rank;away:number|null}|null;
 thresholds:{trusted:number;insider:number}|null;thresholdsKnown:boolean;
 notes:FeedbackNote[];reports:FeedbackReport[];dot:boolean;inviteUrl?:string;
 /** The aura this profile is owed ('earlyMember', 'rank:<rank>' or 'points:<total>': the bubble for accepted reports that only add points), null when none or when the switch is off. */aura:string|null;
 /** Rank emblems (a proposal under review): which drawing the rank marks use, or null for the quiet dots. Only a test profile can name one (desktop/feedback/feedback-service.cjs); no shipped build does. */emblem:'hybrid'|'mark'|'etched'|'ring'|null;
 /** Beta 14, the Insider programme (desktop/insider/insider-service.cjs). `available` is false while no server is named: then nothing about the programme is shown anywhere. */insider:InsiderView;
}
/** The one-time Beta 14 welcome's steps: welcome, what is new, "We've got something for you", the person's seal (Insider on an Insider profile, otherwise Early Member), their card, Done. No code step: a code is only for an invite. */
export type WelcomeStep='welcome'|'new'|'something'|'seal'|'card';
export const WELCOME_STEPS:readonly WelcomeStep[]=['welcome','new','something','seal','card'];
/** Always null since the final design (15 Nov 18:07): the 16:40 build-time activation is gone. Kept in the type so older readers still compile. */
export type Activation=null;
/** THE INSIDER STATE THE WELCOME (section AL) AND EVERY SCREEN READ: present only while the profile holds a valid certificate (signed by a shipped key, for this profile's own key). `since` is a month
 * ('2026-11'); `by` is 'founding-team' or 'member' (null when the certificate names neither); `perks` holds only the perks this version knows. Certificates never expire. */
export interface InsiderMember{tier:'insider';number:number;since:string;by:'founding-team'|'member'|null;perks:string[]}
export interface InsiderView{available:boolean;insider:boolean;member:InsiderMember|null;/** True when the member is the install's numbered profile's, shown here for display only (one person = one number): no actions on this profile. */borrowed?:boolean;invitesLeft:number|null;/** B1 (17 Nov): false while invites are not open yet (insider-config.cjs invitesOpen): the invite pop-up shows a disabled button and a note, and the menu row drops its count. */invitesOpen:boolean;/** Public 14.4: whether the server has said anything about its invites yet this run (the invites list's own `invitesOpen`): until it has, the invites screen waits for the answer instead of showing a closed note. */invitesAsked?:boolean;channel:{offered:boolean;on:boolean};reveal:boolean;welcome:{owed:boolean;step:WelcomeStep|null};activation:Activation;closed:null}
/** The activation sheet's question (a personal link was opened in this window): never the link itself, which stays in main. */
export interface InsiderOffer{state:'ask'|'working'|'done';result:CodeResult|'busy'|null;retry:boolean;waitSeconds:number|null;profileId:string;profile:{name:string;color:string;avatar:string|null;picture:string|null}|null;member:InsiderMember|null}
export const NO_INSIDER:InsiderView={available:false,insider:false,member:null,invitesLeft:null,invitesOpen:false,invitesAsked:false,channel:{offered:false,on:false},reveal:false,welcome:{owed:false,step:null},activation:null,closed:null};
export type CodeResult='ok'|'invalid'|'used'|'expired'|'revoked'|'rate_limited'|'offline'|'clock'|'unavailable';
export interface InviteRow{id:string;state:'unused'|'used'|'expired';code:string;createdAt:string|null;usedAt:string|null}
export type InsiderFlowName='welcome'|'code'|'invites'|'seal'|'reveal'|'activate'|'card';
export interface InsiderResult{view?:InsiderView;result?:CodeResult|'none_left'|'busy'|'closed';local?:boolean;retry?:boolean;waitSeconds?:number|null;code?:string;invitesLeft?:number|null;/** the invites list's own answer about the server's switch (a missing field in the server's answer reads as false) and the member's total (3 for No. 1 to 100, else 2) when the server sends it */invitesOpen?:boolean;invitesTotal?:number;invites?:InviteRow[];ok?:boolean;claimed?:boolean;flow?:InsiderFlowName;offer?:InsiderOffer|null}

export const NO_FEEDBACK:FeedbackView={available:false,off:false,key:'none',privateOrTor:false,engaged:false,mark:null,rank:null,member:null,points:0,next:null,thresholds:null,thresholdsKnown:false,notes:[],reports:[],dot:false,aura:null,emblem:null,insider:NO_INSIDER};

export interface DraftFile{id:string;kind:'image'|'video';format:string;type:string;size:number;sha256:string;seconds?:number}
export type FailureKind='offline'|'later'|'clock'|'private'|'unavailable'|'nokey'|'invalid';
export interface PreviewPayload{schema:2;kind:ReportKind;category:ReportCategory|null;text:string;appVersion:string;channel:string;platform:string;details:Record<string,string>|null;attachments:{index:number;kind:'image'|'video';name:string;type:string;bytes:number;sha256:string;seconds?:number}[]}
export type FeedbackRequest=
 |{type:'feedback.state'|'feedback.rings'|'feedback.opened'|'feedback.refresh'|'feedback.pick'|'feedback.draft-clear'|'feedback.delete-data'}
 |{type:'feedback.preview'|'feedback.send';kind:ReportKind;category?:ReportCategory|null;text?:string;details?:boolean}
 |{type:'feedback.attach';data:Uint8Array}
 |{type:'feedback.card-share';action:'copy'|'picture'|'video';data:Uint8Array;name?:string}
 |{type:'feedback.card-share';action:'copy-pixels';data:Uint8Array;width:number;height:number}
 |{type:'feedback.draft-file'|'feedback.draft-remove';id:string}
 |{type:'feedback.thanks';noteId:string;name:string|null}
 |{type:'feedback.note-seen';id:string}
 |{type:'feedback.aura-play';anchor:{avatar:{x:number;y:number;width:number;height:number};toolbarBottom:number|null;scale:number;size:{width:number;height:number}};color:string;appearance:'dark'|'light';seamless:boolean;hideable:boolean;buttonVisible:boolean}
 |{type:'feedback.aura-ring-up'}
 /** The new-tab page's aura tip was shown and closed (A4, 17 Nov): `id` is the aura it stood for ('earlyMember' or 'rank:<rank>'). */
 |{type:'feedback.aura-tip';id:string}
 |{type:'feedback.aura-follow';visible:boolean;anchor:{avatar:{x:number;y:number;width:number;height:number};toolbarBottom:number|null;scale:number;size:{width:number;height:number}}|null}
 |{type:'feedback.set-off';off:boolean};
export type InsiderRequest=
 |{type:'insider.state'|'insider.opened'|'insider.invite'|'insider.invites'|'insider.reveal-seen'|'insider.welcome-claim'|'insider.welcome-done'|'insider.reveal-claim'|'insider.reveal-release'|'insider.flow-take'|'insider.offer'|'insider.activate'|'insider.decline'}
 |{type:'insider.redeem';code:string}
 |{type:'insider.channel';on:boolean}
 |{type:'insider.flow-set';flow:Exclude<InsiderFlowName,'activate'>}
 |{type:'insider.welcome-step';step:WelcomeStep};
export interface FeedbackResult{
 view?:FeedbackView;emblem?:FeedbackView['emblem'];rings?:Record<string,ProfileRing>;
 available?:boolean;reason?:string;payload?:PreviewPayload|null;error?:string;files?:DraftFile[];ok?:boolean;sent?:boolean;failure?:FailureKind;attachmentsFailed?:number;
 path?:string;id?:string;open?:string;played?:boolean;followed?:boolean;ringUp?:boolean;reasons?:string[];record?:DraftFile;data?:Uint8Array;results?:{ok:boolean;reason?:string}[];
}
interface Bridge{feedback?:(request:FeedbackRequest|InsiderRequest)=>Promise<{feedback:FeedbackResult;insider?:InsiderResult}>;subscribeBrowser?:(listener:(event:{type:string;profileId?:string})=>void)=>()=>void}
const bridge=():Bridge|undefined=>(typeof window==='undefined'?undefined:(window as unknown as {acira?:Bridge}).acira);

/** One request to main. Without the desktop bridge (a browser preview) every call answers as "not available". */
export async function feedbackCall(request:FeedbackRequest):Promise<FeedbackResult>{
 const api=bridge();
 if(!api?.feedback)return {view:NO_FEEDBACK,rings:{},available:false,failure:'unavailable'};
 return (await api.feedback(request)).feedback;
}

/** One Insider request to main (the same route as the feedback ones). Without the desktop bridge every call answers as "not available". */
export async function insiderCall(request:InsiderRequest):Promise<InsiderResult>{
 const api=bridge();
 if(!api?.feedback)return {view:NO_INSIDER,result:'unavailable'};
 return (await api.feedback(request)).insider??{view:NO_INSIDER,result:'unavailable'};
}

// --- the active profile's view, shared by everything on this page ---------------------------------------------------------------------------------
let current:FeedbackView=NO_FEEDBACK,loading=false,wired=false;
const listeners=new Set<()=>void>();
const publish=(next:FeedbackView)=>{current=next;for(const listener of [...listeners])listener();};
export const setFeedbackView=publish;
/** The view as it is now, without subscribing (for sizes). */
export const peekFeedbackView=():FeedbackView=>current;
/** Asks main for this window's profile again (after an event, or when a component that shows it mounts). */
export function reloadFeedback(){
 if(loading)return;loading=true;
 void feedbackCall({type:'feedback.state'}).then(result=>{if(result.view)publish(result.view);}).catch(()=>{}).finally(()=>{loading=false;});
}
function wire(){
 if(wired)return;wired=true;
 try{bridge()?.subscribeBrowser?.(event=>{if(event.type==='feedback-changed'){reloadFeedback();reloadRings();}});}catch{/* a preview has no events */}
}
/** The profile the window shows (the active tab's) can change; `key` makes the view load again when it does. */
export function useFeedbackView(key:string|null=''):FeedbackView{
 useEffect(()=>{if(key===null)return;wire();reloadFeedback();},[key]);
 return useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},()=>current,()=>current);
}
/** Beta 14: THE ONE READ API for "this profile's Insider state" (the welcome of section AL reads it): the member from a valid certificate, or null (no certificate, a private or Tor window,
 * the programme hidden). Main's side is `feedbackService().insider.member(profileId)` (desktop/insider/insider-service.cjs); this is the same object for the window's profile. */
export function useInsiderMember(key:string|null=''):InsiderMember|null{return useFeedbackView(key).insider.member;}
/** "November 2026" from the certificate's month ('2026-11'), in the interface's language. */
export function insiderSinceText(since:string):string{const match=/^(\d{4})-(\d{2})$/.exec(since);if(!match)return since;try{return new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric',timeZone:'UTC'}).format(Date.UTC(Number(match[1]),Number(match[2])-1,1));}catch{return since;}}
/** Runs a request that returns a new view and shows it. */
export async function feedbackAct(request:FeedbackRequest):Promise<FeedbackResult>{
 const result=await feedbackCall(request);
 if(result.view)publish(result.view);
 return result;
}

// --- every profile's ring (from the local copies), for the pictures in the profile list, the toolbar and the new tab page -----------------------------
/** What a profile's row shows (B2): its rank and mark, the quiet dot, and its points (null: nothing is shown for it: the switch is off or the key cannot be read; absent in an older answer). */
export type ProfileRing={rank:Rank|null;mark:'earlyMember'|null;dot:boolean;points?:number|null};
type Rings=Record<string,ProfileRing>;
let rings:Rings={},ringsLoading=false,ringsAt=0;
const ringListeners=new Set<()=>void>();
/** Asks main for every profile's ring. A picture mounting asks too, but not again within two seconds of the last answer; an event ('feedback-changed') always asks. */
export function reloadRings(force=true){
 if(ringsLoading||(!force&&Date.now()-ringsAt<2000))return;ringsLoading=true;
 void feedbackCall({type:'feedback.rings'}).then(result=>{ringsAt=Date.now();if(result.rings&&Object.keys(result.rings).length){rings=result.rings;for(const listener of [...ringListeners])listener();}}).catch(()=>{}).finally(()=>{ringsLoading=false;});
}
/** What a profile's picture wears: the rank ring (Contributor and up, none for Early Member) and whether the quiet dot shows. Nothing for an unknown profile or a private context. */
/** For tests and previews: sets every profile's ring without asking main. */
export function setProfileRings(next:Rings){rings=next;for(const listener of [...ringListeners])listener();}
const NO_RING={rank:null,mark:null,dot:false} as const;
export function useProfileRing(profileId?:string):ProfileRing{
 useEffect(()=>{if(!profileId)return;wire();reloadRings(false);},[profileId]);
 const all=useSyncExternalStore(listener=>{ringListeners.add(listener);return()=>{ringListeners.delete(listener);};},()=>rings,()=>rings);
 return (profileId&&all[profileId])||NO_RING;
}

// --- words ---------------------------------------------------------------------------------------------------------------------------------------
/** Chips that are not in the profile viewer lists need no state: a tiny helper for a clock-free "n points" figure. */
export const rankIndex=(rank:Rank|null)=>rank?RANKS.indexOf(rank):-1;
/** The ring colour is a CSS variable per rank. The four colours are OPEN (the brief): the variables are unset by default, and these names are the one place to set them. */
export const ringVar=(rank:Rank)=>`--acira-rank-ring-${rank}`;
