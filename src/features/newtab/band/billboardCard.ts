import { useEffect, useRef, useState } from 'react';
import { useBillboard } from '../../../ui/billboard';
import { t, useT } from '../../../i18n';
import type { BandAction, BandCard, BandContext } from './types';

/** Below this page height (CSS px) a framed page has no room for a card at all (its title, search, the picture at its smallest and the caption come to about 330 px). */
const LEAST_ROOM = 400;
/** After the card has settled, a page whose content reaches into its bottom padding (by more than a rounding pixel) makes the card wait; it comes back when the page is taller by that much. */
const OVERFLOW_SLACK = 1, SETTLE = 450;
const SLOT = '.nt-band-slot[data-band="billboard"]';

/**
 * Section D, the billboard, as the band's second source (band/types.ts). The band draws the card (its look, its entrance and exit); this hook only decides WHAT to show and counts it:
 *  - the card comes from main's saved copy of the signed file (src/ui/billboard.ts), never from the network;
 *  - it is reported as shown only when the band really draws it (this card's slot is in the page, in a visible window): while the usage notice is on screen the band draws that
 *    one and this card is neither shown nor counted, and the 7-day clock does not start;
 *  - X, and a click on either link, close it for good (main keeps that; X raises the standard "Announcement closed · Undo" toast itself);
 *  - the framed page never scrolls and shrinks its picture to a minimum: when there is no room for a card as well, or the content would reach into the page's bottom padding once the
 *    card has settled, the card waits (null, not counted) and comes back when the page is taller.
 */
export function useBillboardCard(context: BandContext): BandCard | null {
  useT();
  const [roomy, setRoomy] = useState(true);
  const blocked = useRef<number | null>(null); // the page height the card must reach again before it returns
  const { card, shown, close } = useBillboard(roomy);
  const reported = useRef('');

  // A framed page that is too short for a card makes it wait; a page with a full-size picture scrolls, so it always has room.
  useEffect(() => {
    const page = document.querySelector<HTMLElement>('.nt-page');
    if (!page || typeof ResizeObserver !== 'function') return;
    const judge = () => {
      if (page.dataset.style !== 'framed') { blocked.current = null; setRoomy(true); return; }
      if (blocked.current !== null && page.clientHeight >= blocked.current) blocked.current = null;
      setRoomy(blocked.current === null && page.clientHeight >= LEAST_ROOM);
    };
    judge();
    const observer = new ResizeObserver(judge);
    observer.observe(page);
    return () => observer.disconnect();
  }, []);

  // Runs after every render (cheap): once the band has drawn THIS card, tell main it is on screen (it starts the card's clock the first time), and watch it settle.
  useEffect(() => {
    if (!card) { reported.current = ''; return; }
    const slot = document.querySelector<HTMLElement>(SLOT);
    if (!slot) return; // the band is showing something else (the usage notice comes first)
    if (reported.current !== card.id && document.visibilityState !== 'hidden') { reported.current = card.id; void shown(card.id); }
    const scroll = slot.closest<HTMLElement>('.nt-scroll'), page = slot.closest<HTMLElement>('.nt-page');
    if (!scroll || !page || page.dataset.style !== 'framed' || typeof ResizeObserver !== 'function') return;
    let timer = 0;
    const check = () => {
      if (!slot.isConnected) return;
      const stack = scroll.firstElementChild, below = parseFloat(getComputedStyle(scroll).paddingBottom) || 0;
      // the lowest thing on the page: the stack's own box, its children, and the caption row (which can reach out of a picture block that was shrunk to its minimum)
      const lowest = stack ? Math.max(stack.getBoundingClientRect().bottom, ...[...stack.querySelectorAll<HTMLElement>(':scope > *, .nt-credit')].map((node) => node.getBoundingClientRect().bottom)) : 0;
      const over = Math.ceil(lowest - (scroll.getBoundingClientRect().bottom - below));
      if (over > OVERFLOW_SLACK) { blocked.current = page.clientHeight + over + 4; setRoomy(false); }
    };
    const observer = new ResizeObserver(() => { window.clearTimeout(timer); timer = window.setTimeout(check, SETTLE); });
    observer.observe(slot); timer = window.setTimeout(check, SETTLE);
    return () => { window.clearTimeout(timer); observer.disconnect(); };
  });

  if (!card) return null;
  const link = (how: 'cta' | 'secondary', target: { label: string; link: string }, tone: BandAction['tone']): BandAction => ({ id: how, label: target.label, tone, onClick: () => { void close(card.id, how); context.navigate(target.link); } });
  const actions: BandAction[] = [];
  if (card.cta) actions.push(link('cta', card.cta, card.style === 'default' ? 'link' : 'primary'));
  if (card.secondary) actions.push(link('secondary', card.secondary, 'link'));
  return { id: card.id, kind: 'billboard', style: card.style, title: card.title, body: card.body, actions, onClose: () => { void close(card.id, 'x'); }, closeLabel: t('toast.dismiss') };
}
