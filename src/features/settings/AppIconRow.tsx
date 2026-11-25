import { useEffect, useState } from 'react';
import { runtime } from '../../runtime/client';
import { SettingRow, Switch } from './controls';
import { t } from '../../i18n';

/** 14.3 (Settings > Appearance > Interface): "Seasonal app icon". The icon belongs to the app, not to a profile, so this is the app's own switch (desktop/app-icon-host.cjs `appicon.status` / `appicon.set`), not a profile setting.
 * On unless turned off. Off means no request to the server at all and the standard icon back at once. The row shows its saved answer while main is still asked, so it never flashes the wrong way. */
export function AppIconRow() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void runtime.service({ type: 'appicon.status' }).then((answer) => { if (alive) setOn(answer.appIcon?.enabled ?? true); }).catch(() => { if (alive) setOn(true); });
    return () => { alive = false; };
  }, []);
  const change = (enabled: boolean) => {
    setOn(enabled);
    void runtime.service({ type: 'appicon.set', enabled }).then((answer) => setOn(answer.appIcon?.enabled ?? enabled)).catch(() => setOn(!enabled));
  };
  return (
    <SettingRow id="seasonal-app-icon" title={t('appicon.title')} detail={t('appicon.detail')}>
      <Switch label={t('appicon.title')} checked={on ?? true} disabled={on === null} onChange={change} />
    </SettingRow>
  );
}
