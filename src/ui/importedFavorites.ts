import { addSidebarApp, normalizeAppUrl, readSidebarApps, removeSidebarApp } from './sidebarApps';

/** Arc's Favorites arrive with an import batch (`batch.favorites`). The sidebar's Favorites live in the UI's own storage,
 *  so the UI adds them and remembers which apps each batch added; Undo (the setup toast's `import.undo`, or Settings →
 *  Import) takes exactly those away again. Apps already in the sidebar are never added twice or removed. */
const KEY = 'acira-imported-favorites';
type Added = Record<string, { profileId: string; appIds: string[] }>;

function read(): Added {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}
function write(value: Added) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {}
}

/** Adds a batch's favorites to the profile's sidebar (skipping ones already there); returns how many were added. */
export function applyImportedFavorites(profileId: string, batchId: string, favorites: readonly { url: string; title?: string }[] | undefined) {
  if (!favorites?.length) return 0;
  const added = read();
  if (added[batchId]) return added[batchId].appIds.length;
  const present = new Set(readSidebarApps(profileId).apps.map((app) => app.url));
  const appIds: string[] = [];
  for (const favorite of favorites) {
    const url = normalizeAppUrl(favorite.url);
    if (!url || present.has(url)) continue;
    const app = addSidebarApp(profileId, false, { url, title: favorite.title });
    if (typeof app === 'string') break; // the sidebar is full
    present.add(app.url);
    appIds.push(app.id);
  }
  added[batchId] = { profileId, appIds };
  write(added);
  return appIds.length;
}

/** Removes the favorites the given batches added. Safe to call for batches that added none. */
export function undoImportedFavorites(batchIds: readonly string[]) {
  const added = read();
  let changed = false;
  for (const batchId of batchIds) {
    const entry = added[batchId];
    if (!entry) continue;
    for (const appId of entry.appIds) removeSidebarApp(entry.profileId, false, appId);
    delete added[batchId];
    changed = true;
  }
  if (changed) write(added);
}

/** Keep sidebar items until native undo confirms the batch belongs to this profile and was reverted. */
export async function undoImportBatches(batchIds: readonly string[], undo: (batchId: string) => Promise<{ undone?: boolean }>) {
  for (const batchId of batchIds) {
    const result = await undo(batchId);
    if (!result.undone) throw new Error('The import could not be undone. Try again.');
    undoImportedFavorites([batchId]);
  }
}
