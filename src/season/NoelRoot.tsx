import { useEffect } from 'react';
import { noelPrefs } from './noelSettings';
import { configure } from './winter/controller';
import { frostStrip } from './winter/frostStrip';
import type { Settings } from '../runtime/types';
import './noel.css';

/**
 * Noël, the opt-in Christmas theme. This component renders nothing: it tells the page what the person chose
 * (`<html data-noel="sidebar|window|off">`, `data-noel-hat`), makes the frost the first time it is needed, and hands the choice to the snow's controller.
 * With the theme off there is no attribute, no canvas and no listener doing work: it costs what it cost before.
 */
const made: { dark?: boolean; light?: boolean } = {};
/** The frost tile for one appearance, made once (about 20 ms), a task of its own so no frame waits for it. */
function ensureFrost(dark: boolean, done: () => void): void {
  const key = dark ? 'dark' : 'light'; if (made[key]) { done(); return; }
  setTimeout(() => {
    try { document.documentElement.style.setProperty(`--noel-frost-${key}`, `url(${frostStrip(dark, 7)})`); made[key] = true; } catch { /* no frost: the snow and the tree still show */ }
    done();
  }, 0);
}
export function NoelRoot({ settings, dark }: { settings: Pick<Settings, 'noelOn' | 'noelSnow' | 'noelHat' | 'noelKeepSnowing' | 'reducedMotion'>; dark: boolean }) {
  const p = noelPrefs(settings), reduced = !!settings.reducedMotion;
  useEffect(() => {
    const root = document.documentElement;
    if (!p.on) {
      for (const name of ['data-noel', 'data-noel-hat', 'data-noel-frost', 'data-noel-new']) root.removeAttribute(name);
      configure({ on: false, snow: p.snow, dark, reduced, keep: p.keep }); return;
    }
    const first = !root.hasAttribute('data-noel');
    root.setAttribute('data-noel', p.snow);
    if (p.hat) root.setAttribute('data-noel-hat', ''); else root.removeAttribute('data-noel-hat');
    if (first) { root.setAttribute('data-noel-new', ''); window.setTimeout(() => root.removeAttribute('data-noel-new'), 1400); }
    configure({ on: true, snow: p.snow, dark, reduced, keep: p.keep });
    let live = true;
    ensureFrost(dark, () => { if (live) root.setAttribute('data-noel-frost', ''); });
    return () => { live = false; };
  }, [p.on, p.snow, p.hat, dark, reduced]);
  return null;
}
