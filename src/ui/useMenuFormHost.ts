import { useLayoutEffect } from 'react';
import { runtime } from '../runtime/client';
import type { Rectangle } from '../runtime/types';

// Native DIPs round at the window boundary; do not ping-pong fractional CSS
// coordinates at 125/150% while the form itself has not moved.
const sameBounds = (a?:Rectangle|null,b?:Rectangle|null) => !a && !b || !!a && !!b && (['x','y','width','height'] as const).every(key=>Math.abs(a[key]-b[key])<=1);

/** Child-form input/crop geometry belongs to this exact popup generation. */
export function useMenuFormHost(overlayId?: number) {
  useLayoutEffect(() => {
    if (overlayId === undefined) return;
    let active = '', version = 0, alive = true, wanted: Rectangle | null = null;
    const publish = async (bounds: Rectangle | null) => {
      const serial = ++version, current = await runtime.getBrowserLayout();
      if (!alive || serial !== version || current.overlay?.id !== overlayId) return;
      if (sameBounds(current.overlay.auxiliaryBounds,bounds)) return;
      const overlay = { ...current.overlay };
      if (bounds) overlay.auxiliaryBounds = bounds; else delete overlay.auxiliaryBounds;
      runtime.setBrowserLayout({ ...current, overlay });
    };
    const receive = (event: Event) => {
      const { id, bounds } = (event as CustomEvent<{id:string;bounds:Rectangle|null}>).detail;
      if (bounds) { active = id; wanted = bounds; void publish(bounds); }
      else if (id === active) { active = ''; wanted = null; void publish(null); }
    };
    const unsubscribe = runtime.subscribeLayout(current => {
      if (active && wanted && current.overlay?.id === overlayId && !sameBounds(current.overlay.auxiliaryBounds,wanted)) void publish(wanted);
    });
    window.addEventListener('acira-menu-form-bounds', receive);
    return () => { alive = false; version++; unsubscribe(); window.removeEventListener('acira-menu-form-bounds', receive); };
  }, [overlayId]);
}
