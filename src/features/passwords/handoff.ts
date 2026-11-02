import { useCallback, useEffect, useRef, useState } from 'react';
import { passwordsAvailable, pw, readable, type PwImportPreview } from './client';
import type { MessageId } from '../../i18n';

/** "Bring your passwords": the four browsers whose export steps are written out, in the order people ask for them. The names
 *  are the browsers' own (not translated); each step's words live in the catalog (handoff.<id>.menu / .export). */
export type HandoffBrowser = 'chrome' | 'edge' | 'brave' | 'firefox';
export const HANDOFF_BROWSERS: readonly { id: HandoffBrowser; name: string; address: string; menu: MessageId; export: MessageId }[] = [
  { id: 'chrome', name: 'Chrome', address: 'chrome://password-manager/settings', menu: 'handoff.chrome.menu', export: 'handoff.chrome.export' },
  { id: 'edge', name: 'Edge', address: 'edge://wallet/passwords', menu: 'handoff.edge.menu', export: 'handoff.edge.export' },
  { id: 'brave', name: 'Brave', address: 'brave://password-manager/settings', menu: 'handoff.brave.menu', export: 'handoff.brave.export' },
  { id: 'firefox', name: 'Firefox', address: 'about:logins', menu: 'handoff.firefox.menu', export: 'handoff.firefox.export' },
];

/** The steps that fit the browser a person imported from (Zen is Firefox underneath; Arc, Helium and the rest are Chrome's). */
export function handoffBrowserFor(name?: string): HandoffBrowser {
  const lower = (name || '').toLowerCase();
  if (lower.includes('edge')) return 'edge';
  if (lower.includes('brave')) return 'brave';
  if (lower.includes('firefox') || lower.includes('zen')) return 'firefox';
  return 'chrome';
}

export type HandoffPhase = 'idle' | 'choosing' | 'preview' | 'importing' | 'done';
export type HandoffTrash = 'idle' | 'working' | 'trashed' | 'failed';

/** The CSV path through the vault's own import (preview, then apply), and the Recycle Bin afterwards. Every call goes through
 *  the trusted passwords bridge; no password ever reaches this code, only counts. */
export function usePasswordHandoff(onImported?: () => void) {
  const [phase, setPhase] = useState<HandoffPhase>('idle');
  const [preview, setPreview] = useState<PwImportPreview | null>(null);
  const [imported, setImported] = useState<{ added: number; updated: number } | null>(null);
  const [trash, setTrash] = useState<HandoffTrash>('idle');
  const [error, setError] = useState('');
  const alive = useRef(true);
  const imports = useRef(onImported);
  imports.current = onImported;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const choose = useCallback(async () => {
    if (!passwordsAvailable()) return;
    setPhase('choosing'); setError(''); setImported(null); setTrash('idle');
    try {
      const result = await pw<PwImportPreview & { private?: boolean }>({ type: 'passwords.import.preview' });
      if (!alive.current) return;
      if (result.unreadable) { setError(result.unreadable); setPhase('idle'); setPreview(null); return; }
      if (result.cancelled || !result.token) { setPhase(preview ? 'preview' : 'idle'); return; }
      setPreview(result); setPhase('preview');
    } catch (failure) { if (alive.current) { setError(readable(failure)); setPhase('idle'); } }
  }, [preview]);

  const apply = useCallback(async () => {
    if (!preview?.token) return;
    setPhase('importing'); setError('');
    try {
      const result = await pw<{ added: number; updated: number; failed: number }>({ type: 'passwords.import.apply', token: preview.token });
      if (!alive.current) return;
      setImported({ added: result.added, updated: result.updated });
      setPhase('done');
      imports.current?.();
    } catch (failure) { if (alive.current) { setError(readable(failure)); setPhase('preview'); } }
  }, [preview]);

  const moveFile = useCallback(async () => {
    if (!preview?.token) return;
    setTrash('working'); setError('');
    try {
      const result = await pw<{ fileTrashed?: boolean; cancelled?: boolean }>({ type: 'passwords.import.trash-file', token: preview.token });
      if (!alive.current) return;
      setTrash(result.fileTrashed ? 'trashed' : result.cancelled ? 'idle' : 'failed');
    } catch (failure) { if (alive.current) { setTrash('failed'); setError(readable(failure)); } }
  }, [preview]);

  const reset = useCallback(() => { setPhase('idle'); setPreview(null); setImported(null); setTrash('idle'); setError(''); }, []);
  return { available: passwordsAvailable(), phase, preview, imported, trash, error, choose, apply, moveFile, reset };
}
