import { DotMatrix } from '../../components/DotMatrix';

export type TorMarkState = 'connecting' | 'ready' | 'error';
/** Tor's status light: A's classic square dot matrix (bible §3.7), never a picture drawn in dots.
 * Connecting = the square layers fill from the centre with real bootstrap progress (0–100), dot by dot; connected = a
 * layer ripples outward through the half-lit grid; stopped = only the centre, at half (A's Tor patterns, round 2). Colour
 * comes from the Tor ink (tor.css). */
export function TorMark({ state, progress = 0, size = 16, reducedMotion = false, label }: { state: TorMarkState; progress?: number; size?: number; reducedMotion?: boolean; label?: string }) {
  const preset = state === 'ready' ? 'tor' : state === 'error' ? 'torStopped' : 'torConnecting';
  return <span className="tor-mark" data-state={state}><DotMatrix preset={preset} progress={progress / 100} size={size} tone="ink" reducedMotion={reducedMotion} label={label}/></span>;
}
export const torMarkState = (state?: string): TorMarkState => state === 'ready' ? 'ready' : state === 'error' ? 'error' : 'connecting';
