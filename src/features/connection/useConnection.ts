import { useCallback, useEffect, useState } from 'react';
import { t, useT } from '../../i18n';
import { runtime } from '../../runtime/client';
import type { ProxyChoice, ProxyStatus } from '../../runtime/nativeNetwork';
import type { ConnectionOptions } from '../../runtime/types';

/** How this profile reaches the internet, in two plain choices. "vpn" follows the computer's own connection (a VPN app, or none): nothing to set. "proxy" is a
 * manual HTTP or SOCKS5 proxy, with a Test that talks only to the proxy. Shared by Settings and the setup Privacy step; both draw their own controls. */
export type ConnectionMode = 'vpn' | 'proxy';
export type ProxyScheme = 'http' | 'socks5';
const message = (error: unknown) => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : t('connection.error.generic'));
/** What the last Apply did, as a code so the screen can branch on it without comparing translated text. */
export type ConnectionDone = '' | 'unchanged' | 'proxy' | 'system';
const DONE_ID = { unchanged: 'connection.done.unchanged', proxy: 'connection.done.proxy', system: 'connection.done.system' } as const;

export function useConnection() {
  const [attempt,setAttempt]=useState(0),[loading,setLoading]=useState(true);
  useT(); // re-render when the language changes
  const [status, setStatus] = useState<ProxyStatus>();
  const [mode, setMode] = useState<ConnectionMode>('vpn');
  const [scheme, setScheme] = useState<ProxyScheme>('http');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [doneKind, setDoneKind] = useState<ConnectionDone>('');
  const [test, setTest] = useState<{ ok: boolean; message: string }>();
  const [options, setOptions] = useState<ConnectionOptions>({ detected: [], providers: [] });
  // Which VPN apps this computer shows (read locally, sent nowhere) and three audited providers to look at. Both are optional extras.
  useEffect(() => { let alive = true; runtime.service({ type: 'connection.options' }).then((result) => { if (alive && result.connection) setOptions(result.connection); }).catch(() => undefined); return () => { alive = false; }; }, []);
  /** Opens a provider's download page in a tab. In setup it opens in the background (the browser is hidden behind setup, so a front tab would look like nothing happened); in Settings it opens normally. Resolves once the browser has the tab. */
  const openProvider = (url: string, options: { background?: boolean } = {}) => runtime.dispatch({ type: 'tab.new', url, ...(options.background ? { background: true } : {}) });
  useEffect(() => {
    let alive = true;setLoading(true);
    runtime.service({ type: 'proxy.status' }).then((result) => { if (alive) {setStatus(result.proxy as ProxyStatus);setProblem('');} }).catch((reason) => { if (alive) setProblem(message(reason)); }).finally(()=>{if(alive)setLoading(false);});
    return () => { alive = false; };
  }, [attempt]);
  useEffect(() => {
    const choice = status?.choice;
    if (choice?.mode === 'fixed_servers') { setMode('proxy'); setScheme(choice.server.scheme); setHost(choice.server.host); setPort(String(choice.server.port)); } else setMode('vpn');
  }, [status?.choice]);
  const valid = mode === 'vpn' || (host.trim().length > 0 && Number(port) >= 1 && Number(port) <= 65535);
  const choice = (): ProxyChoice => (mode === 'proxy' ? { mode: 'fixed_servers', server: { scheme, host: host.trim(), port: Number(port) }, bypassHosts: [] } : { mode: 'system' });
  const run = useCallback(async (work: () => Promise<void>) => { setBusy(true); setProblem(''); setDoneKind(''); try { await work(); } catch (reason) { setProblem(message(reason)); } finally { setBusy(false); } }, []);
  const runTest = () => run(async () => { setTest(undefined); const result = await runtime.service({ type: 'proxy.test', choice: choice() }); setTest((result.proxy as ProxyStatus | undefined)?.test); });
  const apply = () => run(async () => {
    const result = await runtime.service({ type: 'proxy.set', choice: choice() }), next = result.proxy as ProxyStatus | undefined;
    if (next?.cancelled) setDoneKind('unchanged'); else { setStatus(next); setDoneKind(mode === 'proxy' ? 'proxy' : 'system'); }
  });
  /** "Use my setting": ends an extension's control of the proxy (the extension is told; turning it off or removing it ends it for good). */
  const takeBack = () => run(async () => { const result = await runtime.service({ type: 'proxy.takeBack' }); setStatus(result.proxy as ProxyStatus); });
  return {
    controlledBy: status?.controlledBy, takeBack,
    status, mode, scheme, host, port, busy, problem, done: doneKind ? t(DONE_ID[doneKind]) : '', doneKind, test, valid, runTest, apply, loading, reload:()=>setAttempt(n=>n+1), ready: Boolean(status), detected: options.detected, providers: options.providers, openProvider,
    setMode: (next: ConnectionMode) => { setMode(next); setTest(undefined); setDoneKind(''); },
    setScheme: (next: ProxyScheme) => { setScheme(next); setTest(undefined); },
    setHost: (next: string) => { setHost(next); setTest(undefined); },
    setPort: (next: string) => { setPort(next.replace(/\D/g, '')); setTest(undefined); }
  };
}
