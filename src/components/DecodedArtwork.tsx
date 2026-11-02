import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useState} from 'react';
import type {CatalogArtwork} from '../ui/newTabPreferences';

type DecodedPainting = CatalogArtwork & {fallbackSrc?: string};

/** Keep the painted image while a replacement loads; interrupted choices cannot publish a stale decode. */
export function useDecodedArtwork(artwork: CatalogArtwork, enabled: boolean, preferredSrc = artwork.src) {
  const [painting, setPainting] = useState<DecodedPainting>(() => ({...artwork, src: preferredSrc, fallbackSrc: artwork.src}));
  useEffect(() => {
    if (!enabled || preferredSrc === painting.src) return;
    let cancelled = false;
    const decode = async () => {
      // Framed museum art prefers the upstream on-device rendition; other views use the original.
      for (const src of new Set([preferredSrc, artwork.src])) {
        if (cancelled) return;
        const image = new Image();
        image.src = src;
        try {
          await image.decode();
          if (!cancelled) setPainting({...artwork, src, fallbackSrc: artwork.src});
          return;
        } catch {
          // Try the original; a failed replacement keeps the last usable painting on screen.
        }
      }
    };
    void decode();
    return () => { cancelled = true; };
  }, [artwork.src, preferredSrc, enabled]);
  return painting;
}

export function DecodedArtwork({painting, reduced}: {painting: DecodedPainting; reduced: boolean}) {
  return <AnimatePresence initial={false}>
    <motion.img key={painting.src} src={painting.src} alt={painting.alt} decoding="async" draggable={false}
      style={{objectPosition: painting.objectPosition || painting.position || '50% 50%'}}
      initial={{opacity: 0, scale: 1.035, filter: 'blur(6px)'}}
      animate={{opacity: 1, scale: 1, filter: 'blur(0px)'}}
      exit={{opacity: 1, scale: 1.015, filter: 'blur(4px)'}}
      transition={{duration: reduced ? 0 : .6, ease: [.16, 1, .3, 1]}}
      onError={event => {
        const image = event.currentTarget;
        if (image.src.endsWith('/artwork/dunes.svg')) return;
        if (painting.fallbackSrc && image.getAttribute('src') !== painting.fallbackSrc) image.src = painting.fallbackSrc;
        else image.src = '/artwork/dunes.svg';
      }}/>
  </AnimatePresence>;
}
