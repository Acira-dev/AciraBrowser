import { useLayoutEffect,useRef,type CSSProperties,type ReactNode } from 'react';
import { designTokens,type FormationVariant } from '../ui/designSystem';

const ease = `cubic-bezier(${designTokens.motion.formationEase.join(',')})`;
const exitEase = 'cubic-bezier(.4,0,.9,.6)';

/** The ElevenLabs / acirabrowser.com load-in: each piece rises a few pixels out of a soft blur into focus. */
// `steps` caps the cascade: later rows share the last delay, so long menus never feel slow.
const profiles: Record<FormationVariant, { blur: number; rise: number; scale: number; itemBlur: number; itemRise: number; stagger: number; steps: number; items: number }> = {
  menu: { blur: 12, rise: 0, scale: 1.012, itemBlur: 4, itemRise: 3, stagger: 18, steps: 9, items: 48 },
  switcher: { blur: 12, rise: 0, scale: 1.012, itemBlur: 4, itemRise: 3, stagger: 16, steps: 9, items: 48 },
  assistant: { blur: 12, rise: 0, scale: 1.008, itemBlur: 6, itemRise: 8, stagger: 60, steps: 4, items: 6 },
  content: { blur: 6, rise: 0, scale: 1, itemBlur: 10, itemRise: 14, stagger: 55, steps: 6, items: 16 },
  page: { blur: 0, rise: 0, scale: 1, itemBlur: 0, itemRise: 0, stagger: 0, steps: 0, items: 0 },
};
/** Floating surfaces condense like vapor: the edges stay misty while the centre of the opening gathers first. */
const vaporVariants: FormationVariant[] = ['menu', 'switcher', 'assistant'];
const VAPOR_REST = '1.4';

/** Rows and blocks that resolve one after another. Marked items win; otherwise the first level with siblings. */
function formationItems(node: HTMLElement, limit: number): HTMLElement[] {
  if (!limit) return [];
  const marked = [...node.querySelectorAll<HTMLElement>('[data-form-item]')];
  if (marked.length) return marked.slice(0, limit);
  // Popup bodies form in document order, separators and controls included.
  const body = [...node.querySelectorAll<HTMLElement>('.popup-header,.popup-fixed-search,.popup-body-content>*')];
  if (body.length > 2) return body.slice(0, limit);
  const rows = [...node.querySelectorAll<HTMLElement>('.popup-header,.popup-fixed-search,.menu-row,.tab-result,[role=menuitem],[role=option]')].filter(row => !row.parentElement?.closest('.menu-row,.tab-result,[role=menuitem],[role=option]'));
  if (rows.length > 1) return rows.slice(0, limit);
  let level: HTMLElement = node;
  for (let depth = 0; depth < 3; depth++) {
    const children = [...level.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.offsetParent !== null);
    if (children.length > 1) return children.slice(0, limit);
    if (children.length !== 1) break;
    level = children[0];
  }
  return [];
}

/** Only the foreground resolves into focus. Inputs retain their final geometry once formed. */
export function Formation({ children, variant = 'menu', reduced = false, visible = true, scene, origin, className = '' }: {
  children: ReactNode; variant?: FormationVariant; reduced?: boolean; visible?: boolean; scene?: string; origin?: { x: number; y: number }; className?: string;
}) {
  const root = useRef<HTMLDivElement>(null), finish = useRef<() => void>(() => {});
  const phase = useRef<'hidden' | 'opening' | 'open' | 'closing'>('hidden');
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const vapor = vaporVariants.includes(variant);
    // Retain the painted value before removing WAAPI fill effects. A reversed
    // close must continue from this frame, not snap back to its old inline style.
    const freeze = () => { const painted = getComputedStyle(node), opacity = painted.opacity, filter = painted.filter, transform = painted.transform, mist = painted.getPropertyValue('--vapor'); for (const animation of node.getAnimations()) animation.cancel(); node.style.opacity = opacity; node.style.filter = filter; node.style.transform = transform; if (vapor && mist) node.style.setProperty('--vapor', mist); };
    const rest = () => { node.style.opacity = '1'; node.style.filter = 'none'; node.style.transform = ''; node.style.removeProperty('--vapor'); delete node.dataset.vapor; };
    if (reduced) { node.style.opacity = visible ? '1' : '0'; node.style.filter = 'none'; node.style.transform = ''; node.style.removeProperty('--vapor'); delete node.dataset.vapor; phase.current = visible ? 'open' : 'hidden'; return; }
    if (!visible) {
      // Native readiness starts hidden. It is not an interrupted close: treating
      // it as one would skip the soft entrance on every cold opening.
      if (phase.current === 'hidden') { node.style.opacity = '0'; node.style.filter = 'none'; node.style.transform = ''; return; }
      phase.current = 'closing'; let cancelled = false;
      const duration = variant === 'assistant' ? designTokens.motion.assistantExit : vapor ? designTokens.motion.vaporExit : designTokens.motion.exit;
      const painted = getComputedStyle(node);
      if (vapor) node.dataset.vapor = '';
      // Closing evaporates: the edges dissolve first, back toward where the surface came from.
      const exit = node.animate([
        { opacity: painted.opacity, filter: painted.filter === 'none' ? 'blur(0px)' : painted.filter, transform: painted.transform === 'none' ? 'scale(1)' : painted.transform, ...(vapor ? { '--vapor': painted.getPropertyValue('--vapor') || VAPOR_REST } : {}) },
        { opacity: 0, filter: vapor ? 'blur(10px)' : 'blur(4px)', transform: vapor ? 'scale(.992)' : 'scale(1)', ...(vapor ? { '--vapor': '0.15' } : {}) },
      ], { duration, easing: vapor ? exitEase : 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
      const end = setTimeout(() => { if (!cancelled) phase.current = 'hidden'; }, duration);
      return () => { cancelled = true; clearTimeout(end); freeze(); exit.cancel(); };
    }
    const profile = profiles[variant], duration = vapor && variant !== 'assistant' ? designTokens.motion.vapor : designTokens.motion[variant];
    const reversing = phase.current === 'closing'; phase.current = 'opening';
    const from = reversing
      ? { opacity: node.style.opacity || '1', filter: node.style.filter || 'none', transform: node.style.transform || 'none', vapor: node.style.getPropertyValue('--vapor') || VAPOR_REST }
      : { opacity: '0', filter: profile.blur ? `blur(${profile.blur}px)` : 'none', transform: profile.rise || profile.scale !== 1 ? `translateY(${profile.rise}px) scale(${profile.scale})` : 'none', vapor: '0' };
    rest();
    if (vapor) node.dataset.vapor = '';
    const shell = [
      node.animate([{ opacity: from.opacity }, { opacity: 1 }], { duration: duration * .5, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' }),
      node.animate([
        { filter: from.filter, transform: from.transform, ...(vapor ? { '--vapor': from.vapor } : {}) },
        { filter: 'blur(0px)', transform: 'none', ...(vapor ? { '--vapor': VAPOR_REST } : {}) },
      ], { duration, easing: ease, fill: 'backwards' }),
    ];
    // A reversed close continues from its painted frame; its rows are already formed.
    const items = reversing ? [] : formationItems(node, profile.items);
    const staggered = items.map((item, index) => item.animate(
      [{ opacity: 0, filter: `blur(${profile.itemBlur}px)`, transform: `translateY(${profile.itemRise}px)` }, { opacity: 1, filter: 'blur(0px)', transform: 'none' }],
      { duration, delay: 30 + Math.min(index, profile.steps) * profile.stagger, easing: ease, fill: 'backwards' },
    ));
    const total = duration + (items.length ? 30 + Math.min(items.length - 1, profile.steps) * profile.stagger : 0);
    let cancelled = false, finished = false;
    const settle = () => { if (cancelled || finished) return; finished = true; clearTimeout(timer); for (const animation of [...shell, ...staggered]) animation.cancel(); rest(); phase.current = 'open'; };
    finish.current = settle;
    // Cancel finished effects as well: hidden WebContents can defer completion
    // notifications after the last painted frame.
    const timer = setTimeout(settle, total + 16);
    return () => { cancelled = true; clearTimeout(timer); for (const animation of staggered) animation.cancel(); freeze(); finish.current = () => {}; };
  }, [variant, reduced, visible, scene]);
  const style = origin ? { '--vx': `${origin.x * 100}%`, '--vy': `${origin.y * 100}%` } as CSSProperties : undefined;
  return <div ref={root} className={className} style={style} onPointerDownCapture={() => finish.current()} onKeyDownCapture={() => finish.current()}>{children}</div>;
}
