import { t, type MessageId } from '../i18n';
import { defaultArtwork, type CatalogArtwork, type NewTabPreferences } from './newTabPreferences';
import type { PersonalArtwork } from '../runtime/connectedServices';

export type ArtworkCollection = NewTabPreferences['collection'];
const labels: Record<ArtworkCollection, MessageId> = {
  'built-in': 'ntp.col.builtIn', landscapes: 'ntp.col.landscapes', nature: 'ntp.col.nature',
  architecture: 'ntp.col.architecture', space: 'ntp.col.space',
};
export const artworkCollections = Object.keys(labels) as ArtworkCollection[];
export const artworkCollectionOptions = () => artworkCollections.map(value => ({ value, label: t(labels[value]) }));

/** The picture that stands for each collection in setup's cover step and in Settings › Appearance › New tab background: a real
 * photograph from that collection (a painting for Paintings), 640×360, shipped with the app so it shows offline (R4-05). Sources
 * and licences: public/artwork/cover-samples/CREDITS.md. */
export const collectionPreview: Record<ArtworkCollection, string> = {
  'built-in': '/artwork/cover-samples/paintings.jpg', landscapes: '/artwork/cover-samples/landscapes.jpg', nature: '/artwork/cover-samples/nature.jpg',
  architecture: '/artwork/cover-samples/architecture.jpg', space: '/artwork/cover-samples/space.jpg',
};
/** One short word per collection for cards (the full names carry the host, e.g. "Landscapes (Wikimedia Commons)"). */
const shortLabels: Record<ArtworkCollection, MessageId> = {
  'built-in': 'setup.cover.paintings', landscapes: 'setup.cover.landscapes', nature: 'setup.cover.nature',
  architecture: 'setup.cover.architecture', space: 'setup.cover.space',
};
export const artworkCollectionShortName = (collection: ArtworkCollection) => t(shortLabels[collection]);

/** Selecting a collection clears a personal-image override so the chosen collection can actually load. */
export const artworkCollectionChoice = (collection: ArtworkCollection, artwork: string): Partial<NewTabPreferences> => ({
  collection, ...(artwork.startsWith('personal:') ? { artwork: defaultArtwork } : {}),
});

/** "My artworks" in the cover picker. It is a view of the person's own uploaded images, not a collection in the preferences (those stay
 * `built-in`, `landscapes`...; a personal cover is `artwork: 'personal:<id>'`), so the built-in paintings never list uploads. As in
 * Settings, the entry is there when there is something to show (an upload, or a cover that is one), and never in a private window. */
export type CoverView = ArtworkCollection | 'personal';
export const showMyArtworks = (uploads: number, artwork: string, privateMode: boolean) => !privateMode && (uploads > 0 || artwork.startsWith('personal:'));
/** Which list the picker draws: the person's uploads while the cover is one of them or "My artworks" was picked, else the chosen collection. */
export const coverView = (collection: ArtworkCollection, artwork: string, browsingMine: boolean, listed: boolean): CoverView =>
  listed && (browsingMine || artwork.startsWith('personal:')) ? 'personal' : collection;
/** The uploads as covers (ids are `personal:<id>`, the form the preferences store). */
export const personalCovers = (assets: PersonalArtwork[]): CatalogArtwork[] => assets.map(item => ({ id: 'personal:' + item.id, name: item.name, src: item.url, alt: 'Personal new-tab image' }));
