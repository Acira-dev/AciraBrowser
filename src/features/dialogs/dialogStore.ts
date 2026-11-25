/** Beta 14: the question the interface is showing (set by main's `dialog` event, cleared by its `hide`). One at a time: main queues the rest (desktop/site-prompt.cjs). */
import { useSyncExternalStore } from 'react';
import type { DialogSpec } from '../../runtime/dialogSpec';

export type ShownDialog = { id: number; spec: DialogSpec };
let current: ShownDialog | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of [...listeners]) listener(); };
export const showDialog = (id: number, spec: DialogSpec) => { current = { id, spec }; emit(); };
export const hideDialog = (id: number) => { let changed = false; if (revealed && revealed.id === id) { revealed = null; changed = true; } if (current && current.id === id) { current = null; changed = true; } if (changed) emit(); };
export const shownDialog = () => current;
export const useShownDialog = (): ShownDialog | null => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => current);
/** The card's own width, as in the sample: the Close Acira? card 424, the destructive confirm 432, the other centred cards 420, a toolbar prompt by its kind (permission 380, open an app 372, save password 360). */
export const dialogWidthOf = (spec: DialogSpec) => spec.mode === 'anchored' ? PROMPT_WIDTH[spec.prompt || 'perm'] : spec.variant === 'close' ? 424 : spec.tone === 'danger' && spec.icon === 'trash' ? 432 : 420;
/** The sample's widths for the toolbar prompts (dlg-lab.html: permission 380, open an app 372, save password 360). */
const PROMPT_WIDTH = { perm: 380, extapp: 372, savepw: 360 } as const;
/** The password a Save / Update prompt was asked to show (the eye): main sends it once, on a press, and it is dropped the moment the prompt goes or the eye closes. */
let revealed: { id: number; text: string } | null = null;
export const setRevealed = (id: number, text: string) => { revealed = { id, text }; emit(); };
export const clearRevealed = (id?: number) => { if (revealed && (id === undefined || revealed.id === id)) { revealed = null; emit(); } };
export const useRevealed = (id: number): string | null => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => (revealed && revealed.id === id ? revealed.text : null), () => null);

/** A question the interface asks for itself (a delete confirm in Settings, the profile manager ...): the same dialog popup, answered in the same way, but nothing is queued in main. Resolves with what the person chose; Esc and a click outside are "nobody decided" (the cancel answer). */
export type LocalAnswer = { index: number; dismissed: boolean; text?: string; muted?: boolean };
let localCounter = 2_000_000_000;
const pending = new Map<number, (answer: LocalAnswer) => void>();
export function askLocal(spec: Omit<DialogSpec, 'token'>): Promise<LocalAnswer> {
  const id = ++localCounter;
  return new Promise(resolve => { pending.set(id, resolve); showDialog(id, { ...spec, token: id } as DialogSpec); });
}
export function answerLocal(id: number, answer: LocalAnswer) { const resolve = pending.get(id); if (!resolve) return; pending.delete(id); hideDialog(id); resolve(answer); }

/** The common case of an interface question: a destructive or consequential confirm with Cancel as the default answer ("Delete the Work profile?"). Resolves true only for the confirming button. */
export function askConfirm({ message, detail = '', cancelLabel, confirmLabel, tone = 'danger', icon = 'trash', closeLabel = '' }: { message: string; detail?: string; cancelLabel: string; confirmLabel: string; tone?: 'danger' | ''; icon?: string; closeLabel?: string }): Promise<boolean> {
  return askLocal({ mode: 'centered', host: '', message, detail, favicon: '', variant: '', caption: '', body: '', strip: null, list: null, buttons: [{ index: 0, label: cancelLabel, role: 'secondary' }, { index: 1, label: confirmLabel, role: tone === 'danger' ? 'danger' : 'primary' }],
    cancelIndex: 0, defaultIndex: 0, input: null, mute: null, manage: null, note: '', closeLabel, icon, tone })
    .then(answer => answer.index === 1 && !answer.dismissed);
}
