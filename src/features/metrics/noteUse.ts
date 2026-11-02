import type { BrowserRuntime } from '../../runtime/types';

/** R4-60: one use of an interface-side feature (Seamless reveal, command bar, protection panel). Main counts it only while usage sharing is
 * on, as a bucket in the next daily message; nothing about what was done is recorded. Fire and forget, never throws. Kept apart from
 * useMetrics (which loads the runtime client) so low-level modules such as chromeEdge stay importable outside the app. */
export function noteUse(name: 'seamlessReveals' | 'commandBar' | 'protectionPanel' | 'windowView') {
  try { const native = (window as { acira?: BrowserRuntime }).acira; if (native) void native.service({ type: 'metrics.note', name }).catch(() => undefined); } catch { /* not in the app */ }
}

/** Popups whose opening is one use of a counted feature. */
const POPUP_USES: Readonly<Record<string, 'protectionPanel'>> = { protection: 'protectionPanel' };
/** A popup sheet just opened (called once per opening: the sheet mounts once per overlay id). Other kinds count nothing. */
export function notePopupOpened(kind: string) {
  const name = Object.prototype.hasOwnProperty.call(POPUP_USES, kind) ? POPUP_USES[kind] : undefined;
  if (name) noteUse(name);
}
