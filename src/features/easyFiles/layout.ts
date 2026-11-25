import type { EasyFileItem, EasyFilesOffer } from '../../runtime/types';

/** Easy Files layout: pure numbers, no runtime, so the pop-up's geometry (src/ui/popup.ts) can use them. */
export const picturesOf = (items: readonly EasyFileItem[]) => items.filter(item => item.section !== 'downloads');
export const downloadsOf = (items: readonly EasyFileItem[]) => items.filter(item => item.section === 'downloads');

/** Picture tiles: 112 x 70 (16:10, the shape of a window screenshot); 112 shows what a page is, 96 shows only a texture (the approved comparison). */
export const TILE = { w: 112, h: 70 } as const;
/** Every block has a fixed height, so the pop-up knows its height before it opens and never jumps.
 *  picture row = 2 (strip top) + tile + 6 (gap) + 16 (caption) + 8 (strip bottom). */
export const EF = { chrome: 12, label: 26, rowPad: 2 + 6 + 16 + 8, tileGap: 8, stripInset: 8, row: 44, sep: 9, action: 30, width: 360, maxDownloads: 3, fade: 28 } as const;
export const pictureRowHeight = TILE.h + EF.rowPad;
/** The offer whose pop-up is being sized and drawn (set by store.ts). */
let shown: Pick<EasyFilesOffer, 'items' | 'multiple'> | null = null;
export const setShownOffer = (offer: Pick<EasyFilesOffer, 'items' | 'multiple'> | null) => { shown = offer; };
export function easyFilesHeight(offer: Pick<EasyFilesOffer, 'items' | 'multiple'> | null = shown): number {
  if (!offer) return 120;
  const pictures = picturesOf(offer.items).length, downloads = Math.min(EF.maxDownloads, downloadsOf(offer.items).length);
  const body = (pictures ? EF.label + pictureRowHeight : 0) + (downloads ? EF.label + downloads * EF.row : 0);
  // With several allowed, the "Attach" row keeps its place (dimmed until something is ticked), so the pop-up never changes height.
  return EF.chrome + body + (body ? EF.sep : 0) + (offer.multiple ? EF.action : 0) + EF.action;
}
