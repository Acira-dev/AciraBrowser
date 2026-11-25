// @ts-nocheck
// Beta 14 member cards: the Insider and Founding tokens carry the member's own number on the rim (the token art must be re-lettered per member, or the number drawn live).
// Method and glyphs come from the seal numbers (src/features/feedback/sealNumbers.ts SEAL_DESIGN): the original coin renderer
// (seal4.js, ink4.js) draws the design the rank now stands for (Insider = the black 'founding' design, Founding = the compass 'insider' design) at its rest pose, and ONLY the words of the rim legend
// change, in place, each centred where the old word was. The Insider token is then toned to platinum, as the pack's token_insider.png is.
import { renderCoin } from './seal4.js';
import { LEGEND, setRelabel } from './ink4.js';
import { toneSeal } from './cards15.js';

/** The app's rank -> his design, what the legend said in his file (checked before anything is changed) and what it says now. */
const DESIGN = {
  insider: { design: 'founding', was: ['ACIRA', 'FOUNDING CONTRIBUTOR', 'No. 0001', 'EST. 2026', 'AUTHENTIC'], words: (no) => ['ACIRA', 'INSIDER', no, 'EST. 2026', 'AUTHENTIC'] },
  founding: { design: 'insider', was: ['ACIRA', 'INSIDER', 'CERTIFIED MEMBER', 'No. 0001', 'EST. 2026', 'AUTHENTIC'], words: (no) => ['ACIRA', 'FOUNDING', 'CERTIFIED MEMBER', no, 'EST. 2026', 'AUTHENTIC'] },
};
const PLATINUM = '#c9ccd3';
const done = new Map();

/** The token's picture (a 1024 px canvas) for `rank` ('insider' | 'founding') with the member's number as the card prints it ('0042', '12345', '----'). */
export function memberToken(rank, number) {
  const d = DESIGN[rank]; if (!d) throw new Error('only Insider and Founding tokens carry a number');
  const key = `${rank}:${number}`; if (done.has(key)) return done.get(key);
  if (JSON.stringify(LEGEND[d.design]) !== JSON.stringify(d.was)) throw new Error('his legend is not what it was: ' + JSON.stringify(LEGEND[d.design]));
  const now = d.words(`No. ${number}`);
  setRelabel((groups) => (JSON.stringify(groups) === JSON.stringify(d.was) ? now : null));
  let coin;
  try { coin = renderCoin({ rank: d.design, look: d.design, px: 1024, ss: 2, rotX: 0, rotY: 0 }); } finally { setRelabel(null); }
  const token = rank === 'insider' ? toneSeal(PLATINUM, coin) : coin;
  if (done.size > 6) done.delete(done.keys().next().value);
  done.set(key, token); return token;
}
