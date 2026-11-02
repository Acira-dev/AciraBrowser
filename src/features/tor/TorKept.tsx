import { useLayoutEffect, useRef, useState } from 'react';
import { DotMatrix } from '../../components/DotMatrix';
import { clearTorVault, listTorBookmarks, removeTorBookmark, reopenTorTabs, setTorVault, torVaultReason, TOR_VAULT_TRADEOFF, useTorVault } from './torVaultClient';
import './tor.css';

import { t } from '../../i18n';
const blank = <span/>;
const Glyph = ({ d }: { d: string }) => <svg className="acira-menu-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={d}/></svg>;
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

/** "Saved on this device": the opt-in Tor vault on the Tor page (panel rows). Off by default; nothing here reads or writes anything until it is turned on.
 * Turning it on says the trade-off plainly first. Reading the saved items asks for Windows Hello (the password vault's check). */
export function TorKept({ onNavigate, reducedMotion }: { onNavigate: (url: string) => void; reducedMotion: boolean }) {
  const vault = useTorVault();
  const toggle = useRef<HTMLButtonElement>(null), confirm = useRef<HTMLButtonElement>(null), cancel = useRef<HTMLButtonElement>(null), returnFocus = useRef(false);
  const [arming, setArming] = useState<'on' | 'clear' | null>(null), [busy, setBusy] = useState(false), [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [bookmarks, setBookmarks] = useState<{ id: string; url: string; title: string }[] | null>(null);
  useLayoutEffect(() => {
    if (arming || busy || !returnFocus.current) return;
    returnFocus.current = false;
    if (document.activeElement === document.body && toggle.current?.isConnected) toggle.current.focus();
  }, [arming, busy]);
  if (!vault) return null;
  const run = (work: () => Promise<unknown>, done?: () => void) => { const restore = arming === 'on' && (document.activeElement === confirm.current || document.activeElement === cancel.current); setBusy(true); setNote(null); void work().then(() => done?.(), (error: unknown) => setNote({ ok: false, text: torVaultReason(error) })).finally(() => { returnFocus.current = restore && (document.activeElement === document.body || document.activeElement === confirm.current || document.activeElement === cancel.current); setBusy(false); setArming(null); }); };
  return <>
    <hr className="acira-menu-sep"/>
    <div className="acira-menu-label">{t("torkept.savedOnThisDevice")}</div>
    <button ref={toggle} type="button" className="acira-menu-row" role="menuitemcheckbox" aria-checked={vault.enabled} disabled={busy || !vault.available} onClick={() => vault.enabled ? run(() => setTorVault(false), () => setBookmarks(null)) : setArming(arming === 'on' ? null : 'on')}>
      <Glyph d="M3.5 7V5.5a4.5 4.5 0 0 1 9 0V7M3 7h10v6.5H3z"/><span className="acira-menu-title">{t("torkept.keepTorBookmarksAndTabs")}</span><span className="acira-menu-value">{!vault.available ? t("ext.stateUnavailable") : vault.enabled ? t('usage.on') : t('usage.off')}</span>
    </button>
    {arming === 'on' && <>
      <p className="tor-pop-note" role="note">{TOR_VAULT_TRADEOFF} {t('torkept.armNote')}</p>
      <button ref={confirm} type="button" className="acira-menu-row" disabled={busy} onClick={() => run(() => setTorVault(true))}><Glyph d="M3.5 8.5l3 3 6-7"/><span className="acira-menu-title">{t("ext.turnOn")}</span>{blank}</button>
      <button ref={cancel} type="button" className="acira-menu-row" onClick={() => { setArming(null); toggle.current?.focus(); }}>{blank}<span className="acira-menu-title">{t("ext.dlgCancel")}</span>{blank}</button>
    </>}
    {vault.enabled && <>
      {vault.hasItems && <button type="button" className="acira-menu-row" disabled={busy} onClick={() => run(async () => { const n = await reopenTorTabs(); setNote(n ? { ok: true, text: t('torkept.reopenedN', { count: n }) } : { ok: false, text: t("torkept.noSavedTabsYet") }); })}><Glyph d="M13 8a5 5 0 1 1-1.6-3.7M12.5 1.8v3h-3"/><span className="acira-menu-title">{t("torkept.reopenLastTorTabs")}</span>{blank}</button>}
      <button type="button" className="acira-menu-row" disabled={busy} aria-expanded={bookmarks !== null} onClick={() => bookmarks ? setBookmarks(null) : run(async () => { setBookmarks(await listTorBookmarks()); })}><Glyph d="M4.5 2.5h7v11L8 10.5l-3.5 3z"/><span className="acira-menu-title">{t("torkept.torBookmarks")}</span><span className="acira-menu-meta">{bookmarks ? bookmarks.length : t("dl.show")}</span></button>
      {bookmarks && (bookmarks.length === 0 ? <p className="tor-pop-note">{t("torkept.nothingSavedYetUseBookmark")}</p> : bookmarks.map(item => <div className="acira-menu-row tor-bm" key={item.id}>{blank}
        <button type="button" className="tor-bm-open" title={item.url} onClick={() => onNavigate(item.url)}><span className="acira-menu-title">{item.title}<span className="acira-menu-sub">{host(item.url)}</span></span></button>
        <button type="button" className="tor-bm-remove" aria-label={t("ntp.removeAria", { title: item.title })} disabled={busy} onClick={() => run(async () => { await removeTorBookmark(item.id); setBookmarks(list => list?.filter(b => b.id !== item.id) ?? null); })}>{t("ext.remove")}</button></div>))}
      {vault.hasItems && (arming === 'clear'
        ? <button type="button" className="acira-menu-row" data-armed disabled={busy} onClick={() => run(async () => { await clearTorVault(); setBookmarks(null); setNote({ ok: true, text: t("torkept.savedTorItemsDeleted") }); })}><Glyph d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8"/><span className="acira-menu-title">{t("torkept.deleteAllSavedTorItems")}</span><span className="acira-menu-meta">{t("torkept.confirm")}</span></button>
        : <button type="button" className="acira-menu-row" disabled={busy} onClick={() => setArming('clear')}><Glyph d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8"/><span className="acira-menu-title">{t("torkept.clearSavedTorItems")}</span>{blank}</button>)}
    </>}
    {note && <p className="tor-pop-note tor-kept-note" role={note.ok ? 'status' : 'alert'} data-ok={note.ok || undefined}>{note.ok && <DotMatrix preset="tor" size={16} tone="ink" reducedMotion={reducedMotion}/>}<span>{note.text}</span></p>}
  </>;
}
