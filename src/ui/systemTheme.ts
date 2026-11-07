import { useEffect, useState } from 'react';
import { runtime } from '../runtime/client';
import type { SystemThemeInfo } from '../runtime/types';
export { matchesSystemTheme, systemThemeActions, systemThemePatch, withSystemAccent } from './systemThemeRules';

const none: SystemThemeInfo = { supported: false, dark: false, accent: null, accentSource: null, desktop: 'other' };

/** What the Linux desktop says about its theme. Off Linux this is always `none`, and nothing ever subscribes. */
export function useSystemTheme(): SystemThemeInfo {
  const [info, setInfo] = useState<SystemThemeInfo>(() => { try { return runtime.systemTheme?.() ?? none; } catch { return none; } });
  useEffect(() => runtime.subscribeSystemTheme?.(setInfo), []);
  return info;
}
