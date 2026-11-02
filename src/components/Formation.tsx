import { useLayoutEffect,useRef,type CSSProperties,type ReactNode } from 'react';
import { designTokens,type FormationVariant } from '../ui/designSystem';

const ease = `cubic-bezier(${designTokens.motion.formationEase.join(',')})`;
const exitEase = 'cubic-bezier(.4,0,1,1)';

/** The ElevenLabs / acirabrowser.com load-in: each piece rises a few pixels out of a soft blur into focus. It is drawn on
 * the GPU (bible §3.9): the blur is a copy of the content blurred once (a static filter) that dissolves while the sharp
 * content rises through it. Only opacity and transforms animate; no filter is ever animated. */
// `steps` caps the cascade: later rows share the last delay, so long menus never feel slow.
const profiles: Record<FormationVariant, { blur: number; rise: number; scale: number; itemRise: number; itemScale: number; stagger: number; steps: number; items: number }> = {
  menu: { blur: 12, rise: 0, scale: 1.012, itemRise: 3, itemScale: 1, stagger: 18, steps: 9, items: 48 },
  switcher: { blur: 12, rise: 0, scale: 1.012, itemRise: 3, itemScale: 1, stagger: 16, steps: 9, items: 48 },
  assistant: { blur: 12, rise: 0, scale: 1.008, itemRise: 8, itemScale: .99, stagger: 60, steps: 4, items: 6 },
  // Page sections (Settings, Library; round 2: "clean sequential reveal on click", no group skipped): no vapor and no
  // fade of the whole page, only the rows rising 6px into place in order from the frame of the click (see `clean`).
  content: { blur: 0, rise: 0, scale: 1, itemRise: 6, itemScale: 1, stagger: 24, steps: 6, items: 64 },
  page: { blur: 0, rise: 0, scale: 1, itemRise: 0, itemScale: 1, stagger: 0, steps: 0, items: 0 },
};
const floating: FormationVariant[] = ['menu', 'switcher', 'assistant'];

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

/** The vapor the content condenses out of: a still copy laid exactly over it, blurred once when it is made. It is
 * inert, hidden from assistive technology, and removed as soon as it has dissolved. */
function vaporLayer(node: HTMLElement, blur: number) {
  const parent = node.parentElement;
  if (!parent || !blur || !node.offsetWidth) return null;
  const vapor = node.cloneNode(true) as HTMLElement;
  for (const element of [vapor, ...vapor.querySelectorAll('[id]')]) element.removeAttribute('id');
  // The copy is only paint: it carries no names, so one control is never found twice (tests, screen readers, search).
  for (const element of vapor.querySelectorAll('[aria-label],[aria-labelledby],[data-setting],[name],[placeholder]')) for (const attribute of ['aria-label', 'aria-labelledby', 'data-setting', 'name', 'placeholder']) element.removeAttribute(attribute);
  vapor.setAttribute('aria-hidden', 'true'); vapor.inert = true; vapor.dataset.vaporLayer = '';
  Object.assign(vapor.style, { position: 'absolute', left: `${node.offsetLeft}px`, top: `${node.offsetTop}px`, width: `${node.offsetWidth}px`, height: `${node.offsetHeight}px`, margin: '0', boxSizing: 'border-box', pointerEvents: 'none', opacity: '0', filter: `blur(${blur}px)`, transform: '', willChange: 'opacity, transform' });
  parent.appendChild(vapor);
  return vapor;
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
    const lifted = floating.includes(variant);
    // Retain the painted value before removing WAAPI fill effects. A reversed
    // close must continue from this frame, not snap back to its old inline style.
    const freeze = () => { const painted = getComputedStyle(node), opacity = painted.opacity, transform = painted.transform; for (const animation of node.getAnimations()) animation.cancel(); node.style.opacity = opacity; node.style.transform = transform; };
    const rest = () => { node.style.opacity = '1'; node.style.transform = ''; };
    if (reduced) { node.style.opacity = visible ? '1' : '0'; node.style.transform = ''; phase.current = visible ? 'open' : 'hidden'; return; }
    if (!visible) {
      // Native readiness starts hidden. It is not an interrupted close: treating
      // it as one would skip the soft entrance on every cold opening.
      if (phase.current === 'hidden') { node.style.opacity = '0'; node.style.transform = ''; return; }
      phase.current = 'closing'; let cancelled = false;
      const duration = variant === 'assistant' ? designTokens.motion.assistantExit : lifted ? designTokens.motion.vaporExit : designTokens.motion.exit;
      const painted = getComputedStyle(node);
      // Closing evaporates back toward where the surface came from: opacity and a slight scale, never a blur (§3.9).
      const exit = node.animate([
        { opacity: painted.opacity, transform: painted.transform === 'none' ? 'scale(1)' : painted.transform },
        { opacity: 0, transform: lifted ? 'scale(.98)' : 'scale(.992)' },
      ], { duration, easing: exitEase, fill: 'forwards' });
      const end = setTimeout(() => { if (!cancelled) phase.current = 'hidden'; }, duration);
      return () => { cancelled = true; clearTimeout(end); freeze(); exit.cancel(); };
    }
    const profile = profiles[variant], duration = lifted && variant !== 'assistant' ? designTokens.motion.vapor : designTokens.motion[variant];
    const reversing = phase.current === 'closing'; phase.current = 'opening';
    // A page section is clean: the page itself never fades, the first row starts on the frame of the click.
    const clean = variant === 'content';
    const from = reversing
      ? { opacity: node.style.opacity || '1', transform: node.style.transform || 'none' }
      : clean ? { opacity: '1', transform: 'none' } : { opacity: '0', transform: profile.rise || profile.scale !== 1 ? `translateY(${profile.rise}px) scale(${profile.scale})` : 'none' };
    rest();
    const shell = [
      node.animate([{ opacity: from.opacity }, { opacity: 1 }], { duration: duration * .5, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' }),
      node.animate([{ transform: from.transform }, { transform: 'none' }], { duration, easing: ease, fill: 'backwards' }),
    ];
    // A reversed close continues from its painted frame; its rows are already formed and there is no vapor to show.
    const items = reversing ? [] : formationItems(node, profile.items);
    const staggered = items.map((item, index) => item.animate(
      [{ opacity: 0, transform: `translateY(${profile.itemRise}px) scale(${profile.itemScale})` }, { opacity: 1, transform: 'none' }],
      { duration, delay: (clean ? 0 : 30) + Math.min(index, profile.steps) * profile.stagger, easing: ease, fill: 'backwards' },
    ));
    const total = duration + (items.length ? (clean ? 0 : 30) + Math.min(items.length - 1, profile.steps) * profile.stagger : 0);
    // The vapor gathers at once, then thins as the rows resolve through it, in the shell's scale.
    const vapor = reversing ? null : vaporLayer(node, profile.blur);
    const mist = vapor ? [
      vapor.animate([{ opacity: 0 }, { opacity: variant === 'content' ? .5 : .9, offset: .12 }, { opacity: 0 }], { duration: total * .7, easing: 'cubic-bezier(.33,0,.4,1)', fill: 'forwards' }),
      vapor.animate([{ transform: from.transform }, { transform: 'none' }], { duration, easing: ease, fill: 'forwards' }),
    ] : [];
    // A section whose rows arrive a moment later (data that loads: Shortcuts, Privacy) forms them as they land, in order,
    // instead of letting them pop in unformed (round 2: "some groups skip it"). Only rows at the level the reveal uses.
    const lateRows: Animation[] = [];
    let late: MutationObserver | null = null;
    if (clean && !reversing) {
      const levels = new Set(items.map(item => item.parentElement));
      const opened = performance.now(); let next = 0;
      late = new MutationObserver(records => {
        if (performance.now() - opened > 800) { late?.disconnect(); return; }
        for (const record of records) for (const added of record.addedNodes) {
          if (!(added instanceof HTMLElement) || added.dataset.vaporLayer !== undefined) continue;
          if (levels.size ? !levels.has(added.parentElement) : added.parentElement !== node) continue;
          lateRows.push(added.animate([{ opacity: 0, transform: `translateY(${profile.itemRise}px)` }, { opacity: 1, transform: 'none' }], { duration, delay: Math.min(next++, profile.steps) * profile.stagger, easing: ease, fill: 'backwards' }));
        }
      });
      late.observe(node, { childList: true, subtree: true });
    }
    let cancelled = false, finished = false;
    const clear = () => { for (const animation of mist) animation.cancel(); vapor?.remove(); late?.disconnect(); };
    const settle = () => { if (cancelled || finished) return; finished = true; clearTimeout(timer); for (const animation of [...shell, ...staggered]) animation.cancel(); clear(); rest(); phase.current = 'open'; };
    finish.current = settle;
    // Cancel finished effects as well: hidden WebContents can defer completion
    // notifications after the last painted frame.
    const timer = setTimeout(settle, total + 16);
    return () => { cancelled = true; clearTimeout(timer); for (const animation of [...staggered, ...lateRows]) animation.cancel(); clear(); freeze(); finish.current = () => {}; };
  }, [variant, reduced, visible, scene]);
  const style = origin ? { '--vx': `${origin.x * 100}%`, '--vy': `${origin.y * 100}%` } as CSSProperties : undefined;
  return <div ref={root} className={className} style={style} onClickCapture={() => finish.current()} onKeyDownCapture={() => finish.current()}>{children}</div>;
}
