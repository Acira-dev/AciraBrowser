/** Commands in the address list: typing "sett" or "pip" offers the command the way Settings › Shortcuts names it (the same registry the
 * command bar uses). Matching is strict: every typed word must begin a word of the name, or the typed letters must be the name's initials.
 * A name is matched in the active language and in English, so a command can be found by either. */
export interface AddressCommand { id: string; /** The name shown, in the active language. */ name: string; /** Every spelling the typed text may match (the shown name, the English one). */ names: string[]; /** The shortcut as shown ("⌘,"), when the command has one. */ shortcut?: string }

/** The registry's commands that make no sense as a typed-for row: keyboard-only cycling, positional picks, and the things that open this very list or the command bar. */
const SKIPPED = /^(tab-switcher|select-tab-|select-last-tab|next-tab|prev-tab|switch-workspace-|new-workspace|address$|focus-toolbar|menu$|command-palette|run-routine|find-next|find-prev|stop-capture)/;
export const addressCommandListed = (id: string) => !SKIPPED.test(id);

/** Marks stay inside a word (Devanagari vowel signs, Arabic diacritics), so "सेटिंग" is one word. */
const wordsOf = (name: string) => name.normalize('NFKC').toLocaleLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
/** How well a name matches the typed text, lower is better; null when it does not match at all. */
function rank(typed: string[], whole: string, name: string): number | null {
  const words = wordsOf(name);
  if (!words.length) return null;
  if (words.join(' ') === typed.join(' ')) return 0;
  // Each typed word must begin a different word of the name, in order: "tab new" does not find "New tab".
  let from = 0;
  const inOrder = typed.every(part => { const at = words.findIndex((word, position) => position >= from && word.startsWith(part)); if (at < 0) return false; from = at + 1; return true; });
  if (inOrder) return words[0].startsWith(typed[0]) ? 1 : 2;
  // Initials: "pip" for "Picture in picture", "ots" for "Open tab switcher". Two letters must be all of them; three or more may begin them.
  const initials = words.map(word => word[0]).join('');
  if (typed.length === 1 && [...whole].length >= 2 && (initials === whole || [...whole].length >= 3 && initials.startsWith(whole))) return 3;
  return null;
}

/** The commands the typed text asks for, best first (at most `limit`). Nothing for a text under two letters or one that reads as an address. */
export function matchCommands(query: string, commands: readonly AddressCommand[], limit = 2): AddressCommand[] {
  const text = query.normalize('NFKC').trim().toLocaleLowerCase();
  if ([...text].length < 2 || /[./:@\\]/.test(text)) return [];
  const typed = text.split(/\s+/).filter(Boolean), whole = typed.join('');
  const found: { command: AddressCommand; score: number; length: number }[] = [];
  for (const command of commands) {
    let best: number | null = null;
    for (const name of command.names) { const score = rank(typed, whole, name); if (score !== null && (best === null || score < best)) best = score; }
    if (best !== null) found.push({ command, score: best, length: command.name.length });
  }
  return found.sort((a, b) => a.score - b.score || a.length - b.length || a.command.name.localeCompare(b.command.name)).slice(0, limit).map(item => item.command);
}
