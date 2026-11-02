import { createContext, useContext, useState } from 'react';
import type { SettingsView } from '../../ui/settingsView';

/** Gives Settings fields a per-Settings-tab place to keep harmless drafts (UF-010). */
export const SettingsViewContext = createContext<SettingsView | null>(null);

/** Like useState for a text field, but the text survives switching to another tab and back. */
export function useSettingsDraft(name: string, initial = ''): [string, (value: string) => void] {
  const view = useContext(SettingsViewContext);
  const [value, set] = useState(() => view?.drafts[name] ?? initial);
  return [
    value,
    (next: string) => {
      if (view) view.drafts[name] = next;
      set(next);
    },
  ];
}
