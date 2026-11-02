/**
 * Settings control registry — one entry per real, user-reachable Settings control.
 *
 * Powers individual-control search in Settings (titles, descriptions, aliases, breadcrumb) and the
 * jump-to-control behaviour (open section → expand group → scroll → focus + highlight).
 *
 * Adding a control from another stream:
 *   1. Render it with `data-setting="<id>"` on the row/wrapper (the `Row` helper in BrowserSettings
 *      does this when you pass `id`). That attribute is the DOM anchor; `anchorSelector(id)` builds it.
 *   2. Add an entry in a NEW file `src/features/settings/entries/<yourstream>.ts` that default-exports
 *      `defineSettings(...)`. Files in `entries/` are discovered automatically; no edit here needed,
 *      so there are no merge conflicts.
 *   3. Only register controls that exist and work. No deferred, cloud, or fake features.
 */


import type {SettingsEntry} from './model';
export * from './model';

const modules = import.meta.glob<{ default: SettingsEntry[] }>('./entries/*.ts', { eager: true });

const registry: SettingsEntry[] = Object.keys(modules)
  .sort()
  .flatMap((path) => modules[path].default);

export const settingsRegistry: readonly SettingsEntry[] = registry;

export const findSetting = (id: string) => registry.find((entry) => entry.id === id);
