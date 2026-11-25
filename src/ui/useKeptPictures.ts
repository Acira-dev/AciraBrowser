import { useEffect, useState } from 'react';
import { runtime } from '../runtime/client';
import type { RemoteArtwork } from '../runtime/types';
import type { CatalogArtwork } from './newTabPreferences';

/** A collection picture as the new tab and Settings show it (the same shape a built-in painting has). */
export const catalogFromRemote = (picture: RemoteArtwork): CatalogArtwork => ({
  id: picture.id, name: picture.name, src: picture.src, alt: picture.name, artist: picture.artist, date: picture.date, provider: picture.credit, rights: picture.license, source: picture.source,
});

const none: CatalogArtwork[] = [];

/**
 * The collection pictures that are already kept on this computer (every one a new tab has shown), or only `ids` of them, newest first.
 * This is a lookup on disk in the main process: it never asks the network, so "my picks" can show a collection picture offline and a
 * private window or Tor (which pass `enabled: false`) never even asks. Changing `reload` asks again.
 */
export function useKeptPictures(enabled: boolean, ids?: readonly string[], reload = 0) {
  const base = ids ? ids.join(',') : '*', key = base + '#' + reload;
  const active = enabled && (!ids || ids.length > 0);
  const [answer, setAnswer] = useState<{ key: string; base: string; pictures: CatalogArtwork[] }>({ key: '', base: '', pictures: none });
  useEffect(() => {
    if (!active) return;
    let alive = true;
    runtime.service({ type: 'artwork.seen', ...(ids ? { ids: [...ids] } : {}) })
      .then((result) => { if (alive) setAnswer({ key, base, pictures: (result.seenArtwork ?? []).map(catalogFromRemote) }); })
      .catch(() => { if (alive) setAnswer({ key, base, pictures: none }); });
    return () => { alive = false; };
  }, [key, active]); // eslint-disable-line react-hooks/exhaustive-deps -- `key` is `ids` and `reload`
  // A lookup that only asks again for the same pictures (`reload`) keeps showing what it had until the new answer arrives, so a list never flashes empty.
  const known = active && answer.base === base;
  return { pending: active && !known, pictures: known ? answer.pictures : none };
}
