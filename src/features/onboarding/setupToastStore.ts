/** Setup's status pop-up queue (R4-08b). The runtime's own toast lives in the browser chrome, which setup covers, so setup keeps
 * its own tiny queue; setupToast.tsx draws it with the house ToastCard/ToastStack. The same text raised again restarts its
 * timer instead of stacking; at most three show; each one leaves by itself. Hovering or focusing the stack pauses every
 * timer, like the browser's own toasts (toastTimers.ts). */
import { createToastTimers } from '../../ui/toastTimers';

export interface SetupToastRow { key: number; text: string; tone?: 'error' | 'info'; dismissible: boolean }
export const SETUP_TOAST_MS = 6000, SETUP_TOAST_LIMIT = 3;

let rows: SetupToastRow[] = [], serial = 0;
const listeners = new Set<() => void>(), timers = createToastTimers((key) => dismissSetupToast(key));
const emit = () => listeners.forEach((listener) => listener());
export const subscribeSetupToasts = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const setupToastRows = (): readonly SetupToastRow[] => rows;
/** Pointer or keyboard focus entered (true) or left (false) setup's toast stack. */
export const holdSetupToasts = (held: boolean) => timers.hold(held);

export function dismissSetupToast(key: number) {
  timers.clear(key);
  if (rows.some((row) => row.key === key)) { rows = rows.filter((row) => row.key !== key); emit(); }
  if (!rows.length && timers.held()) timers.hold(false);
}
/** Raises a toast and returns its key. Errors and notices carry a × and stay for the same time (bible §4). */
export function showSetupToast(text: string, options: { tone?: 'error' | 'info'; ms?: number } = {}) {
  const same = rows.find((row) => row.text === text), key = same ? same.key : ++serial;
  const row: SetupToastRow = { key, text, ...(options.tone ? { tone: options.tone } : {}), dismissible: options.tone === 'error' || options.tone === 'info' };
  rows = [...rows.filter((item) => item.key !== key), row].slice(-SETUP_TOAST_LIMIT);
  timers.arm(key, options.ms ?? SETUP_TOAST_MS);
  emit(); return key;
}
export function clearSetupToasts() { timers.dispose(); timers.hold(false); rows = []; emit(); }
