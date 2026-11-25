/** Beta 14 (15 Nov 22:37): the Insider and Founding Contributor seals CHANGED PLACES. Insider now wears the BLACK design (ceramic with real gold, the Acira mark: the design his
 * renderer and his sprites call 'founding'), lettered INSIDER; Founding Contributor wears the mirror-silver COMPASS design with the full-spectrum foil (his 'insider'), lettered FOUNDING. The other three
 * are unchanged. The files in public/seals are named by the rank they now stand for: H_insider.png is the cards pack's H_founding_as_insider.png (black, INSIDER, No. 0001) and H_founding.png its
 * H_insider_as_founding.png (compass, FOUNDING, No. 0003); the small forms carry no lettering and are his own, swapped (small_insider_64.png is his small_founding_64.png and the other way round).
 * Anything that draws a seal with his renderer (the welcome's live coin, the render rig) renders SEAL_DESIGN[rank] and letters the rim for the rank. */
export const SEAL_DESIGN = Object.freeze({ contributor: 'contributor', early: 'early', trusted: 'trusted', insider: 'founding', founding: 'insider' } as const);
/** The number lettered on each plain picture (the pack's: Insider No. 0001, Founding No. 0003). The look-closer frames are that same coin turned. */
export const PLAIN_NUMBER: Readonly<Record<'insider' | 'founding', number>> = Object.freeze({ insider: 1, founding: 3 });
/** AH rule 2 (reported 15 Nov: "of course each Insider should get his own number"; 19:40: the Mac render of HIS renderer "looks perfect"): the member's own seal. His renderer draws the rim legend; the
 * per-number seals were rendered on this Mac with his renderer and settings, changing ONLY the rim's words, in place, as the pack re-lettered its two (a QA rig), at the
 * rest pose of his sprite, at 672 px (224 CSS px x 3: the largest size the app draws a seal), shipped as public/seals/H_<rank>_<NNNN>.webp, their SHA-256 in public/seals/NUMBERED.sha256
 * (tests/seals-exact.test.cjs checks every one). His small form (drawSmall) carries no legend, so there is no per-number small file: below 48 px the small sprite is the member's seal too.
 * This is the highest number rendered for each kind, contiguous from 1 (Beta 14.2, D127: Founding 1-100; before, 1-10, and a member above it saw No. 0003). Above it the seal is drawn by the live coin at its rest pose (sealRest.ts), never by the plain supplied sprite, which reads another member's number. The app never draws a number itself: the coin's rim is lettered by his renderer's own code. */
export const NUMBERED_SEALS: Readonly<Record<'insider' | 'founding', number>> = Object.freeze({ insider: 60, founding: 100 });
/** "Look closer": nine pre-rendered frames per rank (public/seals/tilt/<kind>/t0..t8.webp), his renderer with HIS strip's camera tilt (rotX -0.08) and light, rotY -0.42 to 0.42 in nine even steps
 * (Insider and Founding: the plain picture's coin, PLAIN_NUMBER). */
export const TILT_FRAMES = 9;

/** The membership rule, in ONE place (public 14.4, 24 Nov): a certificate numbered 1 to FOUNDING_LAST is a Founding Contributor (the white card, the compass seal, "You're a Founding Contributor"); a certificate numbered above it is an Insider
 * (the black card, the black seal, "You're an Insider"). The number alone decides: never the certificate's `by` field (the team' personal links and invites both exist in both tiers). The server draws the same line (the Founding counter stops
 * at 100, the open counter starts above it). The main process cannot import this file, so desktop/insider/membership-tier.cjs holds the same number and tests/membership-service.test.cjs pins the two together. */
export const FOUNDING_LAST = 100;
export type CertificateTier = 'founding' | 'insider';
/** The tier of a certificate's number, or null when it is not a number a certificate can carry (not a whole number of at least 1). */
export const certificateTier = (number: number | null | undefined): CertificateTier | null => (typeof number === 'number' && Number.isInteger(number) && number >= 1 ? (number <= FOUNDING_LAST ? 'founding' : 'insider') : null);
