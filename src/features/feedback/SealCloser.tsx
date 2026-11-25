import {useCallback,useEffect,useRef,useState} from 'react';
import {noteUse} from '../metrics/noteUse';
import {loadLiveSeal,releaseLiveSeals,type LiveSeal} from '../welcome/welcomeCoin';
import {followPointer} from '../../ui/pointerTilt';
import {formatCardNumber,type MemberRank} from '../memberCard/cardData';
import {Seal,sealForm,sealStyle,type SealKind} from './Seal';
import {PLAIN_NUMBER,TILT_FRAMES} from './sealNumbers';
import './seal-closer.css';

/** "Look closer" (Beta 14): where a seal is shown large (the reveal, the activation sheet, the seal screen opened from the profile viewer) a click enlarges it; while it is enlarged, moving the pointer across it
 * tilts it left and right through nine frames pre-rendered with the reference design's own renderer (reported 15 Nov 19:40: "ours look perfect"; HIS strip's camera tilt rotX -0.08 and light, rotY -0.42 to 0.42:
 * public/seals/tilt/<kind>/t0..t8.webp). A click away (or Escape) returns it. Never a light spot that follows the cursor. The frames are fetched only when the seal is first looked at, held while it is enlarged,
 * and let go when it returns; the tilt picture fades in over the still one and out again, so nothing cuts. Motion set to Off (or reduced motion): it enlarges and stays still.
 * The frames are the plain picture's coin turned (Insider No. 0001, Founding No. 0003: PLAIN_NUMBER): an Insider or Founding seal shown with another number (its OWN per-number still) only enlarges, so the
 * number on the coin never changes while it is looked at (per-number tilt frames are a decision for the team: see the earlier work report). */
const frameUrl = (kind: SealKind, x: number) => `./seals/tilt/${kind}/t${x}.webp`;
/** The frame for a pointer at nx in -1..1 from the seal's centre: the nearest of the nine. */
export const frameFor = (nx: number) => Math.max(0, Math.min(TILT_FRAMES - 1, Math.round((Math.max(-1, Math.min(1, nx)) + 1) / 2 * (TILT_FRAMES - 1))));
/** Whether the tilt frames show the same coin as the still: always for a rank without a number and for a seal with no number at all, and for Insider/Founding only when the member's number IS the plain picture's
 * (Insider No. 1, Founding No. 3). Every other number, in the rendered range or above it, is a different coin: the frames (a fallback only, since the live coin turns every number) would show another member's number. */
export const tiltMatches = (kind: SealKind, size: number, number: number | null) => sealForm(size) !== 'full' || (kind !== 'insider' && kind !== 'founding') || !Number.isInteger(number) || (number as number) < 1 || number === PLAIN_NUMBER[kind];

const reducedMotion = () => { try { return Boolean(document.querySelector('.app[data-motion-speed="off"],.app[data-reduced-motion="true"]')) || window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** `rest` is the seal's size at rest (CSS px), `big` its size when looked at closer. The box is always `big` wide and high, so enlarging moves nothing around it. `number` is the member's own number. */
/** `always`: the seal is shown looked-at-closer from the first frame and stays so (the full-window viewer, src/features/welcome/Viewer.tsx, owns the way out: Escape and a click away are its own). */
export function SealCloser({ kind, rest = 128, big = 224, label, number = null, always = false }: { kind: SealKind; rest?: number; big?: number; label?: string; number?: number | null; always?: boolean }) {
  const [open, setOpen] = useState(always), [frame, setFrame] = useState<string | null>(null), [ready, setReady] = useState(false);
  const [live, setLive] = useState(false), [liveFailed, setLiveFailed] = useState(false), liveBox = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLButtonElement>(null), held = useRef<Map<string, HTMLImageElement>>(new Map()), still = useRef(false), at = useRef('');
  const tilts = tiltMatches(kind, big, number);
  const close = useCallback(() => { setOpen(false); setReady(false); }, []);

  // Fetch and decode the frames the first time the seal is looked at; hold them while it is enlarged and let them go when it returns.
  useEffect(() => {
    if (!open) { const timer = window.setTimeout(() => { held.current.clear(); setFrame(null); at.current = ''; }, 340); return () => window.clearTimeout(timer); }
    still.current = reducedMotion() || !tilts || !liveFailed;   // the nine frames are the fallback only: the live coin (below) is the look-closer for every number
    if (still.current) return;
    let alive = true;
    const urls = Array.from({ length: TILT_FRAMES }, (_, x) => frameUrl(kind, x));
    const load = (url: string) => { const image = new Image(); image.decoding = 'async'; image.src = url; held.current.set(url, image); return image.decode().catch(() => undefined); };
    const middle = urls[Math.floor(TILT_FRAMES / 2)];
    void load(middle).then(() => { if (!alive) return; setFrame(middle); at.current = middle; setReady(true); void Promise.all(urls.filter((url) => url !== middle).map(load)); });
    return () => { alive = false; };
  }, [open, kind, tilts, liveFailed]);

  // The look-closer is the LIVE 3D coin (the same three.js coin and shader as the Welcome's enlarged seal, public/welcome-coin/live.js; the rim legend carries the member's own number): it opens over the
  // still at the still's own pose (no jump), then follows the pointer anywhere in the window (the whole window is the trackpad, as in the Welcome) with the foil and the bevel highlights moving with it.
  // The 17 Nov packaged -3 showed the still only for every number but the plain sprite's (the nine tilt frames carry one coin), so the team's No. 1 seal could not be moved. Reduced motion keeps the
  // still; if WebGL or the module fails the still stays (and the nine frames, where they fit, take over).
  useEffect(() => {
    if (!open || reducedMotion()) return;
    let alive = true, raf = 0, coin: LiveSeal | null = null; const pose = { x: 0, y: 0, tx: 0, ty: 0 };
    const tick = () => {
      raf = 0; if (!alive || !coin) return;
      pose.x += (pose.tx - pose.x) * 0.14; pose.y += (pose.ty - pose.y) * 0.14;
      coin.draw(-0.1 + pose.y * 0.5, 0.14 + pose.x * 0.72, pose.x * 1.6 - pose.y * 0.5);
      if (Math.abs(pose.tx - pose.x) > 0.0006 || Math.abs(pose.ty - pose.y) > 0.0006) raf = requestAnimationFrame(tick);   // settled: no more frames until the pointer moves
    };
    const move = (x: number, y: number) => {
      pose.tx = Math.max(-1, Math.min(1, (x / Math.max(1, window.innerWidth) - 0.5) * 2.2));
      pose.ty = Math.max(-1, Math.min(1, (y / Math.max(1, window.innerHeight) - 0.5) * 2.2));
      if (!raf && coin) raf = requestAnimationFrame(tick);
    };
    // the pointer leaving the window lets the coin ease back to rest; a press on the coin captures the pointer, so it goes on turning while the pointer is outside the coin or the window, and the release ends it (src/ui/pointerTilt.ts)
    const rest = () => { pose.tx = 0; pose.ty = 0; if (!raf && coin) raf = requestAnimationFrame(tick); };
    const dpr = window.devicePixelRatio || 1;
    loadLiveSeal(Math.round(460 * dpr), kind as MemberRank, formatCardNumber(number)).then((made) => {
      if (!alive || !liveBox.current) return;
      coin = made; made.canvas.classList.add('seal-closer-canvas'); liveBox.current.replaceChildren(made.canvas);
      made.draw(-0.1, 0.14, 0);                     // the still's pose
      setLive(true);
    }).catch(() => { if (alive) setLiveFailed(true); });
    const stopFollow = followPointer({ aim: move, rest, press: box.current });
    return () => { alive = false; if (raf) cancelAnimationFrame(raf); stopFollow(); setLive(false); liveBox.current?.replaceChildren(); releaseLiveSeals(); };   // the seal went back (or the view closed): the GPU memory goes with it
  }, [open, kind, number]);

  // A click away, Escape, and (while enlarged) the pointer scrubbing the sequence.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
    const move = (event: PointerEvent) => {
      if (still.current || !box.current) return;
      const rect = box.current.getBoundingClientRect();
      const url = frameUrl(kind, frameFor((event.clientX - (rect.left + rect.width / 2)) / (rect.width * 0.75)));
      if (url !== at.current && held.current.get(url)?.complete) { at.current = url; setFrame(url); }
    };
    if (!always) { window.addEventListener('pointerdown', away, true); window.addEventListener('keydown', key, true); }
    window.addEventListener('pointermove', move);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key, true); window.removeEventListener('pointermove', move); };
  }, [open, kind, close, always]);

  const toggle = () => { if (always) return; if (!open) noteUse('insiderSealCloser'); if (open) close(); else setOpen(true); };
  useEffect(() => { if (always) noteUse('insiderSealCloser'); }, [always]);
  return <button type="button" ref={box} className="seal-closer" data-open={open || undefined} data-always={always || undefined} data-tilt={(open && ready && frame) || undefined} data-live={(open && live) || undefined} tabIndex={always ? -1 : undefined} aria-label={label} aria-pressed={always ? undefined : open} title={always ? undefined : label} style={{ width: big, height: big }} onClick={toggle}>
    <span className="seal-closer-rest" style={{ width: big, height: big, transform: open ? undefined : `scale(${rest / big})` }}><Seal kind={kind} size={big} number={number} skipLive={always} /></span>
    <span className="seal-closer-live" data-ready={(open && live) || undefined} style={sealStyle(big)} ref={liveBox} aria-hidden="true" />
    {frame && <img className="seal-closer-tilt" data-ready={ready || undefined} src={frame} style={sealStyle(big)} alt="" aria-hidden="true" draggable={false} />}
  </button>;
}
