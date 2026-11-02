import { useCallback, useEffect, useState } from 'react';
import { runtime } from '../runtime/client';
import type { CatalogArtwork } from './newTabPreferences';

/** One request per visible selection. The caller retains its decoded picture while this request loads or fails. */
export function useRemoteArtwork(collection: string, seed: string, enabled: boolean, excludeId?: string) {
  const active = enabled && collection !== 'built-in';
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([collection, seed, active, excludeId, attempt]);
  const [answer, setAnswer] = useState<{ key: string; picture: CatalogArtwork | null; failed: boolean }>({ key: '', picture: null, failed: false });
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    runtime.service({ type: 'artwork.remote', collection, seed, ...(excludeId ? { excludeId } : {}) }).then(result => {
      if (!alive) return;
      const picture = result.remoteArtwork;
      setAnswer({ key, failed: !picture, picture: picture ? { id: picture.id, name: picture.name, src: picture.src, alt: picture.name, artist: picture.artist, date: picture.date, provider: picture.credit, rights: picture.license, source: picture.source } : null });
    }).catch(() => { if (alive) setAnswer({ key, picture: null, failed: true }); });
    return () => { alive = false; };
  }, [collection, seed, active, excludeId, key]);
  // A new key is busy in the render that follows the click, before its effect starts. A stale answer is never a candidate.
  return { active, picture: active && answer.key === key ? answer.picture : null, loading: active && answer.key !== key, failed: active && answer.key === key && answer.failed, retry };
}
