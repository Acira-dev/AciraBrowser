// @ts-nocheck
// The pictures the cards print: the rank seals (tokens) and the Founding number's foil patches. Bundled with the app; nothing is fetched.
// Lossless WebP of the pack's own PNG files (the rank badges, the two re-lettered seals, the four foil patches): the pixels are the same.
import early from '../assets/seal_early.webp';
import contributor from '../assets/seal_contributor.webp';
import trusted from '../assets/seal_trusted.webp';
import founding from '../assets/seal_founding.webp';       // tokens/token_founding.png: the colour holo compass, lettered FOUNDING (white card)
import insider from '../assets/seal_insider.webp';       // tokens/token_insider.png: the black Insider token (the platinum-toned seal), exactly as the pack has it
import foil0 from '../assets/foil_digit_0.webp';
import foil1 from '../assets/foil_digit_1.webp';
import foil2 from '../assets/foil_digit_2.webp';
import foil3 from '../assets/foil_digit_3.webp';
export const SEALS = { early, contributor, trusted, founding, insider };
export const FOIL_DIGITS = [foil0, foil1, foil2, foil3];
