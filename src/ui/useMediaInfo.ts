import { useCallback, useEffect, useRef, useState } from 'react';
import { runtime } from '../runtime/client';
import type { TabSession } from '../runtime/types';
import { pollDelay, readInfo, type PlayerInfo } from './nowPlaying';

/** What the now-playing card knows about its tab (Beta 14): asks main (`media` / `info`) while a card is on screen: every
 * second for an open, playing card (the position), less often for a compact or paused one (the track's name and artwork), never
 * while the window is hidden, and at once when the tab's sound starts, stops or its title changes. One question at a time; an
 * answer that never comes (a hung page) only leaves the last one on show. Nothing runs when no card is shown. */
export interface MediaReading { info: PlayerInfo | null; /** performance.now() of the answer that `info` came from. */ answeredAt: number; /** The artwork (a small data: URL) for `info.artSrc`, once main has it. */ art: string | null; refresh: (delay?: number) => void }

export function useMediaInfo(tab: Pick<TabSession, 'id' | 'media' | 'title'>, open: boolean): MediaReading {
  const [reading, setReading] = useState<{ info: PlayerInfo | null; answeredAt: number }>({ info: null, answeredAt: 0 });
  const [art, setArt] = useState<{ src: string; data: string } | null>(null);
  const held = useRef<{ src: string | null }>({ src: null }), busy = useRef(false), timer = useRef(0), alive = useRef(true), soon = useRef(0);
  const playing = tab.media === 'playing';
  const shape = useRef({ playing, open }); shape.current = { playing, open };

  const ask = useCallback(async () => {
    if (busy.current || !alive.current) return;
    busy.current = true;
    try {
      const answer = readInfo(await runtime.browserCommand({ type: 'media', tabId: tab.id, action: 'info', have: held.current.src }));
      if (!alive.current) return;
      if (answer) {
        setReading({ info: answer, answeredAt: performance.now() });
        if (!answer.artSrc) { held.current.src = null; setArt(null); }
        else if (answer.art) { held.current.src = answer.artSrc; setArt({ src: answer.artSrc, data: answer.art }); }
        else if (answer.artSrc !== held.current.src) { held.current.src = null; setArt(null); }
      }
    } catch { /* the tab is closing, or the page does not answer: the last answer stays */ }
    finally { busy.current = false; }
  }, [tab.id]);

  // The loop: ask, wait the delay the card's state calls for, ask again.
  useEffect(() => {
    alive.current = true;
    const tick = () => {
      window.clearTimeout(timer.current);
      const delay = pollDelay({ ...shape.current, hidden: document.hidden });
      if (delay === null) return;
      void ask().finally(() => { if (alive.current) timer.current = window.setTimeout(tick, pollDelay({ ...shape.current, hidden: document.hidden }) ?? delay); });
    };
    const wake = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', wake);
    tick();
    return () => { alive.current = false; window.clearTimeout(timer.current); window.clearTimeout(soon.current); document.removeEventListener('visibilitychange', wake); };
  }, [ask]);

  // A track change or a play / pause is worth an answer now (a beat later, so the page has moved first).
  useEffect(() => { window.clearTimeout(soon.current); soon.current = window.setTimeout(() => void ask(), 250); return () => window.clearTimeout(soon.current); }, [ask, tab.media, tab.title]);
  const refresh = useCallback((delay = 200) => { window.clearTimeout(soon.current); soon.current = window.setTimeout(() => void ask(), delay); }, [ask]);

  return { info: reading.info, answeredAt: reading.answeredAt, art: art && art.src === reading.info?.artSrc ? art.data : null, refresh };
}
