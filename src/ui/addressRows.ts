import { useEffect,useState } from 'react';
import en from '../i18n/en.json';
import { t,translateText } from '../i18n';
import { runtime } from '../runtime/client';
import type { BrowserAction } from '../runtime/types';
import { addressCommandListed,type AddressCommand } from './addressCommands';
import type { AddressSuggestion } from './addressSuggestions';
import { copyText } from './pageActions';
import { formatShortcut } from './platform';
import { commandLabel } from './shortcutKeys';

/** The registry's commands as the address list matches them: shown in the active language, matched in it and in English. Loaded once per page, kept current. */
let loaded: AddressCommand[] | undefined;
const EMPTY: AddressCommand[] = [];
async function load(spaces: boolean): Promise<AddressCommand[]> {
  const result = await runtime.native?.({ type: 'shortcuts.list' });
  return (result?.shortcuts?.commands ?? []).filter(entry => addressCommandListed(entry.id)).map(entry => {
    const name = commandLabel(entry.id, entry.label, spaces), english = (en as Record<string, string>)[`shortcutCmd.${entry.id}`] ?? entry.label;
    return { id: entry.id, name, names: [...new Set([name, entry.label, english, translateText(entry.label)])], ...(entry.display?.[0] ? { shortcut: formatShortcut(entry.display[0]) } : {}) };
  });
}
/** The commands the address list can offer; empty until the registry has answered (the list simply shows no command rows till then). */
export function useAddressCommands(spaces = false): readonly AddressCommand[] {
  const [commands, setCommands] = useState<readonly AddressCommand[]>(loaded ?? EMPTY);
  useEffect(() => {
    let live = true;
    const refresh = () => void load(spaces).then(next => { loaded = next; if (live) setCommands(next); }, () => {});
    if (!loaded) refresh();
    const off = runtime.subscribeBrowser(event => { if (event.type === 'shortcuts-changed') refresh(); });
    return () => { live = false; off?.(); };
  }, [spaces]);
  return commands;
}

/** Choosing an answer copies it; choosing a command runs it. Returns false for any other row, which the caller opens as before. */
export function runAddressRow(item: AddressSuggestion, dispatch: (action: BrowserAction) => void): boolean {
  if (item.kind === 'answer') {
    const text = item.copy ?? item.title;
    void copyText(text).then(() => dispatch({ type: 'toast', text: t('addresssuggestions.answerCopied', { value: text }) }), () => dispatch({ type: 'toast', text: t('addresssuggestions.couldntCopyAnswer'), tone: 'error' }));
    return true;
  }
  if (item.kind === 'command' && item.commandId) {
    const id = item.commandId, label = item.title;
    // The command may open another surface, so it runs once this list has closed (the command bar does the same).
    setTimeout(() => {
      const failed = (message?: string) => dispatch({ type: 'toast', text: message || t('addresssuggestions.commandUnavailable', { label }), tone: 'error' });
      void runtime.native?.({ type: 'shortcuts.run', id }).then(result => { if (result?.shortcuts && !result.shortcuts.ok) failed(result.shortcuts.message); }, () => failed());
    }, 0);
    return true;
  }
  return false;
}
