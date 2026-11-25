// R1: the code field (pictures 11 and 12, spec 4.3 and 5.1 moment 5). Chips for the words taken so far, then the word being typed with its ghost completion at 40%.
// What the keys do lives in codeField.ts (a pure reducer); this file draws it and plays the three small motions of moment 5:
//   - a word accepted condenses into a chip: the chip's fill fades in and its width springs from the text's width (`quick`);
//   - a pasted code forms all its chips in sequence, 40 ms apart (--motion-stagger);
//   - a word that is not on the list draws a red underline in from the left (150 ms, CSS) and the field makes ONE 3 px nudge (`settle`).
// At Animation speed Off (or reduced motion) every one of them is an instant cut: motionSpeed() is 'off' and nothing is played.
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { t, useT } from '../../i18n';
import { animateSpring, motionSpeed, springs } from '../../ui/sharedMotion';
import { CODE_WORDS } from './codeWords';
import { CodeChip } from './CodeChips';
import { ghostOf, type CodeFieldAction, type CodeFieldState } from './codeField';

/** `--motion-stagger`: how far apart the chips of a pasted code form. */
export const CHIP_STAGGER_MS = 40;
/** An invisible character, so an empty field still has a line to stand on. */
const ZERO_WIDTH = String.fromCharCode(0x200b);
/** What may follow "Word 3 of 5" in a message before its word: blanks, a comma or colon (any script). */
const TRAILING_SEPARATORS = new RegExp('[\\s,;:' + String.fromCharCode(0x3001, 0x60c, 0xff0c) + ']+$');
/** Stands where a word goes in a message, so a translation can put it anywhere in the sentence. */
const SLOT = '\u0000';

/** "Word 2 of 5, falcon" (spec 14.20). */
export const chipLabel = (index: number, word: string) => t('transfer.code.word', { n: index + 1, word });
/** "Word 3 of 5": what the input says while it waits for that word (the same message, without its word). */
export const inputLabel = (index: number) => t('transfer.code.word', { n: index + 1, word: SLOT }).split(SLOT)[0].replace(TRAILING_SEPARATORS, '');

export interface CodeInputProps {
  field: CodeFieldState;
  send: (action: CodeFieldAction) => void;
  /** Enter with a whole code and nothing being typed: the same as Continue. */
  onSubmit: () => void;
  /** The field is read-only (the code has been sent). */
  disabled?: boolean;
  /** Id of the line below the field (the hint and the "Not a code word" line), so the input can be described by it. */
  describedBy?: string;
}

export function CodeInput({ field, send, onSubmit, disabled = false, describedBy }: CodeInputProps) {
  useT();
  const input = useRef<HTMLInputElement>(null), box = useRef<HTMLDivElement>(null), chips = useRef<HTMLSpanElement>(null);
  const ghost = ghostOf(field), whole = field.chips.length >= CODE_WORDS;
  // Focus lands on the field when it opens (spec 14.20: focus moves to the first place a word is typed).
  useEffect(() => { if (!disabled) input.current?.focus({ preventScroll: true }); }, [disabled]);
  // Chips formed since the last render come in: the fill fades in and its width springs from the text's width on `quick`; a paste staggers them.
  const seen = useRef(field.enter?.stamp ?? 0);
  useLayoutEffect(() => {
    const stamp = field.enter?.stamp ?? 0;
    if (!field.enter || stamp === seen.current) { seen.current = stamp; return; }
    seen.current = stamp;
    if (motionSpeed() === 'off') return;
    const nodes = [...(chips.current?.querySelectorAll<HTMLElement>('.tx-chip') ?? [])];
    nodes.forEach((chip, index) => {
      if (index < field.enter!.from) return;
      const wide = Math.max(1, chip.getBoundingClientRect().width), text = Math.max(8, wide - 18), delay = (index - field.enter!.from) * CHIP_STAGGER_MS;
      // The fill is the chip's ::before (receive.css), so the word itself is never stretched; the word fades in with it.
      animateSpring(chip, [{ opacity: 0, transform: `scaleX(${(text / wide).toFixed(3)})` }, { opacity: 1, transform: 'scaleX(1)' }], springs.quick, { pseudoElement: '::before', delay });
      animateSpring(chip, [{ opacity: 0 }, { opacity: 1 }], springs.quick, { delay });
    });
  }, [field.enter]);
  // One nudge of 3 px on a refused word, never a loop.
  const refusals = useRef(field.refusals);
  useLayoutEffect(() => {
    if (field.refusals === refusals.current) return;
    refusals.current = field.refusals;
    if (box.current && motionSpeed() !== 'off') animateSpring(box.current, [{ translate: '0 0' }, { translate: '3px 0', offset: .35 }, { translate: '0 0' }], springs.settle);
  }, [field.refusals]);

  const keys = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (disabled || event.nativeEvent.isComposing) return;
    const { key } = event;
    if (key === ' ' || key === '-' || key === 'Tab' || key === 'Enter') {
      if (field.typed) { event.preventDefault(); send({ type: 'accept' }); return; }
      if (key === 'Enter') { if (whole) { event.preventDefault(); onSubmit(); } return; }
      if (key === ' ' || key === '-') event.preventDefault(); // a word never starts with a separator; Tab with nothing typed moves on
      return;
    }
    if (key === 'Backspace' && !field.typed && field.chips.length) { event.preventDefault(); send({ type: 'backspace' }); }
  };
  return (
    <div ref={box} className="tx-field" data-bad={field.bad || undefined} role="group" aria-label={t('transfer.receive.title')}
      onMouseDown={(event) => { if (event.target !== input.current) { event.preventDefault(); input.current?.focus({ preventScroll: true }); } }}>
      <span ref={chips} className="tx-field-chips" role="list">
        {field.chips.map((word, index) => <CodeChip key={index} n={index + 1} word={word} />)}
      </span>
      <span className="tx-typed" data-bad={field.bad || undefined} data-whole={whole || undefined}>
        <span className="tx-sizer">
          <span className="tx-mirror" aria-hidden="true">{field.typed || ZERO_WIDTH}</span>
          <input ref={input} className="tx-input" type="text" value={field.typed} disabled={disabled} spellCheck={false} autoCapitalize="off" autoCorrect="off" autoComplete="off" enterKeyHint="next"
            aria-label={whole ? t('transfer.receive.continue') : inputLabel(field.chips.length)} aria-invalid={field.bad || undefined} aria-describedby={describedBy}
            onChange={(event) => send({ type: 'change', text: event.target.value })} onKeyDown={keys}
            onPaste={(event) => { const text = event.clipboardData.getData('text'); if (text) { event.preventDefault(); send({ type: 'paste', text }); } }} />
        </span>
        {ghost && <span className="ghost" aria-hidden="true">{ghost}</span>}
      </span>
    </div>
  );
}

/** The line under the field: "Not a code word" and "Did you mean falcon?" with the word as a button (the same as typing it). */
export function CodeFix({ suggestion, send, id }: { suggestion: string | null; send: (action: CodeFieldAction) => void; id?: string }) {
  useT();
  const [before, after] = t('transfer.receive.didYouMean', { word: SLOT }).split(SLOT);
  return (
    <p className="tx-fix" id={id} role="status" aria-live="polite">
      <span>{t('transfer.receive.notWord')}</span>
      {suggestion && (
        <span className="d">{before}<button type="button" className="tx-fix-btn" onMouseDown={(event) => event.preventDefault()} onClick={(event) => { const flow = event.currentTarget.closest('.rx-flow'); send({ type: 'pick', word: suggestion }); /* typing goes on: the offer is gone, the field keeps the focus */ requestAnimationFrame(() => flow?.querySelector<HTMLInputElement>('.tx-input')?.focus({ preventScroll: true })); }}>{suggestion}</button>{after}</span>
      )}
    </p>
  );
}
