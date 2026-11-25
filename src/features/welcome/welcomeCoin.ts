import { SEAL_DESIGN } from '../feedback/sealNumbers';
import type { MemberRank } from '../memberCard/cardData';

/** Beta 14: the enlarged coin. "Click to look closer" enlarges the seal into a LIVE WebGL coin: the reference design's own three.js scene and shader (public/welcome-coin/: live.js, seal4.js, emblems.js,
 * three; ink4.js is his with the one in-place relabel hook of earlier work, the same file the member card's token uses), drawn every frame the pose changes (pointer x/y tilt the coin and turn the studio
 * light, so the foil and the bevel highlights move with the hand). At rest the seal is the supplied sprite (byte for byte); the live coin is loaded lazily, 1.4 s after the Gift step opens.
 * Since the seal swap of 15 Nov (22:37) the design a rank wears is SEAL_DESIGN[rank] (Insider = his black 'founding' design, Founding = his compass 'insider' design), and the rim words are lettered
 * for the rank with the member's own number, in place: each replaced word centred where his word was (the hook), exactly as earlier work's numbered seals and the card's tokens. */
export interface LiveSeal {
  canvas: HTMLCanvasElement;
  draw: (rx: number, ry: number, light: number) => void;
  /** Lets the WebGL context go while no seal is shown (the GPU memory is freed at once); the next `loadLiveSeal` brings it back. */
  release: () => void;
  /** Brings a released context back and redraws the rest pose (resolves when it is drawable again). */
  restore: () => Promise<void>;
}
/** One coin per rank, and the number it is lettered for: his modules keep ONE coin (and one ink texture) per rank for the life of the page, so a second number cannot be lettered on it. A request for another
 * number than the first one's is refused (a coin lettered with another member's number must never be shown); the seal's own still carries the right number. */
const loaded: Record<string, Promise<LiveSeal>> = {};
const letteredFor: Record<string, string | null> = {};
const SOURCE = ['', 'welcome-coin', 'live.js'].join('/');
const INK = ['', 'welcome-coin', 'ink4.js'].join('/');
/** His rim legends as he wrote them (what is checked before anything is changed) and what they say now for the rank. */
const LEGEND_FOR: Partial<Record<MemberRank, { was: string[]; words: (no: string) => string[] }>> = {
  insider: { was: ['ACIRA', 'FOUNDING CONTRIBUTOR', 'No. 0001', 'EST. 2026', 'AUTHENTIC'], words: (no) => ['ACIRA', 'INSIDER', no, 'EST. 2026', 'AUTHENTIC'] },
  founding: { was: ['ACIRA', 'INSIDER', 'CERTIFIED MEMBER', 'No. 0001', 'EST. 2026', 'AUTHENTIC'], words: (no) => ['ACIRA', 'FOUNDING', 'CERTIFIED MEMBER', no, 'EST. 2026', 'AUTHENTIC'] },
};
type Ink = { LEGEND: Record<string, string[]>; setRelabel: (fn: ((groups: string[]) => string[] | null) | null) => void };
/** One live coin per rank; `px` is the drawing-buffer size in device pixels; `number` is the member's own number as the card prints it ("0042"), for the rim of an Insider's or a Founding Contributor's coin. */
export const loadLiveSeal = (px: number, rank: MemberRank = 'early', number: string | null = null): Promise<LiveSeal> => {
  const have = Object.hasOwn(loaded, rank);
  if (have && letteredFor[rank] !== number) return Promise.reject(new Error('the coin of this page is lettered for another number'));
  if (!have) letteredFor[rank] = number;
  return (loaded[rank] ??= (async () => {
    // the legend font (his Windows-only Bahnschrift is replaced by the approved stand-in, as in the card's tokens): loaded with the card's resources
    // @ts-ignore the renderer's resources module is plain JavaScript without declarations
    try { await ((await import('../memberCard/renderer/resources.js')) as { loadCardResources: () => Promise<void> }).loadCardResources(); } catch { /* the coin still draws, with the fallback face */ }
    const design = SEAL_DESIGN[rank], rim = LEGEND_FOR[rank];
    const ink = rim ? await (import(/* @vite-ignore */ INK) as Promise<Ink>) : null;
    if (ink && rim && JSON.stringify(ink.LEGEND[design]) === JSON.stringify(rim.was)) { const now = rim.words(`No. ${number ?? '0001'}`); ink.setRelabel((groups) => (JSON.stringify(groups) === JSON.stringify(rim.was) ? now : null)); }
    try { return wrap(((await (import(/* @vite-ignore */ SOURCE) as Promise<{ liveSeal: (r: string, look: string, px: number) => { canvas: HTMLCanvasElement; draw: LiveSeal['draw'] } }>)).liveSeal(design, design, px))); }
    finally { ink?.setRelabel(null); }
  })()).then(async (seal) => { await seal.restore(); return seal; });
};

/** The coin with the means to let its GPU memory go and take it back: WEBGL_lose_context on its canvas (three.js re-creates what it needs when the context is restored). While released, `draw` does nothing. */
function wrap(inner: { canvas: HTMLCanvasElement; draw: LiveSeal['draw'] }): LiveSeal {
  let released = false;
  // the extension object is kept from the moment of release: while a context is lost, getExtension() answers null, and the restore needs this very object
  let lose: WEBGL_lose_context | null = null;
  const extension = () => { try { return (inner.canvas.getContext('webgl2') as WebGL2RenderingContext | null)?.getExtension('WEBGL_lose_context') ?? null; } catch { return null; } };
  return {
    canvas: inner.canvas,
    draw: (rx, ry, light) => { if (!released) inner.draw(rx, ry, light); },
    release: () => { if (released) return; const ext = extension(); if (!ext) return; try { ext.loseContext(); lose = ext; released = true; } catch { /* stays as it is */ } },
    restore: async () => {
      if (!released) return;
      const ext = lose;
      if (ext) {
        await new Promise<void>((done) => { const timer = setTimeout(done, 3000); inner.canvas.addEventListener('webglcontextrestored', () => { clearTimeout(timer); done(); }, { once: true }); try { ext.restoreContext(); } catch { clearTimeout(timer); done(); } });
      }
      released = false; lose = null;
      inner.draw(-0.1001, 0.14, 0); inner.draw(-0.1, 0.14, 0);   // the rest pose (the first call defeats the coin's pose cache, so the picture is drawn again)
    },
  };
}

/** Lets every coin of this page release its GPU memory (a seal or the Welcome's enlarged coin has gone). The next `loadLiveSeal` restores it. */
export const releaseLiveSeals = () => { for (const rank of Object.keys(loaded)) void loaded[rank].then((seal) => seal.release(), () => undefined); };
