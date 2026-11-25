import { useSyncExternalStore } from 'react';
import { ambientLayers, ambientSideRef } from '../../ui/ambient';

/** Ambient mode's light inside the sidebar (ui/ambient.ts): rendered ONLY while Ambient mode is on (and for one fade after it is switched off, so the light fades away and is never cut).
 *  With the setting off there is no element at all: every style recalculation walks every element, and the Sidebar mode morph recalculates the whole tree on each frame. It sits where the
 *  sidebar's own light layers sit, so it opens, slides and leaves with the sidebar. */
export function AmbientSideLayer({ className = '' }: { className?: string } = {}) {
  const present = useSyncExternalStore(ambientLayers.subscribe, ambientLayers.get, ambientLayers.get);
  return present ? <span className={`st-amb-side${className ? ' ' + className : ''}`} aria-hidden="true" ref={ambientSideRef}/> : null;
}
