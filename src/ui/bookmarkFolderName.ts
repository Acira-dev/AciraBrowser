import type { BookmarkNode } from '../runtime/types';
import { t } from '../i18n';
import { isBarFolder } from './bookmarkMenu';

/** "Other bookmarks", the other top-level folder core's placeFolder finds by its stored English name. */
export const isOtherFolder = (node: BookmarkNode) => !node.url && !node.parentId && node.title.trim().toLowerCase() === 'other bookmarks';

/** A folder's name on screen: the two special folders in the interface's language, any other folder as it is named. Display only: their
 *  stored titles stay "Bookmarks bar" and "Other bookmarks", which is how placeFolder (src/runtime/core.ts) and imports find them. */
export const folderTitle = (node: BookmarkNode): string =>
  isBarFolder(node) ? t('bm.bar') : isOtherFolder(node) ? t('bookmarkeditor.otherBookmarks') : node.title;
