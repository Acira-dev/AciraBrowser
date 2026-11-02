import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { TorMark, torMarkState } from './TorMark';
import { TOR_PROMISE, torLabel, useTorStatus } from './torClient';
import './tor.css';

import { t } from '../../i18n';
/** Tor is an onion (R3-59): a plain glyph on the icon grid, 16px box, 1.5px stroke (bible §3.6), the same everywhere Tor is offered: the
 * tab's trailing mark, menus, links. A bulb with its sprout and one inner layer. The dot matrix is only ever the pill's connecting
 * pattern, never a picture. */
export function TorGlyph({ size = 16, className = '', style }: { size?: number; className?: string; style?: CSSProperties }) {
  return <svg className={`tor-glyph ${className}`} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
    <path d="M8 4C6.9 5.9 2.6 7.1 2.6 10.3a5.4 5.4 0 0 0 10.8 0C13.4 7.1 9.1 5.9 8 4Z"/><path d="M8 4V1.9"/><path d="M8 7.2c-1.4 1.9-1.4 4.4 0 6.4"/>
  </svg>;
}

/** A Tor circuit: three relays on one route (New Tor circuit for this site, the circuit view). Same grid and stroke as the onion. */
export function TorCircuitGlyph({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <svg className={`tor-glyph ${className}`} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="3.2" cy="11.6" r="1.7"/><circle cx="8" cy="4.4" r="1.7"/><circle cx="12.8" cy="11.6" r="1.7"/><path d="M4.2 10.1 7 5.9M9 5.9l2.8 4.2"/>
  </svg>;
}

/** How long the connected ripple plays before the matrix fades away (ms, scaled by the animation speed in CSS), and how long the fade takes before it unmounts. */
const RIPPLE_MS = 1000, FADE_MS = 360;
/** The global animation speed (R3-17): `--motion-scale` on .app (Premium 1.7, Fast 1, Off 0). Read when a timer starts, so the ripple and the fade follow the setting like the CSS does. */
const motionScale = () => { try { const value = parseFloat(getComputedStyle(document.querySelector('.app') || document.documentElement).getPropertyValue('--motion-scale')); return Number.isFinite(value) ? Math.max(0, value) : 1; } catch { return 1; } };

/** The "Tor" pill in a Tor tab's address field (R3-62). While Tor connects it carries the classic square dot matrix filling with real
 * progress and the percentage. When Tor is connected the matrix ripples once, then fades out and its slot closes, leaving a clean
 * purple "Tor" pill that never animates again. A tab opened while Tor is already connected never shows the matrix at all. An error
 * keeps the (stopped) matrix in the danger ink until it is retried. */
export function TorChip({ onOpen, reducedMotion }: { onOpen: () => void; reducedMotion: boolean }) {
  const status = useTorStatus(), state = status?.state || 'starting', label = torLabel(status);
  const connecting = state !== 'ready' && state !== 'error';
  // 'off' = no matrix; 'on' = connecting or stopped; 'done' = the one connected ripple.
  const [matrix, setMatrix] = useState<'off' | 'on' | 'done'>('off'), [mounted, setMounted] = useState(false), seen = useRef(false);
  useEffect(() => {
    if (!status) return;
    if (state !== 'ready') { seen.current = true; setMatrix('on'); return; }
    // Ready: ripple once if this chip watched Tor connect; otherwise (a tab opened on a live connection) no matrix at all.
    setMatrix(seen.current && !reducedMotion && motionScale() > 0 ? 'done' : 'off'); seen.current = false;
  }, [status === null, state, reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (matrix !== 'off') setMounted(true);
    if (matrix === 'done') { const id = setTimeout(() => setMatrix('off'), RIPPLE_MS * motionScale()); return () => clearTimeout(id); }
    if (matrix === 'off') { const id = setTimeout(() => setMounted(false), reducedMotion ? 0 : FADE_MS * motionScale()); return () => clearTimeout(id); }
  }, [matrix, reducedMotion]);
  const markState = matrix === 'done' ? 'ready' : torMarkState(state);
  return <button type="button" className="tor-chip" data-popup-trigger aria-haspopup="dialog" data-state={state} data-matrix={matrix === 'off' ? 'off' : 'on'} aria-label={`${label}. Show Tor status`} title={`${label}. ${TOR_PROMISE}`} onClick={onOpen}>
    {(mounted || matrix !== 'off') && <span className="tor-chip-mark" aria-hidden="true"><TorMark state={markState} progress={status?.progress || 0} size={16} reducedMotion={reducedMotion}/></span>}
    <span className="tor-chip-label">{t("connection.tor")}</span>
    {connecting && status && status.progress > 0 && <span className="tor-chip-progress tabular">{status.progress}%</span>}
    <span className="tor-chip-live" aria-live="polite">{state === 'ready' ? t("torchip.connectedToTor") : state === 'error' ? label : ''}</span>
  </button>;
}

/** The page-information button's icon in a Tor tab: while Tor connects the chip carries the only animation (no second matrix beside it);
 * once Tor is connected a page that is still loading shows the classic loader in Tor's ink. */
export function TorSecurityGlyph({ loading, fallback, loader }: { loading: boolean; fallback: ReactNode; loader: ReactNode }) {
  const status = useTorStatus();
  return status?.state === 'ready' && loading ? <span className="tor-mark">{loader}</span> : <>{fallback}</>;
}
