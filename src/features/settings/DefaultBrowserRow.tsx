import { useEffect, useRef, useState } from 'react';
import { createSetupClient } from '../../services/accounts/setup-client';
import type { DefaultBrowserStatus } from '../../services/accounts/setup-types';
import { SettingRow } from './controls';
import { isMac } from '../../ui/platform';

import { t } from '../../i18n';
/** Default-browser status and a real request button. Hidden when the native API is not available. */
export function DefaultBrowserRow() {
  const client = useRef(createSetupClient(window.acira)).current;
  const [status, setStatus] = useState<DefaultBrowserStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const osName = isMac() ? 'macOS' : 'Windows';
  useEffect(() => {
    let live = true;
    if (!window.acira?.setup) return;
    void client
      .request({ type: 'status' })
      .then((result) => {
        if (live) setStatus(result.defaults || result.defaultResult);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!window.acira?.setup || !status) return null;
  const request = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await client.request({ type: 'default.request' });
      if (!result.ok) setError(result.error?.message || `${osName} did not change the default browser.`);
      setStatus(result.defaultResult || result.defaults || status);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `${osName} did not change the default browser.`);
    } finally {
      setBusy(false);
    }
  };
  const detail = error || (status.isDefault ? 'Acira opens web links and files.' : status.requested ? (isMac() ? t('setup.default.detailRequested.mac') : 'Choose Acira in the Windows prompt to finish.') : status.note || 'Open links from other apps in Acira.');
  return (
    <SettingRow id="default-browser" title={t("defaultbrowserrow.defaultBrowser")} detail={detail}>
      {status.isDefault ? (
        <span className="st-muted">{t("defaultbrowserrow.default")}</span>
      ) : (
        <button type="button" className="st-button" disabled={busy || !status.supported} onClick={() => void request()}>
          {busy ? 'Opening…' : t("defaultbrowserrow.makeDefault")}
        </button>
      )}
    </SettingRow>
  );
}
