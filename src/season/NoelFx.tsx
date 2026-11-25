import { useLayoutEffect, useRef } from 'react';
import { registerCushion } from './winter/controller';

/**
 * Noël's frost and snow on something with a top edge: put it as a child of a plate (`position: relative`). It carries the first study's frosted glass along the top edge (CSS, noel.css)
 * and, for the selected tab, the address field and New Tab's search box, a cushion of snow (a small picture the controller draws when the snow changes).
 * `kind='fav'`: frost only (Favorites carry no snow).
 */
export function NoelFx({ kind, card = false, inside = false }: { kind: 'sel' | 'addr' | 'ntp' | 'fav'; /** the gliding card's copy */ card?: boolean; /** the plate's top is clipped (a tab strip's pill): the snow lies along the inside of its top edge */ inside?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const fx = ref.current, host = fx?.parentElement; if (!fx || !host) return;
    host.setAttribute('data-noel-host', '');
    const canvas = fx.querySelector('canvas'), off = kind !== 'fav' && canvas ? registerCushion(kind, canvas, fx, card ? 'card' : 'row') : undefined;
    return () => { off?.(); host.removeAttribute('data-noel-host'); };
  }, [kind, card]);
  return <span className="noel-fx" data-kind={kind} data-inside={inside || undefined} ref={ref} aria-hidden="true">{kind !== 'fav' && <canvas className="noel-cushion"/>}</span>;
}
