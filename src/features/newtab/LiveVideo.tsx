import { useEffect, useRef, useState } from 'react';
import type { OwnVideo } from '../../runtime/connectedServices';
import { idleLimit, livePlay, releaseWhen, RELEASE_AFTER_MS, type LivePauseReason } from '../../ui/liveWallpaper';
import { usePowerState } from '../../ui/ownVideo';
import './live-video.css';

/** desktop/input-rest.cjs REST_AFTER_MS: main says `input-idle` this long after the last input, so the quiet time began that long before it. */
export const INPUT_REST_MS = 10 * 1000;

type Signals = { windowActive: boolean; idle: boolean; visible: boolean; systemReduced: boolean };
const readSignals = (): Signals => {
  const root = document.documentElement;
  return { windowActive: root.getAttribute('data-window-active') !== 'false', idle: root.hasAttribute('data-input-idle'), visible: document.visibilityState !== 'hidden', systemReduced: matchMedia('(prefers-reduced-motion: reduce)').matches };
};
/** The window's own signals, from the root (windowActive.ts, edgeBreath.ts applyInputIdle) and the page. */
function useSignals(): Signals {
  const [signals, setSignals] = useState(readSignals);
  useEffect(() => {
    const update = () => setSignals(old => { const next = readSignals(); return old.windowActive === next.windowActive && old.idle === next.idle && old.visible === next.visible && old.systemReduced === next.systemReduced ? old : next; });
    const observer = new MutationObserver(update); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-window-active', 'data-input-idle'] });
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    document.addEventListener('visibilitychange', update); query.addEventListener?.('change', update); update();
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); query.removeEventListener?.('change', update); };
  }, []);
  return signals;
}

/**
 * Beta 14.4 live wallpaper: the person's own video over the picture's still (NewTabPage.tsx ArtLayer draws the still, its first frame, at once).
 * - Never any sound: muted, volume 0, no controls, no picture-in-picture, no remote playback, not focusable, no pointer (a right-click lands on the page).
 *   Chromium gives a muted player no media session: no Now Playing card, no media keys, no sound mark on the tab.
 * - No flash: it fades in only once a frame of it has been presented; until then, and whenever it cannot play, the still shows.
 * - It plays only while ui/liveWallpaper.ts livePlay says so. A pause keeps the frame where it is (on the decoder: measured, a paused video costs what
 *   no video costs). Paused RELEASE_AFTER_MS while the page cannot be seen (releaseWhen), that frame is kept as a still (`frozen`) and the decoder is
 *   released (source removed); on resume the frozen frame stays until the video plays again from the same place, and the video fades in over it.
 * - One element; its source is released when the New Tab goes.
 */
export function LiveVideo({ video, playOnBattery, reduced }: { video: OwnVideo; playOnBattery: boolean; reduced: boolean }) {
  const element = useRef<HTMLVideoElement>(null), position = useRef(0), frozenUrl = useRef<string | null>(null);
  const signals = useSignals(), power = usePowerState(true);
  const [quietSince, setQuietSince] = useState<number | null>(null), [, tick] = useState(0);
  const [shown, setShown] = useState(false), [frozen, setFrozen] = useState<string | null>(null);
  useEffect(() => { setQuietSince(signals.idle ? Date.now() - INPUT_REST_MS : null); }, [signals.idle]);
  const limit = idleLimit(power.onBattery);
  useEffect(() => { if (quietSince === null) return; const timer = window.setTimeout(() => tick(value => value + 1), Math.max(0, quietSince + limit - Date.now()) + 20); return () => window.clearTimeout(timer); }, [quietSince, limit]);
  const decision = livePlay({ visible: signals.visible, windowActive: signals.windowActive, quietMs: quietSince === null ? 0 : Math.max(0, Date.now() - quietSince), reducedMotion: reduced || signals.systemReduced, lowPower: power.lowPower, onBattery: power.onBattery, playOnBattery, powerEfficient: video.powerEfficient });
  const play = decision.play, reason: LivePauseReason | 'playing' = decision.play ? 'playing' : decision.reason;
  // the decoder is given back only while nobody can see the page (releaseWhen): measured, a paused video costs what no video costs (CPU and wakeups,
  // 3 x 60 s), and the kept frame is drawn through a canvas, a few levels off the compositor's own picture of the video
  const release = releaseWhen(reason);

  // never any sound, whatever touches the element
  useEffect(() => {
    const el = element.current; if (!el) return;
    const hush = () => { if (!el.muted || el.volume !== 0) { el.muted = true; el.volume = 0; } };
    el.muted = true; el.defaultMuted = true; el.volume = 0; el.disablePictureInPicture = true; el.disableRemotePlayback = true;
    el.addEventListener('volumechange', hush);
    return () => el.removeEventListener('volumechange', hush);
  }, []);

  // play / pause / release
  useEffect(() => {
    const el = element.current; if (!el) return;
    let alive = true, releaseTimer = 0;
    const presented = (then: () => void) => { const rvfc = (el as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback; if (rvfc) rvfc.call(el, () => { if (alive) then(); }); else el.addEventListener('timeupdate', () => { if (alive) then(); }, { once: true }); };
    if (play) {
      if (!el.getAttribute('src')) {
        const at = position.current;
        if (at > 0) el.addEventListener('loadedmetadata', () => { try { el.currentTime = at; } catch { /* the start then */ } }, { once: true });
        el.src = video.url;
      }
      const onPlaying = () => presented(() => {
        setShown(true);
        if (frozenUrl.current) { const url = frozenUrl.current; window.setTimeout(() => { if (frozenUrl.current === url) { frozenUrl.current = null; setFrozen(null); } }, 700); }
      });
      el.addEventListener('playing', onPlaying, { once: true });
      void el.play().catch(() => undefined);
      return () => { alive = false; el.removeEventListener('playing', onPlaying); };
    }
    if (el.getAttribute('src')) {
      el.pause(); position.current = el.currentTime || position.current;
      if (release) releaseTimer = window.setTimeout(() => {
        // keep this very frame as the still, then let the decoder go
        const canvas = document.createElement('canvas'); canvas.width = el.videoWidth || 1; canvas.height = el.videoHeight || 1;
        try { canvas.getContext('2d')!.drawImage(el, 0, 0, canvas.width, canvas.height); } catch { return; }
        // a data: JPEG (the interface's CSP draws data: pictures, not blob: ones)
        let url = '';
        try { url = canvas.toDataURL('image/jpeg', .9); } catch { return; }
        const image = new Image(); image.src = url;
        void image.decode().then(() => {
          if (!alive) return;
          frozenUrl.current = url; setFrozen(url);
          requestAnimationFrame(() => requestAnimationFrame(() => { if (!alive) return; el.dataset.instant = ''; setShown(false); position.current = el.currentTime || position.current; el.removeAttribute('src'); el.load(); requestAnimationFrame(() => { delete el.dataset.instant; }); }));
        }, () => undefined);
      }, RELEASE_AFTER_MS);
    }
    return () => { alive = false; window.clearTimeout(releaseTimer); };
  }, [play, release, video.url]);

  // the New Tab goes: release the source and the frozen frame
  useEffect(() => () => { const el = element.current; if (el) { el.pause(); el.removeAttribute('src'); el.load(); } frozenUrl.current = null; }, []);

  return <>
    {frozen && <img className="nt-art-frozen" src={frozen} alt="" aria-hidden="true" decoding="sync" draggable={false} />}
    <video ref={element} className="nt-art-video" data-shown={shown || undefined} data-live={reason} muted loop playsInline preload="auto" aria-hidden="true" tabIndex={-1} disablePictureInPicture disableRemotePlayback controls={false} />
  </>;
}
