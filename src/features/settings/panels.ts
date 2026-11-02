import type { ComponentType } from 'react';
import type { BrowserAction, BrowserSnapshot } from '../../runtime/types';
import type { EditorIconName } from '../../components/EditorGlyph';

/**
 * Extension point for other streams: render your own Settings UI without editing BrowserSettings.tsx.
 * Add `src/features/settings/panels/<name>.tsx` that default-exports a `SettingsPanel`.
 *  - `section` is an existing section ('Privacy', 'Tabs', …) to append your panel to, or a NEW name
 *    (for example 'Downloads' or 'Shortcuts') that then gets its own entry in the Settings sidebar.
 *  - Build rows with `SettingGroup`/`SettingRow`/`Switch`/`Select` from './controls' and put the
 *    registry id on each row (`<SettingRow id="my-control" …>`), then register the same ids in
 *    `entries/<name>.ts` so search finds them.
 */
export interface SettingsPanelProps {
  state: BrowserSnapshot;
  dispatch: (action: BrowserAction) => void;
}

export interface SettingsPanel {
  section: string;
  /** Sidebar icon for a new section. */
  icon?: EditorIconName;
  /** Lower first. Default 100. */
  order?: number;
  Component: ComponentType<SettingsPanelProps>;
}

const modules = import.meta.glob<{ default: SettingsPanel }>('./panels/*.tsx', { eager: true });

export const settingsPanels: readonly SettingsPanel[] = Object.keys(modules)
  .sort()
  .map((path) => modules[path].default)
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
