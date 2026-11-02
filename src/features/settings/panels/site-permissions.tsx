import { useEffect, useState } from 'react';
import type { SitePermission } from '../../../runtime/nativeCore';
import { SettingGroup, SettingNote } from '../controls';
import { native, readable } from '../nativeClient';
import type { SettingsPanel } from '../panels';
import '../native-core.css';

import { t } from '../../../i18n';
const NAMES: Record<string, string> = {
  'media-audio': 'Microphone', 'media-video': 'Camera', geolocation: 'Location', 'geolocation-approximate': 'Approximate location', notifications: 'Notifications',
  'clipboard-read': 'Clipboard (read)', 'clipboard-sanitized-write': 'Clipboard (write)', midi: 'MIDI devices', midiSysex: 'MIDI system exclusive', pointerLock: 'Pointer lock', keyboardLock: 'Keyboard lock',
  'idle-detection': 'Idle detection', 'speaker-selection': 'Speaker selection', 'local-network': 'Local network', 'local-network-access': 'Local network', 'loopback-network': 'Local apps',
  'storage-access': 'Embedded site data', 'top-level-storage-access': 'Site data across sites',
};
const host = (origin: string) => origin.replace(/^https?:\/\//, '');

function SitePermissions() {
  const [rows, setRows] = useState<SitePermission[] | null>(null);
  const [error, setError] = useState('');
  const apply = (request: Parameters<typeof native>[0]) => native(request).then((result) => setRows(result.permissions?.rows ?? []), (failure) => setError(readable(failure)));
  useEffect(() => { void apply({ type: 'permissions.list' }); }, []);
  if (!rows) return error ? <p className="nc-message" data-bad role="alert">{error}</p> : null;
  return (
    <SettingGroup title={t("nativeCore.sitePermissions")} id="site-permissions">
      <div data-setting="site-permissions">
        {rows.length === 0 ? (
          <SettingNote>{t("sitePermissions.noSavedChoicesSitesAsk")}</SettingNote>
        ) : (
          <div className="nc-list" role="table" aria-label={t("sitePermissions.savedSitePermissions")}>
            {rows.map((row) => {
              const embedded = row.requester !== row.embedder;
              const key = `${row.requester}|${row.embedder}|${row.permission}`;
              return (
                <div className="nc-permission" role="row" key={key}>
                  <span className="nc-mono" role="cell" title={embedded ? `${row.requester} embedded in ${row.embedder}` : row.requester}>{host(row.requester)}{embedded ? ` in ${host(row.embedder)}` : ''}</span>
                  <span role="cell">{NAMES[row.permission] ?? row.label}</span>
                  <span className="nc-mono" role="cell">{row.decision === 'allow' ? t("sitePermissions.allowed") : t("sitePermissions.blocked")}{row.temporary ? t("sitePermissions.once") : ''}</span>
                  <button type="button" className="st-button" aria-label={t("sitePermissions.resetLabelForRequester", { label: NAMES[row.permission] ?? row.label, requester: host(row.requester) })} onClick={() => void apply({ type: 'permissions.reset', requester: row.requester, embedder: row.embedder, permission: row.permission })}>{t("browsersettings.reset")}</button>
                </div>
              );
            })}
            <div className="nc-actions" style={{ marginTop: 12 }}>
              <button type="button" className="st-button" onClick={() => void apply({ type: 'permissions.reset-all' })}>{t("shortcuts.resetAll")}</button>
            </div>
          </div>
        )}
      </div>
      {error && <p className="nc-message" data-bad role="alert">{error}</p>}
      <SettingNote>{t("sitePermissions.choicesBelongToThisProfile")}</SettingNote>
    </SettingGroup>
  );
}

const panel: SettingsPanel = { section: 'Privacy', order: 90, Component: SitePermissions };
export default panel;
