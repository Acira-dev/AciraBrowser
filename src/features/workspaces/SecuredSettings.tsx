import type { BrowserAction, BrowserSnapshot } from '../../runtime/types';
import { Select, SettingGroup, SettingRow } from '../settings/controls';
import { t } from '../../i18n';

/** Settings › Privacy › Secured workspaces (R3-38, Beta): when an open secured workspace locks by itself. Leaving it, minimising, Windows locking and quitting always lock it; there is no "never". */
export function SecuredSettings({ state, dispatch, disabled }: { state: BrowserSnapshot; dispatch: (action: BrowserAction) => void; disabled: boolean }) {
  const value = String(state.settings.securedLockMinutes ?? 5);
  const options = [
    { value: '1', label: t('workspaces.lockAfter', { minutes: 1 }) }, { value: '5', label: t('workspaces.lockAfter', { minutes: 5 }) },
    { value: '15', label: t('workspaces.lockAfter', { minutes: 15 }) }, { value: '30', label: t('workspaces.lockAfter', { minutes: 30 }) },
    { value: '0', label: t('workspaces.lockOnlyOs') },
  ];
  return <SettingGroup title={t('workspaces.securedGroup')}>
    <SettingRow id="secured-workspaces" title={`${t('workspaces.securedRow')} · ${t('workspaces.beta')}`} detail={t('workspaces.securedRowDetail')}>
      <Select label={t('workspaces.securedRow')} value={value} disabled={disabled} onChange={next => dispatch({ type: 'settings.update', patch: { securedLockMinutes: Number(next) } })} options={options} />
    </SettingRow>
  </SettingGroup>;
}
