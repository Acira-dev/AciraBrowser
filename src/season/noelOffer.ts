/**
 * Noël's offer (the 14.3 rule): one card, once a season, only from 1 December to 6 January (local time), to a person who has not turned Noël on.
 * It never switches anything on by itself: only "Turn it on" does. "Not now" and the X answer it for this season; next December asks again.
 * The answer is kept in the interface's own storage (every window of the profile reads the same), as the season's year: the December's year (6 January 2027 belongs to 2026).
 */
export const OFFER_KEY = 'acira-noel-offer';

/** The season a date falls in (the December's year), or null outside 1 December to 6 January. */
export function offerSeason(now: Date): number | null {
  const m = now.getMonth(), d = now.getDate();
  if (m === 11) return now.getFullYear();
  if (m === 0 && d <= 6) return now.getFullYear() - 1;
  return null;
}
/** Whether the card is due: in the season, Noël off, and this season not answered yet. */
export function offerDue(now: Date, noelOn: boolean, answered: number | null): boolean {
  const season = offerSeason(now);
  return season !== null && !noelOn && answered !== season;
}
export function readAnswer(): number | null {
  try { const v = Number(localStorage.getItem(OFFER_KEY)); return Number.isInteger(v) && v > 2000 ? v : null; } catch { return null; }
}
export function writeAnswer(now: Date): void {
  const season = offerSeason(now); if (season === null) return;
  try { localStorage.setItem(OFFER_KEY, String(season)); window.dispatchEvent(new Event(OFFER_KEY)); } catch { /* it asks again on the next new tab, at worst */ }
}
