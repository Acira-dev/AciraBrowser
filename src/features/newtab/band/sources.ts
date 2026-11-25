import type { BandSource } from './types';
import { useUsageNoticeCard } from './usageNotice';
import { useBillboardCard } from './billboardCard';
import { useNoelOfferCard } from './noelOfferCard';

/** In priority order. The first source that returns a card wins: the usage notice is exempt from every limit and always comes first (brief section D).
 *  The billboard adds `useBillboardCard` after it. The list is a constant, so each source is called on every render in the same order. */
export const BAND_SOURCES: readonly BandSource[] = [useUsageNoticeCard, useBillboardCard, useNoelOfferCard];
