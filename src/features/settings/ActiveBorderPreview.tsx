import { useEffect, useRef, useState } from 'react';
import type { ActiveBorderStyle } from '../../runtime/types';
import './active-border-preview.css';

/** A live miniature of one active-border look (Settings > Appearance > Active border): a Favorite tile, a tab row and a field being typed in, each with the REAL ring of that
 *  look (styles/active-border.css draws it from the card's own `data-ab-demo`, so a card can show a look that is not the chosen one). Points at the person's accent, in their
 *  own theme. Hovering a card (or choosing it) plays its appear motion again, so the preview shows how the look arrives and not only how it rests. Nothing here is a control. */
export function ActiveBorderPreview({ look, selected }: { look: ActiveBorderStyle; selected: boolean }) {
  const [on, setOn] = useState(true), timer = useRef(0), first = useRef(true);
  /** Off for two frames, then on: the ring leaves and arrives again. */
  const replay = () => {
    cancelAnimationFrame(timer.current); setOn(false);
    timer.current = requestAnimationFrame(() => { timer.current = requestAnimationFrame(() => setOn(true)); });
  };
  useEffect(() => { if (first.current) { first.current = false; return; } if (selected) replay(); }, [selected]);
  useEffect(() => () => cancelAnimationFrame(timer.current), []);
  const active = on ? '' : undefined;
  return <span className="ab-demo" aria-hidden="true" onPointerEnter={replay}>
    <span className="ab-demo-tiles">
      <span className="ab-demo-tile" /><span className="ab-demo-tile" />
      <span className="ab-demo-tile" data-ab-demo={look} data-ab-active={active} />
    </span>
    <span className="ab-demo-row" data-ab-demo={look} data-ab-active={active}><i className="ab-demo-i" /><b className="ab-demo-b" /></span>
    <span className="ab-demo-field" data-ab-demo={look} data-ab-active={active}><b className="ab-demo-b" /></span>
  </span>;
}
