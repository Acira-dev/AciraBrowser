import { useCallback, useEffect, useState } from 'react';
import { runtime } from '../runtime/client';
import type { NativeRequest } from '../runtime/nativeCore';

/** The card main gives the new-tab page (desktop/browser-services/billboard.cjs, `view`): text and links already chosen for this language and already checked. */
export interface BillboardCardModel {
  id: string;
  style: 'default' | 'accent' | 'update';
  urgent: boolean;
  title: string;
  body: string;
  cta: { label: string; link: string } | null;
  secondary: { label: string; link: string } | null;
  /** When the card ends by itself (ms): its endsAt, or its maxAge after its first display, whichever is first; null while it has neither. The page looks again then. */
  expiresAt: number | null;
}
type Answer = { billboard?: BillboardCardModel | null };
export type BillboardClose = 'x' | 'cta' | 'secondary';

const ask = async (request: NativeRequest): Promise<BillboardCardModel | null> => {
  try { return ((await runtime.native?.(request)) as unknown as Answer | undefined)?.billboard ?? null; } catch { return null; }
};
/** The longest a timer may wait (setTimeout keeps 32 bits). */
const LONGEST = 2 ** 31 - 1;
const same = (a: BillboardCardModel | null, b: BillboardCardModel | null) => JSON.stringify(a) === JSON.stringify(b);

// One copy of the card for the whole window: the last answer main gave, and every page that shows it. A new tab starts from it, so a card that is already
// showing is drawn on the page's first frame (it never plays its entrance again at every new tab), and one closed elsewhere is corrected as soon as main says so.
let known: BillboardCardModel | null = null;
let listening = false;
const listeners = new Set<(card: BillboardCardModel | null) => void>();
const publish = (next: BillboardCardModel | null) => { known = next; for (const listener of listeners) listener(next); };
const listen = () => {
  if (listening) return; listening = true;
  runtime.subscribeBrowser?.((event) => { if ((event as { type: string }).type === 'billboard-changed') void ask({ type: 'billboard.current' }).then(publish); });
};
const look = () => ask({ type: 'billboard.current' }).then(publish);

/**
 * The billboard card for this page: read from main's saved copy when the page opens (never the network), again when main says it changed ('billboard-changed': another
 * window closed it, a new file arrived) and when the card's time is up. `enabled` false (a private or Tor page, the usage notice on screen) asks for nothing and shows nothing.
 * `shown` tells main the card is on screen (it starts the card's clock the first time); `close` ends it (X, or a click on one of its links).
 */
export function useBillboard(enabled: boolean) {
  const [card, setCard] = useState<BillboardCardModel | null>(() => (enabled ? known : null));
  useEffect(() => {
    if (!enabled) { setCard(null); return; }
    const listener = (next: BillboardCardModel | null) => setCard((now) => (same(now, next) ? now : next));
    listen(); listeners.add(listener); listener(known); void look();
    return () => { listeners.delete(listener); };
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !card || card.expiresAt === null) return;
    const timer = window.setTimeout(() => void look(), Math.min(Math.max(card.expiresAt - Date.now() + 50, 50), LONGEST));
    return () => window.clearTimeout(timer);
  }, [enabled, card]);
  const shown = useCallback(async (id: string) => publish(await ask({ type: 'billboard.shown', id })), []);
  const close = useCallback(async (id: string, how: BillboardClose) => publish(await ask({ type: 'billboard.close', id, how })), []);
  return { card, shown, close };
}
