import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ToastCard, ToastStack, toastLeaveMs } from '../../components/transient/Toast';
import { reducedMotion } from '../../ui/sharedMotion';
import { clearSetupToasts, dismissSetupToast, holdSetupToasts, setupToastRows, subscribeSetupToasts } from './setupToastStore';
import './connection-sheet.css';

export { showSetupToast } from './setupToastStore';

/** Setup's status pop-up (R4-08b): the house toast, raised from the bottom edge, for things that happen while the browser is
 * hidden behind setup ("Proton VPN's download page is waiting in a new tab"). Same ToastCard/ToastStack as the browser's own
 * toasts (same spring, shadow and speed setting). It sits in the top layer, so setup's transformed card never clips it.
 * Mount it once in the setup step that raises toasts; it clears them when setup moves on. */
export function SetupToastHost() {
  const list = useSyncExternalStore(subscribeSetupToasts, setupToastRows, setupToastRows);
  const node = useRef<HTMLDivElement>(null);
  // Held open until the last card has finished leaving (ToastStack keeps its own room for the exit).
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (list.length) { setOpen(true); return; }
    const timer = setTimeout(() => setOpen(false), toastLeaveMs(reducedMotion()) + 40);
    return () => clearTimeout(timer);
  }, [list.length]);
  useLayoutEffect(() => {
    const el = node.current;
    if (!el) return;
    try { if (open && !el.matches(':popover-open')) el.showPopover(); else if (!open && el.matches(':popover-open')) el.hidePopover(); } catch { /* no top layer: the card still draws in place */ }
  }, [open]);
  useEffect(() => clearSetupToasts, []);
  return (
    <div ref={node} popover="manual" className="setup-toast-host" aria-live="polite" aria-atomic="false">
      <ToastStack rows={[...list]} expanded={false} reducedMotion={reducedMotion()} onHold={holdSetupToasts} render={(row) => <ToastCard row={row} onDismiss={() => dismissSetupToast(Number(row.key))} />} />
    </div>
  );
}
