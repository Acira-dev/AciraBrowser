/* Beta 14, the member cards: what a card says. Pure functions, no DOM: the renderer (./renderer) draws it, ./MemberCard.tsx shows it. */
export type MemberRank='early'|'contributor'|'trusted'|'insider'|'founding';
export const MEMBER_RANKS:readonly MemberRank[]=['early','contributor','trusted','insider','founding'];
/** The canvas is this many times the card (and member-card.css makes it so): his shadow (a blurred plate behind the card, offset down and right, moving with the tilt) is drawn inside it and is under 0.4 % opaque at its border, measured over nine poses, so nothing is cut (Rule 12). 1.2 left a step of 22 %. */
export const CARD_MARGIN=2;
/** "Your card" is the window's height less 120 px at most (src/ui/popup.ts), 620 px high when it fits: the card is 264 px wide with 224 px around it (194 in the compact form of a small window), and takes what is left below that, never under 112 px wide. The popup's opening height and the card's width come from this one rule, so the popup does not change height after it opens. */
export function memberCardLayout(viewportHeight:number):{width:number;height:number;compact:boolean}{
 const room=viewportHeight-120,compact=room<520,chrome=compact?194:224,width=Math.max(112,Math.min(264,Math.floor((room-chrome)/1.5)));
 return{width,compact,height:Math.round(chrome+width*1.5)};
}
export interface MemberCardData{rank:MemberRank;/** the profile's own name */name:string;/** the month the rank was granted, as the card prints it: "Nov 2026" (dashes when the data has none) */since:string;/** the member number as the card prints it: four digits with leading zeros, five when it needs them; null = none assigned yet (the card prints dashes) */number:string|null}

/** "Nov 2026" from the month the rank was granted ('2026-11', or a date or a timestamp): null when there is none. The card's lettering is English whatever the interface language: it is the artwork. */
export function formatSince(value:string|number|Date|null|undefined):string|null{
 let date:Date;
 if(typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])(-\d{2})?/.test(value)){const [year,month]=value.split('-').map(Number);date=new Date(Date.UTC(year,month-1,15));}
 else if(value instanceof Date)date=value;
 else if(typeof value==='number'&&Number.isFinite(value))date=new Date(value);
 else return null;
 if(Number.isNaN(date.getTime()))return null;
 return new Intl.DateTimeFormat('en-US',{month:'short',year:'numeric',timeZone:'UTC'}).format(date);
}
/** The number as printed: 42 -> "0042", 12345 -> "12345". Null, zero, negative or not a whole number: null (no number). */
export function formatCardNumber(value:number|string|null|undefined):string|null{
 const n=typeof value==='string'?(/^\d{1,9}$/.test(value.trim())?Number(value):NaN):value;
 if(n===null||n===undefined||!Number.isInteger(n)||n<1)return null;
 return String(n).padStart(4,'0');
}
/** What the card prints when the data it needs is missing (a defensive state: the rank system gives every rank a number and a month): dashes, never a number or a month nobody was given. */
export const NO_NUMBER='----';
export const cardSince=(value:Parameters<typeof formatSince>[0]):string=>formatSince(value)??NO_NUMBER;
/** A name for the card: one line, no control characters, at most 60 characters; an empty one is "Member". */
export function cardName(value:string|null|undefined):string{
 const text=(value??'').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g,' ').replace(/\s+/g,' ').trim();
 return [...text].slice(0,60).join('')||'Member';
}
/** WHO GETS A CARD, in one place (reported 16 Nov 21:35 and 21:40): for now only the Founding Contributor card is given. Every profile with a valid Insider certificate shows the Founding rank (the feedback service's view(),
 * so the card is the certificate holder's: the certificate's number and month, the profile's own name), and a profile set to Founding by hand has it too. Every other state has NO card: Early Member, Contributor and
 * Trusted, and an 'insider' rank from the points copy without a certificate (shown as Trusted). Nothing else shows a card then: the welcome's card step, the viewer's "Your card" row and Share all ask cardRank().
 * Public 14.4 (24 Nov): a certificate holder's card is decided by the certificate's number (useMemberCardData.ts certificateCardRank, the boundary in feedback/sealNumbers.ts): No. 1 to 100 the Founding card, 101 and up the black Insider card, which was already in the renderer
 * and is used as it is; `ranks` below stays the policy for a profile WITHOUT a certificate. The other three designs stay in the renderer, unused. To give them back, set `ranks` to MEMBER_RANKS: that is the whole change. */
export const CARD_POLICY:{readonly ranks:readonly MemberRank[]}={ranks:['founding']};
/** The card of a profile's highest rank (Early Member is the card of a profile with the mark and no rank, the plan), when CARD_POLICY gives that rank a card; else null. */
export function cardRank(view:{rank:'contributor'|'trusted'|'insider'|'founding'|null;mark:'earlyMember'|null}):MemberRank|null{
 const rank:MemberRank|null=view.rank??(view.mark==='earlyMember'?'early':null);
 return rank!==null&&CARD_POLICY.ranks.includes(rank)?rank:null;
}
export function describeCard(data:MemberCardData):string{
 return `${data.rank} ${data.name} ${data.since} ${data.number??''}`.trim();
}
/** A file name for the card: "Acira-Insider-Alex" (letters and digits of any script; everything else becomes a dash; at most 40 characters of the name). */
export const cardFileName=(rank:string,name:string)=>`Acira-${rank[0].toUpperCase()}${rank.slice(1)}-${name.normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,40)||'Member'}`;
