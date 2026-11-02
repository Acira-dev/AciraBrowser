import { TorGlyph } from '../features/tor/TorChip';

import { t } from '../i18n';
/** F's domino mask, as G's sidebar draws it, so a private tab carries one mark everywhere. */
const PrivateMask=({size=14}:{size?:number})=><svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true"><path d="M1.75 6.25c0-1.1.9-1.75 2-1.75h8.5c1.1 0 2 .65 2 1.75v1c0 2.3-1.5 4-3.4 4-1.2 0-1.9-.7-2.85-1.9-.95 1.2-1.65 1.9-2.85 1.9-1.9 0-3.4-1.7-3.4-4z"/><path d="M4.5 7.5h1.75M9.75 7.5h1.75" strokeLinecap="round"/></svg>;

/** A private tab's mask or a Tor tab's onion, in the tab's mark colour (strip, compact strip and sidebar alike). Both are plain
 * stroke glyphs at every size (R3-59): the dot matrix is only Tor's connecting pattern in the address field, never a picture. */
export function TabPrivacyMark({privacy,size=14,className='tab-privacy-mark'}:{privacy:'private'|'tor';size?:number;className?:string}){
 return <span className={className} aria-hidden="true">{privacy==='tor'?<TorGlyph size={size}/>:<PrivateMask size={size}/>}</span>;
}

/** The new-tab state has no site icon of its own: there the mark takes the icon's place. */
export const isNewTabState=(url:string)=>url==='acira://new'||url==='acira://home'||url==='';
export const privacyNames={private:{label:t("tabprivacymark.privateTab"),tip:'private tab, nothing from it is kept'},tor:{label:t("tabprivacymark.torTab"),tip:'Tor tab, hides your IP address from sites'}} as const;
