import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { CheckMark, CrossMark } from '../CheckMark';
import { Info, ShieldCheck, Sparkles, SparklesOff } from '../AppIcons';
import { WorkspaceGlyph } from '../WorkspaceGlyph';
import type { StatusIcon } from '../../runtime/types';
import { classScale, motionSpeed, motionTokens, springEasing, springFor, type MotionTokenId } from '../../ui/sharedMotion';
import '../../styles/transient.css';

import { t } from '../../i18n';
import { ownTextDirection } from '../../i18n/direction';
/** The transient-surface primitives (bible §4 Transient surfaces): one toast card, one stack, one status pill. Geometry
 * is computed here, not measured, so the page stack and the native overlay over websites (whose bounds main sizes
 * before it paints) always agree. */

export type ToastTone = 'error' | 'info' | 'status';
export type { StatusIcon };
/** `dismissible`: the toast stays until dismissed (errors, notices). Every toast can be dismissed from the × in its glyph spot. */
export interface ToastRowModel { key: number | string; text: string; tone?: ToastTone; icon?: StatusIcon; actionLabel?: string; actionKey?: string; dismissible?: boolean }

/* Geometry (keep in step with transient.css). */
export const TOAST_MIN = 300, TOAST_MAX = 420, TOAST_LINE = 44, TOAST_TWO_LINES = 60, TOAST_GAP = 8, TOAST_PEEK = 10, TOAST_VISIBLE = 3;
export const PILL_HEIGHT = 32, PILL_GAP = 8, PILL_MAX = 320;
const LEAD = 36, TRAIL = 8; // padding 12 + icon 16 + gap 8; right padding.
/** Text width in the toast font (a hidden span, cached, so Inter's features count as they do on screen: canvas ignores them and
 *  the single-storey a is wider); a per-character estimate before fonts are ready or without a document. */
const widths = new Map<string, number>();
let measure: HTMLSpanElement | null | undefined;
function textWidth(text: string, font = '450 13px Inter, "Segoe UI", sans-serif', fallback = 6.4) {
  const key = font + '|' + text, known = widths.get(key); if (known !== undefined) return known;
  if (measure === undefined && typeof document !== 'undefined' && document.body) {
    measure = document.createElement('span'); measure.setAttribute('aria-hidden', 'true');
    measure.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;white-space:pre;pointer-events:none;contain:layout style';
    document.body.append(measure);
  }
  if (!measure || (typeof document !== 'undefined' && document.fonts && document.fonts.status !== 'loaded')) return text.length * fallback;
  measure.style.font = font; measure.textContent = text; const width = Math.ceil(measure.getBoundingClientRect().width);
  if (widths.size > 400) widths.clear(); widths.set(key, width); return width;
}

const actionWidth = (row: ToastRowModel) => row.actionLabel ? 8 + textWidth(row.actionLabel, '500 13px Inter, "Segoe UI", sans-serif', 7.4) + 16 + (row.actionKey ? 8 + textWidth(row.actionKey, '500 11px Inter, "Segoe UI", sans-serif', 6.2) + 8 : 0) : 0;

/** A row's natural width and height: one line when the text fits beside its action within 420px, else two (clamped). The
 * × takes no width of its own: it lives in the glyph's spot (founder, 27 Oct). */
export function toastRowSize(row: ToastRowModel) {
  const fixed = LEAD + TRAIL + actionWidth(row), text = textWidth(row.text);
  const width = Math.round(Math.max(TOAST_MIN, Math.min(TOAST_MAX, fixed + text + 4)));
  return { width, height: fixed + text + 4 > TOAST_MAX ? TOAST_TWO_LINES : TOAST_LINE };
}
export const pillWidth = (text: string) => Math.round(Math.min(PILL_MAX, 10 + 16 + 8 + textWidth(text, '500 13px Inter, "Segoe UI", sans-serif', 6.9) + 12 + 2));

/** The whole slot: the stack (newest last), and the status pill above it. `expanded` = spread on hover. */
export function toastSlotSize(rows: ToastRowModel[], pill?: string, expanded = false) {
  const shown = rows.slice(-TOAST_VISIBLE), sizes = shown.map(toastRowSize);
  const width = Math.max(pill ? pillWidth(pill) : 0, ...sizes.map(size => size.width), shown.length ? TOAST_MIN : 0);
  const front = sizes.at(-1)?.height ?? 0;
  const stack = !shown.length ? 0 : expanded ? sizes.reduce((sum, size) => sum + size.height, 0) + TOAST_GAP * (shown.length - 1) : front + TOAST_PEEK * (shown.length - 1);
  return { width, height: stack + (pill ? PILL_HEIGHT + (shown.length ? PILL_GAP : 0) : 0), stack };
}

const glyph = (tone?: ToastTone, icon?: StatusIcon) => {
  const name = icon || (tone === 'error' ? 'error' : tone === 'info' ? 'info' : 'check');
  return name === 'workspace' ? <WorkspaceGlyph icon="workspace" /> : name === 'error' ? <CrossMark size={16} /> : name === 'info' ? <Info size={16} /> : name === 'shield' ? <ShieldCheck size={16} /> : name === 'sparkles' ? <Sparkles size={16} /> : name === 'sparkles-off' ? <SparklesOff size={16} /> : <CheckMark size={16} />;
};

/** The toast's leading spot (founder, 27 Oct, like macOS Notification Center): its status glyph at rest; while the pointer is
 * on the card or keyboard focus is inside it, the glyph cross-fades into a close × of the same size in the same place (a
 * 22px round hit area, a soft background under the pointer). Tab reaches the ×; reduced motion swaps at once. */
export function ToastLead({ tone, icon, onDismiss }: { tone?: ToastTone; icon?: StatusIcon; onDismiss?: () => void }) {
  return <span className="t-lead">
    <span className="t-glyph" aria-hidden="true">{glyph(tone, icon)}</span>
    {onDismiss && <button type="button" className="t-close" aria-label={t("toast.dismiss")} onClick={onDismiss}><CrossMark size={16} /></button>}
  </span>;
}

/** Esc on a focused toast dismisses it; focus moves to the next toast's × (else the one before) so the keyboard is never
 * dropped onto the page. */
export function dismissOnEscape(event: KeyboardEvent<HTMLElement>, onDismiss?: () => void) {
  if (event.key !== 'Escape' || !onDismiss || event.defaultPrevented) return;
  event.preventDefault(); event.stopPropagation();
  const card = event.currentTarget, stack = card.closest('.t-stack');
  const others = stack ? Array.from(stack.querySelectorAll<HTMLButtonElement>('.t-close')).filter(button => !card.contains(button)) : [];
  const after = others.find(button => card.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING), next = after || others.at(-1);
  onDismiss();
  next?.focus({ preventScroll: true });
}

/** One toast: 16px icon column (the × on hover), text on the x = 36 edge, one text action (+ its key cap). */
export function ToastCard({ row, action, onDismiss }: { row: ToastRowModel; action?: ReactNode; onDismiss?: () => void }) {
  const { height } = toastRowSize(row);
  return <div className="t-toast" data-tone={row.tone} data-lines={height > TOAST_LINE ? 2 : 1} role={row.tone === 'error' ? 'alert' : 'status'} onKeyDown={event => dismissOnEscape(event, onDismiss)}>
    <ToastLead tone={row.tone} icon={row.icon} onDismiss={onDismiss} />
    <span className="t-text" title={row.text} dir={ownTextDirection(row.text)}>{row.text}</span>
    {action}
  </div>;
}

/** A toast morphs out of the edge it lives on and back into it (R3-41, bible §4 Morph): it rises `toastRise` px from below
 * its slot while it scales up from .96 and fades in on `toast.in` (S, bounce .12: a 0.3% settle) with `materialize` for its
 * opacity, and leaves on `toast.out` (critically damped) with `menu.fade`. Premium stretches S ×1.7 and E ×1.4; Off places
 * it at once. The stack's own movement (an older toast stepping back, the spread on hover) rides `toast.stack` through CSS
 * variables. */
export const toastRise = 20;
/** Transparent room the native overlay keeps below a toast (its anchor sits this far under the card; main limits the host's
 * bottom edge to the anchor). The toast shadow (`--t-shadow`) reaches at most 20px, so it falls off inside this room and is
 * never cut by the host (R3-66: the old anchor sat 8px under the card and cut the shadow in a hard line). */
export const TOAST_SHADOW_ROOM = 28;
export function toastMotion(reducedMotion?: boolean) {
  const speed = reducedMotion ? 'off' : motionSpeed(), enterSpec = springFor('toast.in', speed), exitSpec = springFor('toast.out', speed), stackSpec = springFor('toast.stack', speed);
  const fade = (id: MotionTokenId) => ({ duration: motionTokens[id][1] * classScale(speed, 'E'), ease: 'easeOut' as const });
  const instant = !enterSpec || !exitSpec || !stackSpec;
  return {
    enter: instant ? { spring: false, transition: { duration: .1 } } : { spring: true, transition: { type: 'spring' as const, duration: enterSpec.duration, bounce: enterSpec.bounce, opacity: fade('materialize') } },
    exit: instant ? { spring: false, transition: { duration: .1 } } : { spring: true, transition: { type: 'spring' as const, duration: exitSpec.duration, bounce: 0, opacity: fade('menu.fade') } },
    move: instant ? { duration: 100, easing: 'linear' } : springEasing(stackSpec, 1),
  };
}
/** How long a host must keep a leaving toast's room (bounds, overlay) so the exit is never cut off: the exit spring's
 * settle time plus a frame margin. */
export function toastLeaveMs(reducedMotion?: boolean): number {
  const spec = springFor('toast.out', reducedMotion ? 'off' : motionSpeed());
  return spec ? Math.ceil(springEasing(spec, 1).duration) + 80 : 120;
}

/** How far a card sits above the stack's bottom edge. Expanded, it clears every newer card and the gaps between. Collapsed, an
 * older card peeks `TOAST_PEEK` per step above the front card's top: a card that is shorter than the front one (a one-line
 * notice behind a two-line one) is lifted by the difference too, or it would hide entirely behind the front card and the room
 * the stack keeps for its peek would stay empty. (A taller card behind is cropped instead, see `clip` below.) */
export function toastLift(heights: number[], index: number, expanded: boolean, front: number) {
  if (expanded) return heights.slice(index + 1).reduce((sum, height) => sum + height + TOAST_GAP, 0);
  const fromFront = heights.length - 1 - index;
  return TOAST_PEEK * fromFront + (fromFront ? Math.max(0, front - heights[index]) : 0);
}

/** Up to three toasts, newest in front. Collapsed: each older one 10px higher at −5% scale with its content hidden.
 * Expanded (hovered): every toast at full height with 8px gaps. Only transform and opacity animate. */
export function ToastStack({ rows, expanded, reducedMotion, render, onHold, className = '' }: {
  rows: ToastRowModel[]; expanded: boolean; reducedMotion?: boolean; className?: string;
  render: (row: ToastRowModel) => ReactNode; onHold?: (held: boolean) => void;
}) {
  const shown = rows.slice(-TOAST_VISIBLE), sizes = shown.map(toastRowSize);
  // A leaving toast keeps the stack's width and height until its exit has played (R3-41, R3-66). The stack used to shrink to
  // nothing the moment the last row left, which squeezed the card to its content width and clipped it in place.
  const [room, setRoom] = useState(shown), roomKey = shown.map(row => row.key).join(',');
  useEffect(() => {
    if (shown.length >= room.length) { setRoom(shown); return; }
    const timer = setTimeout(() => setRoom(shown), toastLeaveMs(reducedMotion)); return () => clearTimeout(timer);
  }, [roomKey]);
  const held = room.length > shown.length ? room : shown, front = (held.length ? toastRowSize(held[held.length - 1]).height : TOAST_LINE);
  const { width, stack } = toastSlotSize(held, undefined, expanded);
  const { enter, exit, move } = toastMotion(reducedMotion);
  return <ol className={`t-stack ${className}`} data-expanded={expanded || undefined} data-instant={reducedMotion || undefined} style={{ width, height: stack, pointerEvents: shown.length ? undefined : 'none', '--front-h': `${front}px`, '--t-move': `${move.duration}ms`, '--t-move-ease': move.easing } as CSSProperties}
    onPointerEnter={() => onHold?.(true)} onPointerLeave={() => onHold?.(false)} onFocus={() => onHold?.(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) onHold?.(false); }}>
    <AnimatePresence initial={false}>
      {shown.map((row, index) => {
        const fromFront = shown.length - 1 - index;
        const lift = toastLift(sizes.map(size => size.height), index, expanded, front);
        // A taller card behind a shorter front one is cropped to the front's height, so every peek is exactly 10px.
        const clip = expanded || !fromFront ? 0 : Math.max(0, sizes[index].height - front);
        const style = { '--i': fromFront, '--lift': `${-lift}px`, height: sizes[index].height, zIndex: TOAST_VISIBLE - fromFront, ...(clip ? { clipPath: `inset(${clip}px 0 0 0 round 8px)` } : {}) } as CSSProperties;
        return <motion.li key={row.key} className="t-slot" data-front={!fromFront || undefined} style={style}
          initial={reducedMotion || !enter.spring ? { opacity: 0 } : { opacity: 0, y: toastRise, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1, transition: enter.transition }}
          exit={reducedMotion || !exit.spring ? { opacity: 0, transition: exit.transition } : { opacity: 0, y: 8, scale: .98, transition: exit.transition }}>
          {/* Enter/exit move the slot (motion); the stack position is a CSS transform on this inner layer, so the two never
              fight over one transform. */}
          <div className="t-place">{render(row)}</div>
        </motion.li>;
      })}
    </AnimatePresence>
  </ol>;
}

/** A compact, actionless status: "AI-free mode on", "Link copied", "Zoom 110%". */
export function StatusPill({ text, icon, reducedMotion }: { text: string; icon?: StatusIcon; reducedMotion?: boolean }) {
  const { enter, exit } = toastMotion(reducedMotion);
  return <motion.div className="t-pill" role="status" style={{ width: pillWidth(text), transformOrigin: '50% 100%' }}
    initial={enter.spring ? { opacity: 0, y: 10, scale: .94 } : { opacity: 0 }} animate={{ opacity: 1, y: 0, scale: 1, transition: enter.transition }}
    exit={exit.spring ? { opacity: 0, y: 6, scale: .97, transition: exit.transition } : { opacity: 0, transition: exit.transition }}>
    <span className="t-glyph" aria-hidden="true">{glyph('status', icon)}</span><span className="t-text" dir={ownTextDirection(text)}>{text}</span>
  </motion.div>;
}
