// The notice band on the new-tab page (Beta 14, brief sections C and D): one quiet card at the top of the page, above the workspace header and the search box.
// One card at a time. The usage notice (section C) is always first; the billboard (section D, earlier work) is the next source and shows only when the usage notice does not.
//
// HOW A SECOND KIND OF CARD SITS IN THE BAND (for the billboard):
//   1. Write a hook with the BandSource signature: `export function useBillboardCard(context: BandContext): BandCard | null`. Return null when there is nothing to show.
//   2. Add it to BAND_SOURCES in ./sources.ts, after useUsageNoticeCard. Nothing else in the band changes.
//   3. The band shows the first source that returns a card, draws it with the same entrance and exit (never a cut), and calls the card's handlers.
//   4. A card closes with the X (`onClose`: the source shows its own Undo toast through `context.dispatch`), with an action (`actions`), or by itself (the source returns null).
//      To show a short confirmation in the same card (usage notice: "Turned off"), return `confirmation` instead of title, body and actions.
import type { BrowserAction } from '../../../runtime/types';

export type BandStyle = 'default' | 'accent' | 'update' | 'noel';
export interface BandAction {
  id: string;
  label: string;
  onClick: () => void;
  /** 'link' (default) is a quiet text link; 'primary' is the card's one filled action. */
  tone?: 'link' | 'primary';
}
export interface BandCard {
  /** Stable and unique: 'usage' for the usage notice, the card's own id for a billboard card. A new id replaces the card with the entrance and exit animation. */
  id: string;
  kind: 'usage' | 'billboard' | 'noel';
  style: BandStyle;
  title: string;
  body: string;
  /** Noël's offer: a small line over the title (the season), the snowflake mark beside it, and one choice made on the card itself (a segmented control). */
  eyebrow?: string;
  choice?: { label: string; value: string; onChange: (value: string) => void; options: { id: string; label: string }[] };
  /** Up to two actions, drawn in this order after the body (see the usage notice: See exactly what we send, Turn off). */
  actions: BandAction[];
  /** The X. The source is responsible for what follows (the standard Undo toast). */
  onClose: () => void;
  closeLabel: string;
  /** Instead of title, body and actions: a one-line answer to an action just taken. The X stays. */
  confirmation?: { text: string; action?: BandAction };
}
export interface BandContext {
  dispatch: (action: BrowserAction) => void;
  /** Motion is reduced or off: the band fades quickly instead of moving. */
  reduced: boolean;
  /** Open an address in this tab's workspace the way the page's own links do (acira:// pages and https://acirabrowser.com only for the billboard). */
  navigate: (url: string) => void;
  /** Noël is on (its offer shows only while it is off). */
  noelOn?: boolean;
}
export type BandSource = (context: BandContext) => BandCard | null;
