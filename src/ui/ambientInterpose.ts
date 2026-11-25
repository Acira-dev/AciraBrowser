import type { AmbientSample } from './ambientColours';

/**
 * The seam between main's Ambient pushes and ambient.ts (Beta 14, the video's light, see videoGlow.ts). Main calls `window.__aciraAmbient(sample)`; ambient.ts assigns that function when it installs. This stands in the middle from
 * the first script on, without a line changed in either of them:
 *   - every push passes through to ambient.ts, EXCEPT a push for a tab the caller says is held (the page fills and the video's own light is on): that one is remembered, not drawn;
 *   - the last push of each tab is remembered (a handful of them), because main does not push a read that equals its last one: when the page lets go, `restore(tabId)` draws the remembered read again, so the video's
 *     colours never stay on the frame after the fullscreen;
 *   - a `null` (main putting the light away: Ambient off, a private or shared tab) clears the memory and passes through.
 * Pure: the window is a parameter, so a test holds every rule.
 */
export type AmbientPush = AmbientSample & { reason?: string };
export type AmbientReceive = (next: AmbientPush | null) => void;
export interface Interposer { install(target: { __aciraAmbient?: AmbientReceive }): void; /** Draw this directly (the video's own light): it is neither held nor remembered as main's read. */ deliver(next: AmbientPush | null): void; restore(tabId: string): void; remembered(tabId: string): AmbientPush | undefined }

const KEEP = 8;
/** `onInstall` is called when ambient.ts assigns its entry: Ambient installs only once the site glow has painted a colour (siteGlowEngine.ensureLayers), which for a page filling with the video's light can be a moment after the light was first asked for. */
export function createInterposer(held: (tabId: string) => boolean, onInstall: () => void = () => {}): Interposer {
  const last = new Map<string, AmbientPush>();
  let original: AmbientReceive | null = null;
  const wrapper: AmbientReceive = next => {
    if (next?.id) { last.delete(next.id); last.set(next.id, next); while (last.size > KEEP) last.delete(last.keys().next().value as string); }
    else if (!next) last.clear();
    if (next?.id && held(next.id)) return;
    original?.(next);
  };
  return {
    install(target) {
      const existing = target.__aciraAmbient; if (typeof existing === 'function') original = existing;
      try { Object.defineProperty(target, '__aciraAmbient', { configurable: true, get: () => (original ? wrapper : undefined), set: (fn: AmbientReceive) => { original = fn; try { onInstall(); } catch { /* a listener must not break the install */ } } }); } catch { /* not ours to take: the video's light still lights, and the page's edge light returns with main's next read */ }
    },
    deliver: next => original?.(next),
    restore(tabId) { const back = last.get(tabId); if (back) original?.(back); },
    remembered: tabId => last.get(tabId),
  };
}
