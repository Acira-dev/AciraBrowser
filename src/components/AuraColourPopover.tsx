import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AuraColourPicker } from './AuraColourPicker';
import { frameStop } from '../ui/frameField';
import { rgb } from '../ui/colorMath';
import { popoverPlace, visibleArea, type Place } from './auraPlace';

/**
 * The aura picker's popover (14.1): under its trigger (the Finish row's + tile, a colour well), in the window's own layer so the theme's tokens
 * resolve, rising out of vapour like Settings' own lists (st-vapor) and going back the same way. Escape, Cancel or a press outside close it;
 * focus goes back to the trigger.
 *
 * LIVE FRAME (`preview`): while a colour is picked the frame already wears it, without anything being saved: the frame's colour variables on
 * `.app` are set to the picked colour's frame tone (ui/frameField.ts frameStop, the same rule the theme uses, so the saved look is the
 * previewed one). Cancel puts back what was there; Add leaves them, and the theme's next tokens are the same values.
 */
const FRAME_VARS = ['--chrome-rgb', '--sidebar-rgb', '--ed-chrome', '--frame-top-rgb'] as const;
const app = () => document.querySelector<HTMLElement>('.app.style-acira:not(.native-layer)');
export function AuraColourPopover({ anchor, initial, title, addLabel, preview = false, onAdd, onClose }: { anchor: HTMLElement; initial?: string; title?: string; addLabel?: string; preview?: boolean; onAdd: (hex: string) => void; onClose: () => void }) {
  const [state, setState] = useState<'open' | 'closing'>('open'), box = useRef<HTMLDivElement>(null), saved = useRef<Map<string, string> | null>(null), frame = useRef(0);
  const [place, setPlace] = useState<Place | null>(null), [height, setHeight] = useState(0);
  const restore = useCallback(() => {
    cancelAnimationFrame(frame.current);
    const host = app(), kept = saved.current; saved.current = null;
    if (host && kept) for (const [name, value] of kept) { if (value) host.style.setProperty(name, value); else host.style.removeProperty(name); }
  }, []);
  const close = useCallback((added: boolean) => {
    if (!added) restore(); else saved.current = null;
    setState('closing');
    const reduced = app()?.getAttribute('data-reduced-motion') === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(() => { onClose(); anchor.focus({ preventScroll: true }); }, reduced ? 0 : 130);
  }, [anchor, onClose, restore]);
  const tint = useCallback((hex: string) => {
    if (!preview) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const host = app(); if (!host) return;
      if (!saved.current) saved.current = new Map(FRAME_VARS.map(name => [name, host.style.getPropertyValue(name)]));
      const tone = frameStop(hex, host.getAttribute('data-appearance') === 'dark'), triple = rgb(tone).join(' ');
      host.style.setProperty('--chrome-rgb', triple); host.style.setProperty('--sidebar-rgb', triple); host.style.setProperty('--ed-chrome', tone);
      if (saved.current.get('--frame-top-rgb')) host.style.setProperty('--frame-top-rgb', triple);
    });
  }, [preview]);
  useLayoutEffect(() => {
    const place = () => setPlace({ anchor: anchor.getBoundingClientRect(), area: visibleArea(anchor) });
    place();
    const again = () => place();
    addEventListener('scroll', again, true); addEventListener('resize', again);
    return () => { removeEventListener('scroll', again, true); removeEventListener('resize', again); };
  }, [anchor]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (box.current && !box.current.contains(event.target as Node) && !anchor.contains(event.target as Node)) close(false); };
    addEventListener('pointerdown', outside, true);
    return () => removeEventListener('pointerdown', outside, true);
  }, [anchor, close]);
  useEffect(() => () => { if (saved.current) restore(); }, [restore]);   // unmounted while previewing (Settings left): the frame goes back
  // its own height, measured once it is laid out (before the first paint), decides where it stands
  useLayoutEffect(() => { const h = box.current?.getBoundingClientRect().height ?? 0; if (h && Math.abs(h - height) > 1) setHeight(h); });
  // THE KEYBOARD (found on real frames, 21 Nov: Escape after the + tile left the picker open): the picker focuses its light field as it mounts,
  // but the popover is still hidden then (measured before it is shown) and a hidden element takes no focus, so the keyboard stayed on the trigger.
  // Once shown, the field gets it (unless the person is already inside); and Escape on the trigger closes it too.
  const focused = useRef(false);
  useEffect(() => {
    if (!height || focused.current) return;
    focused.current = true;
    if (box.current && !box.current.contains(document.activeElement)) box.current.querySelector<HTMLElement>('.aura-field')?.focus({ preventScroll: true });
  }, [height]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && anchor.contains(event.target as Node)) { event.preventDefault(); event.stopPropagation(); close(false); } };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, [anchor, close]);
  const host = app();
  if (!host || !place) return null;
  const { left, top } = popoverPlace(place, height);
  return createPortal(<div ref={box} className="aura-pop" data-state={state} style={{ position: 'fixed', left, top, visibility: height ? undefined : 'hidden' }}>
    <AuraColourPicker initial={initial} title={title} addLabel={addLabel} onPreview={tint} onCancel={() => close(false)} onAdd={hex => { onAdd(hex); close(true); }} />
  </div>, host);
}
