# Built-in landscape paintings

A bounded, offline collection of public-domain landscape and seascape paintings used for the new-tab artwork and the daily rotation. Every work was individually checked against its museum's own API record (`isPublicDomain` / `is_public_domain` is true) and is available under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) through the museum's open-access policy:

- The Metropolitan Museum of Art — [Open Access policy](https://www.metmuseum.org/hubs/open-access), [collection API](https://metmuseum.github.io/)
- Art Institute of Chicago — [open-access images](https://www.artic.edu/open-access/open-access-images), [public API](https://api.artic.edu/docs/)

`catalog.json` records, per painting: museum, object page and API record, accession number, credit line, the exact image URL used, pixel size, SHA-256 and byte size of the shipped file, an average colour (shown while the image decodes) and an explicit `objectPosition` focal point. Nothing is hot-linked: the app reads only these local files, works fully offline and makes no network request for artwork.

## Preparation

- Ten Met paintings were prepared earlier from larger source photographs with explicit crop rectangles (see their `framing` entries).
- Fifteen further Met paintings come from the museum's open-access originals. Each was trimmed of its dark photographed mat edge (found automatically, at most 9% per side) with a 0.8% safety inset, then resized to a 2,560 px long edge. The exact crop rectangle, in original pixels, is in each entry's `framing.sourceRect`.
- The Art Institute paintings were downloaded from the museum's IIIF image service at a 2,560 px width (or the full size when smaller), re-encoded as sRGB JPEG at quality 82 with Chromium's `nativeImage` and not otherwise altered: no cropping, retouching, stretching or exposure change. Works the service could only deliver below 1,600 px were rejected.
- Selection favours calm, wide landscapes whose centre can sit quietly behind a centred search field. Portraits, figure-led and religious subjects, and busy or very dark works were left out.

## Framed renditions (made on the device)

The framed new tab shows a painting at 880 CSS px or less, so a 2,560 px original costs a decode and GPU upload it does not need. Nothing extra is shipped for that: the first time a painting is shown in the framed view, `desktop/artwork-renditions.cjs` makes a 1,760 px JPEG (quality 80) with `nativeImage`, a moment after the page is up and one painting at a time, and caches it under `artwork-renditions/` in the profile data folder (bounded to 20 MiB, least recently used first, each file checked before it is served). Until it exists the original is served, so the page never waits. The renderer asks for `/artwork-r/<id>.jpg`; the full-background style still loads the original.

## Budget

The whole directory stays within `budgetBytes` (72 MiB). `totalBytes` is the sum of the shipped JPEGs. The largest decoded size is `maximumDecodedBytes`. `tests/new-tab-artwork.test.ts` checks every file against its record, rights fields, dimensions and the budget.

## Behaviour contract

`objectPosition` is a CSS percentage pair applied with `object-fit: cover` and no added scale. IDs `met-436535` and `met-435877` are unchanged from the earlier catalog. Daily choice is a pure function of the local calendar date and the profile (`dailyArtworkFor` in `src/ui/newTabPreferences.ts`); a manual choice overrides it until the daily option is switched on again. Personal images and the offline `dunes`/`peaks` illustrations are separate from this catalog.
