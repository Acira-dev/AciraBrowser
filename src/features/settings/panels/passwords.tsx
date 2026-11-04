import { isMac } from '../../../ui/platform';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { passwordsAvailable, pw, readable, type PwDenied, type PwFlags, type PwImportPreview, type PwItem, type PwNever, type PwStatus } from '../../passwords/client';
import { SiteMark } from '../../rewind/RewindPage';
import { useT } from '../../../i18n';
import { SettingGroup, SettingNote, SettingRow, Switch } from '../controls';
import type { SettingsPanel, SettingsPanelProps } from '../panels';
import './passwords.css';

type Answer = { denied?: PwDenied; error?: { code: string; message: string }; cancelled?: boolean };
type Note = { text: string; bad?: boolean } | null;
const when = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const Button = ({ kind = 'secondary', danger, children, ...rest }: { kind?: 'primary' | 'secondary' | 'quiet'; danger?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) =>
  <button type="button" {...rest} className={`acira-button acira-button-${kind}${danger ? ' pw-danger' : ''}${rest.className ? ` ${rest.className}` : ''}`}>{children}</button>;

/** Add or open one saved login. Showing, copying and editing ask your system to verify you; the password is fetched only then. */
function Editor({ item, onClose, onChanged, say }: { item: PwItem | null; onClose: () => void; onChanged: (items: PwItem[]) => void; say: (note: Note) => void }) {
  const t = useT(), waiting = t(isMac() ? 'pwp.waiting.mac' : 'pwp.waiting');
  const [fields, setFields] = useState({ origin: item?.origin ?? 'https://', username: item?.username ?? '', password: '', note: '' });
  const [shown, setShown] = useState(false), [editing, setEditing] = useState(!item), [busy, setBusy] = useState(''), [confirmDelete, setConfirmDelete] = useState(false);
  const hide = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(hide.current), []);
  const guard = async <T extends Answer>(label: string, request: Parameters<typeof pw>[0]): Promise<T | null> => {
    setBusy(label);
    try { const result = await pw<T>(request); if (result.denied) { say({ text: result.denied.message, bad: true }); return null; } if (result.error) { say({ text: result.error.message, bad: true }); return null; } if (result.cancelled) return null; return result; }
    catch (failure) { say({ text: readable(failure), bad: true }); return null; } finally { setBusy(''); }
  };
  const reveal = async () => {
    if (!item) return true;
    const result = await guard<Answer & { password: string; note: string }>(waiting, { type: 'passwords.reveal', id: item.id });
    if (!result) return false;
    setFields(previous => ({ ...previous, password: result.password, note: result.note }));setShown(true);
    clearTimeout(hide.current);hide.current = setTimeout(() => { setShown(false); if (!editing) setFields(previous => ({ ...previous, password: '', note: '' })); }, 20000);
    return true;
  };
  const copy = async (field: 'password' | 'username') => {
    if (!item) return;
    const result = await guard<Answer & { clearsInMs: number }>(field === 'password' ? waiting : '', { type: 'passwords.copy', id: item.id, field });
    if (result) say({ text: field === 'password' ? t('pwp.passwordCopied') : t('pwp.usernameCopied') });
  };
  const save = async () => {
    if (item) {
      const patch: Record<string, string> = {};
      if (fields.origin !== item.origin) patch.origin = fields.origin;
      if (fields.username !== item.username) patch.username = fields.username;
      patch.password = fields.password;patch.note = fields.note;
      const result = await guard<Answer & { items: PwItem[] }>(waiting, { type: 'passwords.update', id: item.id, ...patch });
      if (result) { onChanged(result.items); say({ text: t('pwp.saved') }); onClose(); }
    } else {
      const result = await guard<Answer & { items: PwItem[] }>(t('pwp.saving'), { type: 'passwords.save', origin: fields.origin, username: fields.username, password: fields.password, note: fields.note || undefined });
      if (result) { onChanged(result.items); say({ text: t('pwp.saved') }); onClose(); }
    }
  };
  const generate = async () => { const result = await guard<Answer & { password: string }>('', { type: 'passwords.generate' }); if (result) { setFields(previous => ({ ...previous, password: result.password })); setShown(true); } };
  const remove = async () => { if (!item) return; const result = await guard<Answer & { items: PwItem[] }>('', { type: 'passwords.delete', id: item.id }); if (result) { onChanged(result.items); say({ text: t('pwp.deleted') }); onClose(); } };
  const set = (key: keyof typeof fields) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFields(previous => ({ ...previous, [key]: event.target.value }));
  const masked = item && !shown && !editing;
  return <div className="pw-editor" role="group" aria-label={item ? t('pwp.editorNamed', { host: item.host }) : t('pwp.addAria')} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <label className="pw-field"><span>{t('pwp.website')}</span><input value={fields.origin} readOnly={!editing} spellCheck={false} onChange={set('origin')} autoFocus={!item}/></label>
    <label className="pw-field"><span>{t('pwp.username')}</span><input value={fields.username} readOnly={!editing} spellCheck={false} autoComplete="off" onChange={set('username')}/></label>
    <label className="pw-field"><span>{t('pwp.password')}</span>
      <span className="pw-secret">
        <input type={shown || (editing && !item) ? 'text' : 'password'} value={masked ? '••••••••••••' : fields.password} readOnly={!editing || (!!item && !shown)} spellCheck={false} autoComplete="new-password" onChange={set('password')}/>
        {item && <Button kind="quiet" disabled={!!busy} onClick={() => { if (shown) { setShown(false); if (!editing) setFields(p => ({ ...p, password: '', note: '' })); } else void reveal(); }}>{busy === waiting ? waiting : shown ? t('pwp.hide') : t('pwp.show')}</Button>}
        {item && <Button kind="quiet" disabled={!!busy} onClick={() => void copy('password')}>{t('pwp.copy')}</Button>}
        {!item && <Button kind="quiet" onClick={() => void generate()}>{t('pwp.suggest')}</Button>}
      </span>
    </label>
    {(editing || shown) && <label className="pw-field"><span>{t('pwp.note')}</span><textarea value={fields.note} readOnly={!editing} rows={2} onChange={set('note')}/></label>}
    <div className="pw-editor-actions">
      {item && <Button kind="quiet" disabled={!!busy} onClick={() => void copy('username')}>{t('pwp.copyUsername')}</Button>}
      {item && <Button kind="quiet" danger onBlur={() => setConfirmDelete(false)} onClick={() => { if (confirmDelete) void remove(); else setConfirmDelete(true); }}>{confirmDelete ? t('pwp.deletePassword') : t('pwp.deleteEllipsis')}</Button>}
      <span className="pw-spacer"/>
      <Button onClick={onClose}>{editing && !item ? t('pwp.cancel') : t('pwp.close')}</Button>
      {item && !editing && <Button disabled={!!busy} onClick={async () => { if (await reveal()) setEditing(true); }}>{t('pwp.edit')}</Button>}
      {editing && <Button kind="primary" disabled={!!busy || !fields.password || !fields.origin} onClick={() => void save()}>{busy ? busy : item ? t('pwp.save') : t('pwp.savePassword')}</Button>}
    </div>
  </div>;
}

// A profile change retires every editor, preview, search and asynchronous response with the old profile.
function Passwords(props: SettingsPanelProps) {
  return <ProfilePasswords key={props.state.activeBrowserProfileId} {...props}/>;
}

function ProfilePasswords({ state }: SettingsPanelProps) {
  const t = useT(), waiting = t(isMac() ? 'pwp.waiting.mac' : 'pwp.waiting');
  const isPrivate = Boolean(state.browserProfiles.find(p => p.id === state.activeBrowserProfileId)?.private);
  const [status, setStatus] = useState<PwStatus | null>(null), [items, setItems] = useState<PwItem[]>([]), [never, setNever] = useState<PwNever[]>([]);
  const [flags, setFlags] = useState<Record<string, PwFlags>>({}), [summary, setSummary] = useState({ total: 0, weak: 0, reused: 0 });
  const [query, setQuery] = useState(''), [openId, setOpenId] = useState(''), [adding, setAdding] = useState(false), [note, setNote] = useState<Note>(null), [busy, setBusy] = useState('');
  const [preview, setPreview] = useState<PwImportPreview | null>(null), [imported, setImported] = useState<{ text: string; token?: string } | null>(null), [confirmAll, setConfirmAll] = useState(false);
  const load = useCallback(async () => {
    if (!passwordsAvailable() || isPrivate) return;
    try {
      const next = await pw<PwStatus>({ type: 'passwords.status' }); setStatus(next);
      if (!next.ok) return;
      const list = await pw<{ items: PwItem[]; never: PwNever[] }>({ type: 'passwords.list' }); setItems(list.items); setNever(list.never);
      const check = await pw<{ total: number; weak: number; reused: number; flags: Record<string, PwFlags> }>({ type: 'passwords.check' }); setFlags(check.flags); setSummary({ total: check.total, weak: check.weak, reused: check.reused });
    } catch (failure) { setNote({ text: readable(failure), bad: true }); }
  }, [isPrivate]);
  useEffect(() => { void load(); }, [load, state.activeBrowserProfileId]);
  const changed = (next: PwItem[]) => { setItems(next); void load(); };
  const shown = useMemo(() => { const q = query.trim().toLowerCase(); return q ? items.filter(item => item.host.toLowerCase().includes(q) || item.username.toLowerCase().includes(q)) : items; }, [items, query]);
  const act = async <T extends Answer>(label: string, request: Parameters<typeof pw>[0], ok: (result: T) => void) => {
    setBusy(label);
    try { const result = await pw<T>(request); if (result.denied) setNote({ text: result.denied.message, bad: true }); else if (result.error) setNote({ text: result.error.message, bad: true }); else if (!result.cancelled) ok(result); }
    catch (failure) { setNote({ text: readable(failure), bad: true }); } finally { setBusy(''); }
  };
  if (!passwordsAvailable()) return null;
  if (isPrivate) return <SettingGroup><SettingRow id="passwords-offer" title={t('pwp.privateTitle')} detail={t('pwp.privateDetail')}/></SettingGroup>;
  const unusable = status && !status.ok;
  return <>
    <SettingGroup>
      <SettingRow id="passwords-offer" title={t('pwp.offer')} detail={t('pwp.offerDetail')}>
        <Switch checked={status?.enabled ?? true} disabled={!status || unusable === true} label={t('pwp.offer')} onChange={enabled => void act('', { type: 'passwords.settings', enabled }, () => setStatus(previous => previous && { ...previous, enabled }))}/>
      </SettingRow>
      {unusable && <p className="pw-note" data-bad role="alert">{status?.message || t('pwp.cantOpen')}</p>}
    </SettingGroup>
    {!unusable && <>
      <SettingGroup title={t('pwp.savedPasswords')} id="passwords-list">
        <div className="pw-bar">
          <label className="pw-search" data-placeholder={t('pwp.search')}><svg viewBox="0 0 16 16" aria-hidden><circle cx="7" cy="7" r="4.25"/><path d="M10.25 10.25L13 13"/></svg><input type="search" placeholder={t('pwp.search')} aria-label={t('pwp.search')} value={query} onChange={event => setQuery(event.target.value)}/></label>
          <Button kind="primary" data-setting="passwords-add" onClick={() => { setAdding(true); setOpenId(''); }}>{t('pwp.addPassword')}</Button>
        </div>
        {summary.total > 0 && <p className="pw-summary" aria-live="polite">{summary.weak || summary.reused ? [summary.weak && t('pwp.weakCount', { count: summary.weak }), summary.reused && t('pwp.reusedCount', { count: summary.reused })].filter(Boolean).join(' · ') : t('pwp.allStrong', { count: summary.total })}<span>{t('pwp.checkedHere')}</span></p>}
        {adding && <Editor item={null} onClose={() => setAdding(false)} onChanged={changed} say={setNote}/>}
        {shown.map(item => <div key={item.id} className="pw-item" data-open={openId === item.id || undefined}>
          <SettingRow title={item.host} detail={item.username || t('pwp.noUsername')}>
            <span className="pw-row-end">
              <SiteMark url={item.origin} size={16}/>
              {flags[item.id]?.strength === 'weak' && <span className="pw-chip" data-tone="bad">{t('pwp.weak')}</span>}
              {flags[item.id]?.reused ? <span className="pw-chip" data-tone="warn">{t('pwp.reused')}</span> : null}
              {flags[item.id]?.strength === 'fair' && !flags[item.id]?.reused ? <span className="pw-chip">{t('pwp.fair')}</span> : null}
              <Button kind="quiet" onClick={() => { setOpenId(openId === item.id ? '' : item.id); setAdding(false); }}>{openId === item.id ? t('pwp.close') : t('pwp.open')}</Button>
            </span>
          </SettingRow>
          {openId === item.id && <Editor item={item} onClose={() => setOpenId('')} onChanged={changed} say={setNote}/>}
        </div>)}
        {!items.length && !adding && <p className="pw-empty"><strong>{t('pwp.noSaved')}</strong><span>{t('pwp.noSavedBody')}</span></p>}
        {items.length > 0 && !shown.length && <p className="pw-empty"><span>{t('pwp.noMatch', { query: query.trim() })}</span></p>}
        <p className="pw-live" role="status" aria-live="polite" data-bad={note?.bad || undefined}>{note?.text || ''}</p>
      </SettingGroup>
      <SettingGroup title={t('pwp.importExport')}>
        <SettingRow id="passwords-import" title={t('pwp.importCsv')} detail={t('pwp.importCsvDetail')}>
          <Button disabled={!!busy} onClick={() => void act<Answer & PwImportPreview>(t('pwp.choosing'), { type: 'passwords.import.preview' }, result => { if (result.unreadable) setNote({ text: result.unreadable, bad: true }); else { setImported(null); setPreview(result); } })}>{t('pwp.importBtn')}</Button>
        </SettingRow>
        {preview?.token && <div className="pw-preview" role="group" aria-label={t('pwp.importPreview')}>
          <p><strong>{preview.name}</strong>: {[t('pwp.prevNew', { count: preview.new ?? 0 }), preview.update ? t('pwp.prevUpdated', { count: preview.update }) : '', preview.same ? t('pwp.prevSame', { count: preview.same }) : '', preview.skipped ? t('pwp.prevSkipped', { count: preview.skipped }) : ''].filter(Boolean).join(t('pwp.sep'))}{t('pwp.stop')}</p>
          <div className="pw-editor-actions"><span className="pw-spacer"/><Button onClick={() => setPreview(null)}>{t('pwp.cancel')}</Button><Button kind="primary" disabled={!!busy || !(preview.new || preview.update)} onClick={() => void act<Answer & { added: number; updated: number; failed: number; items: PwItem[] }>(t('pwp.importing'), { type: 'passwords.import.apply', token: preview.token! }, result => { changed(result.items); setImported({ text: `${t('pwp.importedCount', { count: result.added })}${result.updated ? `${t('pwp.sep')}${t('pwp.importedUpdated', { count: result.updated })}` : ''}${t('pwp.stop')}`, token: preview.token }); setPreview(null); })}>{busy === t('pwp.importing') ? t('pwp.importing') : t('pwp.import')}</Button></div>
        </div>}
        {imported && <p className="pw-live">{imported.text} {t('pwp.fileStillPlain')} {imported.token && <button type="button" className="pw-link" onClick={() => void act<Answer & { fileDeleted: boolean }>('', { type: 'passwords.import.delete-file', token: imported.token! }, result => setImported({ text: result.fileDeleted ? t('pwp.fileDeleted') : t('pwp.fileCantDelete') }))}>{t('pwp.deleteFile')}</button>}</p>}
        <SettingRow id="passwords-export" title={t('pwp.exportCsv')} detail={t(isMac() ? 'pwp.exportCsvDetail.mac' : 'pwp.exportCsvDetail')}>
          <Button disabled={!!busy || !items.length} onClick={() => void act<Answer & { exported?: number; empty?: boolean; name?: string }>(waiting, { type: 'passwords.export' }, result => setNote(result.empty ? { text: t('pwp.exportEmpty') } : { text: t('pwp.exportDone', { count: result.exported ?? 0, name: result.name ?? '' }) }))}>{busy === waiting ? waiting : t('pwp.exportBtn')}</Button>
        </SettingRow>
        <SettingRow id="passwords-delete-all" title={t('pwp.deleteAllTitle')} detail={t('pwp.deleteAllDetail')}>
          <Button danger disabled={!!busy || !items.length} onBlur={() => setConfirmAll(false)} onClick={() => { if (!confirmAll) { setConfirmAll(true); return; } setConfirmAll(false); void act<Answer & { deleted?: number; items?: PwItem[] }>(waiting, { type: 'passwords.deleteAll' }, result => { changed(result.items ?? []); setNote({ text: t('pwp.deletedCount', { count: result.deleted ?? 0 }) }); })}}>{confirmAll ? t('pwp.deleteAll') : t('pwp.deleteAllEllipsis')}</Button>
        </SettingRow>
      </SettingGroup>
      {never.length > 0 && <SettingGroup title={t('pwp.neverSaved')} id="passwords-never">
        {never.map(site => <SettingRow key={site.id} title={site.origin.replace(/^https?:\/\//, '')} detail={t('pwp.neverDetail')}>
          <Button kind="quiet" onClick={() => void act<Answer & { never: PwNever[] }>('', { type: 'passwords.never.remove', id: site.id }, result => setNever(result.never))}>{t('pwp.remove')}</Button>
        </SettingRow>)}
      </SettingGroup>}
      <SettingNote>{t(isMac() ? 'pwp.note.encrypted.mac' : 'pwp.note.encrypted')}{items.length ? ` ${t('pwp.lastChange', { date: when(Math.max(...items.map(item => item.updatedAt))) })}` : ''}</SettingNote>
    </>}
  </>;
}
const panel: SettingsPanel = { section: 'Passwords', icon: 'KeyRound', order: 22, Component: Passwords };
export default panel;
