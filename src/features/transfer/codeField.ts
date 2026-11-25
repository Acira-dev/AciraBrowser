// What the code field (R1, spec 4.3) does with typing, Backspace, paste and a wrong word: a pure reducer, so the whole behavior is tested without a screen.
//   Space, Tab, Enter or "-" accepts the typed start of a word into a chip (when it names exactly one word); Backspace on an empty input reopens the previous
//   chip; pasting a whole code (any separators, any case) fills all five chips at once; a word that is not on the list is marked (`bad`) and may carry the
//   nearest list word as a suggestion ("Did you mean ...?"). Continue is for exactly five known words.
import { useReducer } from 'react';
import { CODE_WORDS, SEPARATOR, complete, ghostFor, resolveWord, suggest, tokens } from './codeWords';

export interface CodeFieldState {
  /** The words taken into chips so far (0 to 5), always whole list words. */
  chips: string[];
  /** The text being typed after the chips (lowercase). */
  typed: string;
  /** The typed text is not a word of the list: the red underline, "Not a code word". */
  bad: boolean;
  /** The nearest list word to what was typed ("Did you mean falcon?"), or null. */
  suggestion: string | null;
  /** Counts the times a word was refused: the field nudges once per refusal. */
  refusals: number;
  /** The chips from index `from` on were just formed (by accepting or pasting), `stamp` changes with every such moment: the screen staggers their entrance. */
  enter: { from: number; stamp: number } | null;
}
export const EMPTY_FIELD: CodeFieldState = { chips: [], typed: '', bad: false, suggestion: null, refusals: 0, enter: null };

export type CodeFieldAction =
  | { type: 'change'; text: string }
  | { type: 'accept' }
  | { type: 'backspace' }
  | { type: 'paste'; text: string }
  | { type: 'pick'; word: string }
  | { type: 'reset' };

const ENDS_IN_SEPARATOR = new RegExp(SEPARATOR.source + '$');

/** The word a typed start stands for: the whole word, a unique start of 4 or more letters (main's rule), or any start the list completes to exactly one word (the ghost). */
export function wordFor(typed: string): string | null {
  const word = resolveWord(typed);
  if (word) return word;
  const found = complete(typed, 2);
  return found.length === 1 ? found[0] : null;
}

/** No word of the list starts with this: it can never become a word, so it is marked while it is typed (3 letters or more, so a start is never called wrong early). */
export const cannotBeAWord = (typed: string): boolean => typed.length >= 3 && /^[a-z]+$/.test(typed) && complete(typed, 1).length === 0;

/** A start that no word begins with is marked as it is typed, with the nearest word as the suggestion. */
const marked = (state: CodeFieldState): CodeFieldState => (cannotBeAWord(state.typed) ? { ...state, bad: true, suggestion: suggest(state.typed, 1)[0] ?? null } : { ...state, bad: false, suggestion: null });

const refuse = (state: CodeFieldState, chips: string[], piece: string): CodeFieldState => ({
  ...state, chips, typed: piece, bad: true, suggestion: suggest(piece, 1)[0] ?? null, refusals: state.refusals + 1, enter: chips.length > state.chips.length ? { from: state.chips.length, stamp: (state.enter?.stamp ?? 0) + 1 } : state.enter
});

/** Takes pieces of text in order into chips; stops at the first piece that is not a word of the list, which stays as the typed text, marked. */
function take(state: CodeFieldState, pieces: string[], base: string[], rest = ''): CodeFieldState {
  const chips = [...base];
  for (const piece of pieces) {
    // A sixth word is never taken in: it stays as the text being typed, so the field is not a whole code until the person has taken it out (main refuses six words too).
    if (chips.length >= CODE_WORDS) return { ...state, chips, typed: piece, bad: false, suggestion: null, enter: chips.length > state.chips.length || base.length < state.chips.length ? { from: Math.min(base.length, state.chips.length), stamp: (state.enter?.stamp ?? 0) + 1 } : state.enter };
    const word = wordFor(piece);
    if (!word) return refuse(state, chips, piece);
    chips.push(word);
  }
  const grew = chips.length > state.chips.length || base.length < state.chips.length;
  return { ...state, chips, typed: chips.length >= CODE_WORDS ? '' : rest, bad: false, suggestion: null, enter: grew ? { from: Math.min(base.length, state.chips.length), stamp: (state.enter?.stamp ?? 0) + 1 } : state.enter };
}

export function codeFieldReducer(state: CodeFieldState, action: CodeFieldAction): CodeFieldState {
  switch (action.type) {
    case 'change': {
      const pieces = tokens(action.text);
      if (!pieces.length) return { ...state, typed: '', bad: false, suggestion: null };
      const endsOpen = !ENDS_IN_SEPARATOR.test(action.text.normalize('NFKC'));
      // Everything but the piece still being typed is complete: a space, hyphen or any other separator closed it.
      const done = endsOpen ? pieces.slice(0, -1) : pieces, last = endsOpen ? pieces[pieces.length - 1] : '';
      if (!done.length) return marked({ ...state, typed: last });
      const next = take(state, done, state.chips, last);
      return next.bad ? next : marked(next);
    }
    case 'accept': {
      if (!state.typed) return state;
      const next = take(state, [state.typed], state.chips);
      return next;
    }
    case 'backspace': {
      if (state.typed || !state.chips.length) return state;
      const chips = state.chips.slice(0, -1);
      return { ...state, chips, typed: state.chips[state.chips.length - 1], bad: false, suggestion: null, enter: null };
    }
    case 'paste': {
      const pieces = tokens(action.text);
      if (!pieces.length) return state;
      // One piece goes into the text being typed; a whole code (two pieces or more) replaces what is there.
      if (pieces.length === 1) return codeFieldReducer(state, { type: 'change', text: state.typed + pieces[0] });
      return take({ ...state, chips: [], typed: '' }, pieces, []);
    }
    case 'pick': {
      const word = wordFor(action.word);
      if (!word) return state;
      return take({ ...state, typed: '' }, [word], state.chips);
    }
    case 'reset':
      return EMPTY_FIELD;
  }
}

/** The five words once the field holds a whole code, else null (Continue is off). Whatever is still being typed counts against it. */
export const codeWordsOf = (state: CodeFieldState): string[] | null => (state.chips.length === CODE_WORDS && !state.typed ? [...state.chips] : null);
/** What the code field asks main for: `transfer.receive { code }` takes the five words as one text. */
export const codeText = (words: readonly string[]): string => words.join(' ');
/** The rest of the word being typed, shown at 40%. */
export const ghostOf = (state: CodeFieldState): string => (state.bad ? '' : ghostFor(state.typed));

export function useCodeField(initial: CodeFieldState = EMPTY_FIELD) {
  const [field, send] = useReducer(codeFieldReducer, initial);
  return { field, send, words: codeWordsOf(field) };
}
