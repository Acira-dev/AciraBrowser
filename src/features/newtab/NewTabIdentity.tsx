import type {CSSProperties} from 'react';
import {ProfileAvatar} from '../accounts/profileModel';
import {NoelHat} from '../../season/NoelHat';
import {Seal} from '../feedback/Seal';
import {rankName} from '../feedback/words';
import type {Rank} from '../../runtime/feedback';
import '../../styles/new-tab-identity.css';

/** Beta 14/AI on the new tab page (17 Nov, the team: the centre block, a second big picture with the name twice and a rank pill, "ruined" the page that 13.10 kept clean): ONE picture, ONE name.
 * The profile picture is the one in the page's header chip (top right, where 13.10 had it): when the profile has a rank it wears its rank's flat ring (src/styles/rank-ring.css, 1.5 px with a 2 px gap
 * at this 28 px size, as the ring file says for pictures under 72 px) and the rank's seal sits on that ring as a small token (the shared small seal, 16 px). The rank word is the house tooltip's second
 * line, under the name, and the screen reader hears it: the seal and the word always carry the rank, colour is never the only cue. This is the ONLY place the ring is drawn: the toolbar button, the
 * sidebar row and every panel stay plain. Nothing for a profile with no rank (Early Member has no ring; its seal shows in the viewer, the ranks and the welcome), and never in a private window.
 * It draws the two things INSIDE the chip's button (NewTabPage.tsx owns the button, the dot and the popup it opens). */
export const IDENTITY_SEAL=16;
/** New Tab's picture size for Noël's hat (season/noel.css --noel-pic). */
export const NT_HAT={'--noel-pic':'28px'} as CSSProperties;

/** The chip's tooltip: the name, and under it the rank word (tooltipParse.ts: a second line is the description). */
export const identityTitle=(name:string,rank:Rank|null)=>rank?`${name}\n${rankName(rank)}`:name;
/** What a screen reader hears for the chip: its own label, then the rank word. */
export const identityLabel=(label:string,rank:Rank|null)=>rank?`${label}. ${rankName(rank)}`:label;

/** `hat`: Noël is on (reported 24 Nov): the picture wears the sidebar foot's Santa hat, the same one scaled to 28 px (season/noel.css --noel-pic). Only the picture is wrapped, so the seal keeps its place on the chip. */
export function NewTabIdentity({profile,rank,hat=false}:{profile:{id:string;name:string;color?:string;avatar?:string|null;picture?:string|null};rank:Rank;hat?:boolean}){
 const pic=<ProfileAvatar profileId={profile.id} showRank name={profile.name} color={profile.color||'#6b7280'} avatar={profile.avatar} picture={profile.picture} size={28} className="nt-identity-avatar"/>;
 return <>
  {hat?<i className="noel-hatted" style={NT_HAT}>{pic}<NoelHat/></i>:pic}
  <Seal kind={rank} size={IDENTITY_SEAL} className="nt-identity-seal"/>
 </>;
}
