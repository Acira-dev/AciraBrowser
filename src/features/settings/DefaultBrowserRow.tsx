import { useEffect, useRef, useState } from 'react';
import { createSetupClient } from '../../services/accounts/setup-client';
import type { DefaultBrowserStatus } from '../../services/accounts/setup-types';
import { SettingRow } from './controls';
import { isMac } from '../../ui/platform';
import { refreshedStatus } from './defaultBrowserStatus';

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
    const ask = () =>
      void client
        .request({ type: 'status' })
        .then((result) => {
          if (live) setStatus((previous) => refreshedStatus(previous, result.defaults || result.defaultResult));
        })
        .catch(() => {});
    ask();
    // "Make default" sends the person to Windows' Default apps; the answer is read again when they come back, not only when this row opens.
    window.addEventListener('focus', ask);
    return () => {
      live = false;
      window.removeEventListener('focus', ask);
    };
  }, []);
  if (!window.acira?.setup || !status) return null;
  const request = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await client.request({ type: 'default.request' });
      if (!result.ok) setError(result.error?.message || t('defaultbrowserrow.notChanged', { os: osName }));
      setStatus(result.defaultResult || result.defaults || status);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('defaultbrowserrow.notChanged', { os: osName }));
    } finally {
      setBusy(false);
    }
  };
  const detail = error || (status.isDefault ? t('defaultbrowserrow.isDefaultDetail') : status.requested ? (isMac() ? t('setup.default.detailRequested.mac') : t('defaultbrowserrow.requestedDetail')) : status.note || t('defaultbrowserrow.notDefaultDetail'));
  return (
    <SettingRow id="default-browser" title={t("defaultbrowserrow.defaultBrowser")} detail={detail}>
      {status.isDefault ? (
        <span className="st-muted">{t("defaultbrowserrow.default")}</span>
      ) : (
        <button type="button" className="st-button" disabled={busy || !status.supported} onClick={() => void request()}>
          {busy ? t('defaultbrowserrow.opening') : t("defaultbrowserrow.makeDefault")}
        </button>
      )}
    </SettingRow>
  );
}
