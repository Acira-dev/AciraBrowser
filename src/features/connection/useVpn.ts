import { useCallback, useEffect, useRef, useState } from 'react';
import { runtime } from '../../runtime/client';
import type { VpnCommand, VpnProviderId, VpnStatus } from '../../runtime/vpn';
import { t } from '../../i18n';

/** Poll only while a VPN surface is visible. Provider command delivery never optimistically marks a tunnel connected. */
export function useVpn() {
  const [status, setStatus] = useState<VpnStatus>(), [busy, setBusy] = useState(false), [problem, setProblem] = useState('');
  const alive = useRef(false), reading = useRef(false), acting = useRef(false);
  const refresh = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    try { const result = await runtime.service({ type: 'vpn.status' }); if (alive.current) setStatus(result.vpn); }
    catch { if (alive.current) setProblem(t('vpn.control.readFailed')); }
    finally { reading.current = false; }
  }, []);
  useEffect(() => {
    alive.current = true; void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 3000);
    return () => { alive.current = false; window.clearInterval(timer); };
  }, [refresh]);
  const command = async (providerId: VpnProviderId, action: VpnCommand) => {
    if (acting.current) return;
    acting.current = true; setBusy(true); setProblem('');
    try { const result = await runtime.service({ type: 'vpn.command', providerId, action }); if (alive.current) setStatus(result.vpn); }
    catch { if (alive.current) { setProblem(t('vpn.control.commandFailed')); await refresh(); } }
    finally { acting.current = false; if (alive.current) setBusy(false); }
  };
  return { status, busy: busy || !!status?.busy, problem, command, refresh };
}
