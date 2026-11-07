import { useEffect, useRef, useState } from 'react';
import type { SettingsPanel, SettingsPanelProps } from '../panels';
import { SettingGroup, SettingRow, Switch } from '../controls';
import { SiteListEditor } from '../SiteListEditor';
import { runtime } from '../../../runtime/client';
import type { ProfileScripts } from '../../../runtime/types';
import '../native-core.css';

import { t } from '../../../i18n';
const reason = (error: unknown) => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : String(error));

/** Scripts, per site: the sites where they are blocked (default), or with "Block scripts everywhere" on, the sites where they are allowed. Both lists are kept when the mode changes. */
function SiteScripts({ state }: SettingsPanelProps) {
  const [status, setStatus] = useState<ProfileScripts>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const version = useRef(0);
  const profileId = state.activeBrowserProfileId;
  useEffect(() => {
    let alive = true;
    const read = () => runtime.service({ type: 'scripts.profile-status' }).then((result) => { if (alive) { setStatus(result.scriptRules); setError(''); } }).catch((failure) => { if (alive) setError(reason(failure)); });
    setStatus(undefined);
    void read();
    const unsubscribe = runtime.subscribeBrowser((event) => { if (event.type === 'filters-changed' && event.profileId === profileId) void read(); });
    return () => { alive = false; unsubscribe(); };
  }, [profileId]);
  const save = async (patch: Patch) => {
    const mine = ++version.current;
    setBusy(true); setError('');
    try {
      const result = await runtime.service({ type: 'scripts.profile-set', patch });
      if (mine === version.current) setStatus(result.scriptRules);
    } catch (failure) { if (mine === version.current) setError(reason(failure)); }
    finally { if (mine === version.current) setBusy(false); }
  };
  if (!status) return error ? <p className="nc-message" data-bad role="alert">{error}</p> : null;
  return <SiteScriptsView status={status} busy={busy} error={error} onSave={(patch) => void save(patch)} />;
}

type Patch = { mode?: 'default' | 'everywhere'; blocked?: string[]; allowed?: string[] };
/** The group as drawn: the switch, then the one list that matters in the current mode. */
export function SiteScriptsView({ status, busy, error, onSave }: { status: ProfileScripts; busy: boolean; error: string; onSave: (patch: Patch) => void }) {
  const everywhere = status.mode === 'everywhere';
  const title = everywhere ? t('siteScripts.allowedSites') : t('siteScripts.blockedSites');
  return (
    <SettingGroup title={t('siteScripts.title')} id="site-scripts">
      <SettingRow id="site-scripts-everywhere" title={t('siteScripts.everywhere')} detail={t('siteScripts.everywhereDetail')}>
        <Switch label={t('siteScripts.everywhere')} checked={everywhere} disabled={busy} onChange={(on) => onSave({ mode: on ? 'everywhere' : 'default' })} />
      </SettingRow>
      <SettingRow id="site-scripts-sites" title={title} detail={t('siteScripts.detail')} stacked>
        <SiteListEditor sites={everywhere ? status.allowed : status.blocked} label={title} disabled={busy} onChange={(next) => onSave(everywhere ? { allowed: next } : { blocked: next })} />
      </SettingRow>
      {error && <p className="nc-message" data-bad role="alert">{error}</p>}
    </SettingGroup>
  );
}

const panel: SettingsPanel = { section: 'Privacy', order: 91, Component: SiteScripts };
export default panel;
