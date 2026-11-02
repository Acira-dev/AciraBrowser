import { useEffect, useState } from 'react';
import { runtime } from '../../runtime/client';

import { t } from '../../i18n';
export interface FoundExtension { id: string; name: string; version: string; manifestVersion: number }
type Progress = { state: 'working' | 'added' | 'cancelled' | 'failed'; note?: string };
const LIMIT = 24;

/** After an import: the extensions found in the other browser's profile, as a checklist. Nothing is selected or installed until the person chooses;
 * each one is fetched from the Chrome Web Store and shows Acira's own permission review before it is added, one at a time. */
export function ExtensionReinstall({ profileId, found }: { profileId: string; found: FoundExtension[] }) {
  const [installed, setInstalled] = useState<string[]>([]);
  useEffect(() => { let alive = true; runtime.extensions({ type: 'list', profileId }).then(result => { if (alive) setInstalled(result.extensions.map(item => item.id)); }).catch(() => undefined); return () => { alive = false; }; }, [profileId]);
  const have = new Set(installed);
  const items = found.filter(item => item.manifestVersion >= 3 && !have.has(item.id)).slice(0, LIMIT);
  const old = found.filter(item => item.manifestVersion < 3).length;
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [busy, setBusy] = useState(false);
  if (!items.length) return old ? <p className="aip-copy">{old === 1 ? t("extensionreinstall.1ExtensionUsesAnOlder") : `${old} extensions use an older format Chrome no longer supports, so they are not offered.`}</p> : null;
  const toggle = (id: string) => setPicked(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  const run = async () => {
    setBusy(true);
    try {
      for (const item of items.filter(entry => picked.has(entry.id))) {
        setProgress(current => ({ ...current, [item.id]: { state: 'working' } }));
        try {
          const result = await runtime.extensions({ type: 'install', profileId, extensionId: item.id });
          setProgress(current => ({ ...current, [item.id]: result.cancelled ? { state: 'cancelled' } : result.error ? { state: 'failed', note: result.error } : { state: 'added' } }));
        } catch (error) {
          setProgress(current => ({ ...current, [item.id]: { state: 'failed', note: error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Could not add this extension.' } }));
        }
      }
    } finally { setBusy(false); }
  };
  const label = (item: FoundExtension) => {
    const row = progress[item.id];
    return !row ? '' : row.state === 'working' ? 'Waiting for your review…' : row.state === 'added' ? 'Added' : row.state === 'cancelled' ? 'Not added' : row.note || 'Could not add';
  };
  return <div className="aip-extensions" data-setting="import-extension-reinstall">
    <p className="aip-copy">{t("extensionreinstall.extensionsFoundInThatProfile")}</p>
    <ul className="aip-results">{items.map(item => <li key={item.id} data-result={progress[item.id]?.state || 'idle'}>
      <label><input type="checkbox" checked={picked.has(item.id)} disabled={busy || progress[item.id]?.state === 'added'} onChange={() => toggle(item.id)}/> <strong>{item.name}</strong></label>
      {label(item) && <span className="aip-result-status" role="status">{label(item)}</span>}
    </li>)}</ul>
    {found.length > items.length && old > 0 && <p className="aip-copy">{old === 1 ? t("extensionreinstall.1OlderFormatExtensionIs") : `${old} older-format extensions are not offered.`}</p>}
    <div className="aip-actions"><button type="button" className="aip-button" disabled={busy || !picked.size} onClick={() => void run()}>{picked.size > 1 ? `Add ${picked.size} extensions` : t("extensionreinstall.addExtension")}</button></div>
  </div>;
}
