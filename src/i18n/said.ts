/** Which catalog message a piece of text was made from. A toast is often sent as text (`text: t('id', params)`); with its message
 *  id it is shown again in the next language (a language change reloads the interface, and main keeps the last toast to show it
 *  again). Messages without parameters are found in the catalog of the language in use; those with parameters are remembered as
 *  they are made, and only for a moment: a toast is sent in the same step as its text is made (a frame later at most), and those
 *  texts carry what a person browses (a page title, the selected text in a menu), which Acira does not keep, least of all from a
 *  private or Tor window. */
export type Said = { id: string; params?: Record<string, string | number> };
export type SaidClock = { now: () => number; later: (run: () => void, ms: number) => void };
const clockTime: SaidClock = { now: () => Date.now(), later: (run, ms) => { (setTimeout(run, ms) as { unref?: () => void }).unref?.(); } };

/** At most `limit` texts, each for `keepMs` (swept by a timer, so nothing stays once nothing new is made). */
export function createSaid(limit = 64, keepMs = 2000, clock: SaidClock = clockTime) {
  const made = new Map<string, Said & { at: number }>();
  let plain: { language: string; ids: Map<string, string | null> } | null = null, sweeping = false;
  const sweep = () => {
    sweeping = false;
    for (const [text, entry] of made) { if (clock.now() - entry.at < keepMs) break; made.delete(text); }
    if (made.size) { sweeping = true; clock.later(sweep, keepMs); }
  };
  return {
    /** What t() made from a message with parameters. */
    note(text: string, id: string, params: Record<string, string | number>) {
      made.delete(text); made.set(text, { id, params: { ...params }, at: clock.now() });
      if (made.size > limit) made.delete(made.keys().next().value!);
      if (!sweeping) { sweeping = true; clock.later(sweep, keepMs); }
    },
    /** `messages` lists the language's messages without parameters as [id, text], read once per language. A text two messages share
     *  gets no id: it could come back meaning the other one in the next language. */
    find(text: string, language: string, messages: () => Iterable<readonly [string, string]>): Said | undefined {
      const known = made.get(text);
      if (known && clock.now() - known.at < keepMs) return { id: known.id, params: known.params };
      if (plain?.language !== language) { plain = { language, ids: new Map() }; for (const [id, shown] of messages()) plain.ids.set(shown, plain.ids.has(shown) && plain.ids.get(shown) !== id ? null : id); }
      const id = plain.ids.get(text);
      return id ? { id } : undefined;
    },
    /** How many texts it holds now (tests). */
    held: () => made.size,
  };
}

/** Only parameters main takes (desktop/validation.cjs): a toast that would be refused for its id is sent as plain text, as before. */
const sendable = (said: Said) => !said.params || Object.keys(said.params).length <= 16 && Object.entries(said.params).every(([key, value]) =>
  /^\w{1,40}$/.test(key) && (typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' && value.length <= 4096));

type ToastLike = { text: string; i18n?: Said; action?: { label: string; labelId?: string } };
/** A toast written as text, with the message ids of its text and its action's label when they came from the catalog. */
export function withMessageIds<T extends ToastLike>(toast: T, find: (text: string) => Said | undefined): T {
  const said = toast.i18n ? undefined : find(toast.text), label = toast.action && !toast.action.labelId ? find(toast.action.label) : undefined;
  return {
    ...toast,
    ...(said && sendable(said) ? { i18n: said } : {}),
    ...(toast.action && label && !label.params ? { action: { ...toast.action, labelId: label.id } } : {}),
  };
}
