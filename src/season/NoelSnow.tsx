import { useLayoutEffect, useRef } from 'react';
import { registerSidebar } from './winter/controller';

/** The sidebar's snow: the canvas the flakes fall on (it exists only while something is in the air) and the small picture of the drift along the sidebar's foot. Both are the bottom-most
 *  things in the sidebar, under its rows, and travel with it. Mount it as a child of the sidebar (`.acira-sidebar`). */
export function NoelSnow() {
  const snow = useRef<HTMLCanvasElement>(null), drift = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const s = snow.current, d = drift.current, aside = s?.closest<HTMLElement>('.acira-sidebar'); if (!s || !d || !aside) return;
    return registerSidebar(aside, s, d);
  }, []);
  return <><canvas className="noel-snow" ref={snow} aria-hidden="true"/><canvas className="noel-drift" ref={drift} aria-hidden="true"/></>;
}
