import { useEffect, useRef, useState } from 'react';
import { runtime } from '../runtime/client';
import { mayAskFor, SUGGEST_WAIT_MS } from '../runtime/searchSuggest';
import type { EngineSuggestions } from './addressSuggestions';

/**
 * Beta 14: what the search engine suggests for the text being typed, asked once the person pauses (about 150 ms after the last key).
 *
 * The rules that matter are main's (desktop/search-suggest.cjs checks every one again); this hook asks for nothing main would refuse, so a keystroke that cannot
 * be sent costs nothing. It keeps what it learned in memory for the current typing session only (the map is dropped the moment the list is no longer wanted) and never
 * writes it anywhere. A new key supersedes the request before it (main cancels the one in flight); an answer for older text is thrown away. If the service is slow or
 * fails, nothing shows and nothing is said.
 *
 * `hold`: while the selection or the pointer is on one of the engine's rows, an answer waits instead of replacing them: a row under the pointer never changes.
 */
export interface EngineAnswer extends EngineSuggestions { for: string }

export function useEngineSuggestions({ enabled, sourceKey, tabId, text, pasted, hold }: { enabled: boolean; sourceKey: string; tabId: string; text: string; pasted: boolean; hold: boolean }): EngineAnswer | null {
  const [answer, setAnswer] = useState<EngineAnswer | null>(null);
  const session = useRef(new Map<string, EngineAnswer>()), latest = useRef(0), waiting = useRef<{ value: EngineAnswer | null } | null>(null), holding = useRef(hold);
  holding.current = hold;
  const query = text.trim().replace(/\s+/g, ' '), askable = enabled && mayAskFor(query, { pasted }), key = `${sourceKey}\n${query.toLocaleLowerCase()}`;
  const deliver = (value: EngineAnswer | null) => { if (holding.current && value) { waiting.current = { value }; return; } waiting.current = null; setAnswer(value); };
  useEffect(() => {
    const mine = ++latest.current;
    if (!enabled) session.current.clear();
    if (!askable) { waiting.current = null; setAnswer(null); return; }
    const known = session.current.get(key);
    if (known) { deliver(known); return; }
    const timer = setTimeout(() => {
      runtime.service({ type: 'search.suggest', tabId, text: query }).then(result => {
        if (latest.current !== mine) return;
        const hit = result.suggestions, next = hit && hit.items.length ? { for: query, name: hit.service.name, items: hit.items } : null;
        if (next) session.current.set(key, next);
        deliver(next);
      }, () => { if (latest.current === mine) deliver(null); });
    }, SUGGEST_WAIT_MS);
    return () => clearTimeout(timer);
  }, [askable, key, tabId]);
  // Answers that arrived while the selection was on an engine row are shown once it leaves them.
  useEffect(() => { if (!hold && waiting.current) { const { value } = waiting.current; waiting.current = null; setAnswer(value); } }, [hold]);
  return askable ? answer : null;
}
