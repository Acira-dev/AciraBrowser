import { useCallback, useEffect, useMemo, useState } from 'react';
import { pw, type PwMasks } from './client';
import { SiteMark } from '../rewind/RewindPage';
import { useT } from '../../i18n';
import { SettingGroup, SettingNote, SettingRow, Select, Switch } from '../settings/controls';
import type { BrowserAction } from '../../runtime/types';

type Answer = { masks?: PwMasks; error?: { code: string; message: string }; cancelled?: boolean; private?: boolean };
type Note = { text: string; bad?: boolean } | null;
const Button = ({ kind = 'secondary', danger, children, ...rest }: { kind?: 'primary' | 'secondary' | 'quiet'; danger?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) =>
  <button type="button" {...rest} className={`acira-button acira-button-${kind}${danger ? ' pw-danger' : ''}${rest.className ? ` ${rest.className}` : ''}`}>{children}</button>;

/**
 * Settings › Passwords › Email masks. A mask is a made-up address a service forwards to the person's own inbox; Acira connects to a
 * service the person already has an account with, using their API key (desktop/passwords/masks.cjs). The key is typed here, sent to the
 * main process once and never comes back: every answer carries only `connected`, the service's name, two switches and the list.
 */
export function EmailMasks({ dispatch }: { dispatch: (action: BrowserAction) => void }) {
  const t = useT();
  const [status, setStatus] = useState<PwMasks | null>(null), [note, setNote] = useState<Note>(null), [busy, setBusy] = useState('');
  const [service, setService] = useState(''), [key, setKey] = useState(''), [confirmId, setConfirmId] = useState(''), [query, setQuery] = useState('');
  const act = useCallback(async (label: string, request: Parameters<typeof pw>[0], ok?: (masks: PwMasks) => void) => {
    setBusy(label); setNote(null);
    try {
      const out = await pw<Answer>(request);
      if (out.error) setNote({ text: out.error.message, bad: true });
      else if (out.masks) { setStatus(out.masks); ok?.(out.masks); }
    } catch { setNote({ text: t('pw.mask.err.generic'), bad: true }); }   // the bridge itself failed (a service's answer arrives as {error}): its text would be a path or a stack line, so one calm sentence
    finally { setBusy(''); }
  }, []);
  useEffect(() => { void act('', { type: 'masks.status' }); }, [act]);
  const choices = status?.providers ?? [];
  const chosen = choices.find(item => item.id === service) ?? choices[0];
  const shown = useMemo(() => { const q = query.trim().toLowerCase(); return (status?.items ?? []).filter(item => !q || item.host.toLowerCase().includes(q) || item.address.toLowerCase().includes(q)); }, [status, query]);
  // the list could not be read (a locked or damaged vault, a bridge that failed): one calm line and a way to try again, never an empty page
  if (!status && note) return <SettingGroup title={t('pwm.title')} id="passwords-masks">
    <p className="pw-live popup-status" role="status" aria-live="polite" data-bad={note.bad || undefined}>{note.text}</p>
    <div className="pw-editor-actions"><span className="pw-spacer"/><Button kind="secondary" disabled={!!busy} onClick={() => void act('', { type: 'masks.status' })}>{t('pwm.retry')}</Button></div>
  </SettingGroup>;
  if (!status) return null;
  const name = status.name ?? '';

  if (!status.connected) return <SettingGroup title={t('pwm.title')} id="passwords-masks">
    <SettingRow id="passwords-masks-connect" title={t('pwm.connectTitle')} detail={t('pwm.intro')} stacked>
      <div className="pw-editor pwm-form" role="group" aria-label={t('pwm.connectTitle')}>
        <label className="pw-field"><span>{t('pwm.service')}</span>
          <Select value={chosen?.id ?? ''} options={choices.map(item => ({ value: item.id, label: item.name }))} label={t('pwm.service')} onChange={setService}/>
        </label>
        <label className="pw-field"><span>{t('pwm.key')}</span>
          <input type="password" className="pwm-key" value={key} autoComplete="off" spellCheck={false} onChange={event => setKey(event.target.value)} placeholder={t('pwm.keyPlaceholder')}
            onKeyDown={event => { if (event.key === 'Enter' && key.trim() && chosen && !busy) void act(t('pwm.checking'), { type: 'masks.connect', provider: chosen.id, key }, () => setKey('')); }}/>
        </label>
        <p className="pwm-help">{t('pwm.keyHelp', { service: chosen?.name ?? '' })}</p>
        <div className="pw-editor-actions">
          {chosen && <Button kind="quiet" onClick={() => dispatch({ type: 'tab.new', url: chosen.keyPage })}>{t('pwm.getKey', { service: chosen.name })}</Button>}
          <span className="pw-spacer"/>
          <Button kind="primary" disabled={!!busy || !key.trim() || !chosen} onClick={() => void act(t('pwm.checking'), { type: 'masks.connect', provider: chosen!.id, key }, () => setKey(''))}>{busy || t('pwm.connect')}</Button>
        </div>
      </div>
    </SettingRow>
    <p className="pw-live popup-status" role="status" aria-live="polite" data-bad={note?.bad || undefined}>{note?.text || ''}</p>
  </SettingGroup>;

  return <>
    <SettingGroup title={t('pwm.title')} id="passwords-masks">
      <SettingRow id="passwords-masks-service" title={t('pwm.connected', { service: name })} detail={t('pwm.connectedDetail', { service: name })}>
        <Button disabled={!!busy} onClick={() => void act('', { type: 'masks.disconnect' })}>{t('pwm.disconnect')}</Button>
      </SettingRow>
      <SettingRow id="passwords-masks-offer" title={t('pwm.offer')} detail={t('pwm.offerDetail')}>
        <Switch checked={status.offer !== false} disabled={!!busy} label={t('pwm.offer')} onChange={offer => void act('', { type: 'masks.settings', offer })}/>
      </SettingRow>
      <SettingRow id="passwords-masks-note" title={t('pwm.note', { service: name })} detail={t('pwm.noteDetail')}>
        <Switch checked={status.note !== false} disabled={!!busy} label={t('pwm.note', { service: name })} onChange={value => void act('', { type: 'masks.settings', note: value })}/>
      </SettingRow>
    </SettingGroup>
    <SettingGroup title={t('pwm.masks')} id="passwords-masks-list">
      {status.items.length > 0 && <div className="pw-bar">
        <label className="pw-search" data-placeholder={t('pwm.search')}><svg viewBox="0 0 16 16" aria-hidden><circle cx="7" cy="7" r="4.25"/><path d="M10.25 10.25L13 13"/></svg><input type="search" placeholder={t('pwm.search')} aria-label={t('pwm.search')} value={query} onChange={event => setQuery(event.target.value)}/></label>
      </div>}
      {shown.map(item => <SettingRow key={item.id} title={item.host} detail={item.address}>
        <span className="pw-row-end">
          <SiteMark url={item.origin} size={16}/>
          {!item.enabled && <span className="pw-chip">{t('pwm.off')}</span>}
          <Switch checked={item.enabled} disabled={!!busy} label={t('pwm.forwarding', { address: item.address })} onChange={enabled => void act('', { type: 'masks.enable', id: item.id, enabled })}/>
          <Button kind="quiet" onClick={() => { void navigator.clipboard?.writeText(item.address).then(() => setNote({ text: t('pwm.copied') }), () => {}); }}>{t('pwm.copy')}</Button>
          <Button kind="quiet" danger disabled={!!busy} onBlur={() => setConfirmId('')} onClick={() => { if (confirmId !== item.id) { setConfirmId(item.id); return; } setConfirmId(''); void act('', { type: 'masks.delete', id: item.id }); }}>{confirmId === item.id ? t('pwm.deleteConfirm') : t('pwm.delete')}</Button>
        </span>
      </SettingRow>)}
      {!status.items.length && <p className="pw-empty"><strong>{t('pwm.empty')}</strong><span>{t('pwm.emptyBody')}</span></p>}
      {status.items.length > 0 && !shown.length && <p className="pw-empty"><span>{t('pwm.noMatch', { query: query.trim() })}</span></p>}
      <p className="pw-live popup-status" role="status" aria-live="polite" data-bad={note?.bad || undefined}>{note?.text || ''}</p>
    </SettingGroup>
    <SettingNote>{t('pwm.note.foot', { service: name })}</SettingNote>
  </>;
}
