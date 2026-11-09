/**
 * Is a command key held (Ctrl, Alt or Meta), so the key press is a shortcut and not typing?
 * On Windows a keyboard with AltGr (Brazilian ABNT2, German, Polish, Czech...) reports AltGr as Ctrl and Alt together, and the characters it types ("/" on ABNT2, "@" on German)
 * are typing: the event says so with the AltGraph modifier.
 */
export function holdsCommandKey(event: Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'metaKey'> & { getModifierState?: (key: string) => boolean }): boolean {
  if (event.metaKey) return true;
  if (!event.ctrlKey && !event.altKey) return false;
  return !(typeof event.getModifierState === 'function' && event.getModifierState('AltGraph'));
}
