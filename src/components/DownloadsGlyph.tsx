import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { BrowserDownload } from '../runtime/types';
import { downloadActivity, isLiveDownload } from '../ui/downloadActivity';
import { DotMatrix } from './DotMatrix';
import './DownloadsGlyph.css';

const DONE_MS = 2200;

/** The download dot matrix: the grid fills with the real share received (`progress`, null while no size is known) and lights fall onto
 * the surface; `held` keeps the fill still (paused); `done` is the check. The progress is cut to whole dots, so the cross-fade
 * between steps never restarts on a byte count. */
export function DownloadMatrix({ phase, progress, grid = 5, size = 16, reducedMotion }: { phase: 'run' | 'held' | 'done'; progress: number | null; grid?: number; size?: number; reducedMotion: boolean }) {
  const cells = grid * grid, step = progress === null ? 0 : Math.round(progress * cells) / cells;
  return <DotMatrix preset={phase === 'done' ? 'check' : phase === 'held' ? 'downloadHeld' : 'download'} size={size} rows={grid} cols={grid} tone="accent" progress={step} reducedMotion={reducedMotion}/>;
}

/** The face of a downloads button (the sidebar footer's, the toolbar's): the download matrix while a file is coming in, a check for a
 * couple of seconds once the last one is done, and otherwise `idle`, the plain glyph. With nothing downloading no matrix is mounted,
 * so an idle browser draws no frames. */
export function DownloadsGlyph({ downloads, reducedMotion, idle, size = 16 }: { downloads: readonly BrowserDownload[]; reducedMotion: boolean; idle: ReactNode; size?: number }) {
  const activity = downloadActivity(downloads), [done, setDone] = useState(false);
  const live = useRef<Set<string>>(new Set()), timer = useRef(0), key = downloads.map(item => item.id + item.status).join();
  useEffect(() => {
    const now = new Set(downloads.filter(isLiveDownload).map(item => item.id));
    const finished = [...live.current].some(id => downloads.find(item => item.id === id)?.status === 'Ready');
    live.current = now;
    window.clearTimeout(timer.current);
    if (now.size) setDone(false);
    else if (finished) { setDone(true); timer.current = window.setTimeout(() => setDone(false), DONE_MS); }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const checking = done && activity.phase === 'idle';
  if (activity.phase === 'idle' && !checking) return <>{idle}</>;
  const phase = checking ? 'done' : activity.phase === 'held' ? 'held' : 'run';
  return <span className="dl-glyph" data-phase={phase} aria-hidden="true"><DownloadMatrix phase={phase} progress={activity.progress} size={size} reducedMotion={reducedMotion}/></span>;
}
