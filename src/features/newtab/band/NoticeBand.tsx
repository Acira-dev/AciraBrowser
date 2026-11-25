import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useRef } from 'react';
import { X } from '../../../components/AppIcons';
import { PreviewIcon } from '../../../components/PreviewIcon';
import { useT } from '../../../i18n';
import { BAND_SOURCES } from './sources';
import type { BandAction, BandCard, BandContext } from './types';
import './band.css';

const ease = [0.16, 1, 0.3, 1] as const;
/** The same curve run backwards (the cubic-bezier with its control points mirrored through the middle), so the exit is the entrance played in reverse: slow to leave, quick at the end (brief rule 12). */
const easeBack = [1 - ease[2], 1 - ease[3], 1 - ease[0], 1 - ease[1]] as const;
const DURATION = 0.32;

function ActionButton({ action }: { action: BandAction }) {
  return <button type="button" className="nt-band-action" data-tone={action.tone ?? 'link'} onClick={action.onClick}>{action.label}</button>;
}

function CardBody({ card }: { card: BandCard }) {
  const titleId = useId();
  return <section className="nt-band-card" data-style={card.style} data-kind={card.kind} aria-labelledby={titleId}>
    {card.kind === 'noel' && <i className="nt-band-mark" aria-hidden="true" />}
    <div className="nt-band-text">
      {card.confirmation
        ? <p className="nt-band-confirm" id={titleId} role="status">{card.confirmation.text}{card.confirmation.action && <> <ActionButton action={card.confirmation.action} /></>}</p>
        : <>
          {card.eyebrow && <span className="nt-band-eyebrow" aria-hidden="true">{card.eyebrow}</span>}
          <strong className="nt-band-title" id={titleId}>{card.title}</strong>
          <p className="nt-band-body">{card.body}</p>
          {card.choice && <div className="nt-band-choice" role="radiogroup" aria-label={card.choice.label}>{card.choice.options.map((option) => <button key={option.id} type="button" className="nt-band-option" role="radio" aria-checked={card.choice!.value === option.id} data-on={card.choice!.value === option.id ? '' : undefined} onClick={() => card.choice!.onChange(option.id)}>{option.label}</button>)}</div>}
          {card.actions.length > 0 && <div className="nt-band-actions">{card.actions.slice(0, 2).map((action) => <ActionButton key={action.id} action={action} />)}</div>}
        </>}
    </div>
    <button type="button" className="nt-band-close" aria-label={card.closeLabel} title={card.closeLabel} onClick={card.onClose}><PreviewIcon icon={X} size={14} /></button>
  </section>;
}

/** The band: one card at the TOP of the new-tab page (the team's notes 17 Nov, A1), drawn by NewTabPage.tsx in `.nt-band-top`, a layer over the page that takes no room in the page's own layout, so the page below
 *  never moves when the card comes or goes. It comes in with the page's own blur-and-fade and leaves by the same road backwards, so nothing ever cuts (brief rule 12). With motion reduced it is a plain
 *  quick fade. `quiet`: the page was resumed (a tab the person comes back to), so the card is simply there. `onRoom` is told the card's height (0 when there is none), so a short page can make room for it. */
export function NoticeBand({ quiet = false, onRoom, ...context }: BandContext & { quiet?: boolean; onRoom?: (height: number) => void }) {
  useT();
  // Every source is called on every render, in the same order (they are hooks); the first one with a card is shown.
  const cards = BAND_SOURCES.map((source) => source(context));
  const card = cards.find((item): item is BandCard => Boolean(item)) ?? null;
  const { reduced } = context;
  const motionFor = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.09, ease: 'linear' as const } }
    : { initial: { gridTemplateRows: '0fr', opacity: 0, filter: 'blur(4px)' }, animate: { gridTemplateRows: '1fr', opacity: 1, filter: 'blur(0px)' }, exit: { gridTemplateRows: '0fr', opacity: 0, filter: 'blur(4px)', transition: { duration: DURATION, ease: easeBack } }, transition: { duration: DURATION, ease } };
  const slot = useRef<HTMLDivElement>(null), shown = card?.id ?? '';
  // The card's own height (its box, whatever the slot's animation is doing), reported while a card is shown and as 0 the moment there is none, so the page glides its room in and out (NewTabPage.tsx).
  useEffect(() => {
    if (!onRoom) return;
    const node = shown ? slot.current?.querySelector<HTMLElement>('.nt-band-card') : null;
    if (!node) { onRoom(0); return; }
    const report = () => onRoom(Math.ceil(node.offsetHeight));
    report();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(report) : null;
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [shown, onRoom]);
  return <AnimatePresence initial={!quiet}>
    {card && <motion.div key={card.id} ref={slot} className="nt-band-slot" data-band={card.kind} {...motionFor}>
      <div className="nt-band-clip"><CardBody card={card} /></div>
    </motion.div>}
  </AnimatePresence>;
}
