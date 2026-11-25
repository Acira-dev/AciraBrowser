// The five code words as pill chips with the step number in the secondary ink (spec 5.2, pictures 06-07, 11-12). The sending screen S2 shows them; the receiving
// screen's input (agent R) draws its typed words with the same chip, so both look alike.
//
//   <CodeChip n={2} word="falcon" />                 one chip, read aloud as "Word 2 of 5, falcon"
//   <CodeChips words={code} focusFirst />             the row, in a `role="list"`; `focusFirst` marks the first chip as the dialog's initial focus (spec 14.20)
//   calm                                              the chips of an ended code: dimmed to .4 and softly blurred (the card around them is `.tx-code[data-calm]`)
import { forwardRef, type ReactNode } from 'react';
import { t } from '../../i18n';

export interface CodeChipProps {
  /** 1-based step number. */
  n: number;
  word: string;
  /** A chip that is not (yet) a whole word, or one typed wrongly: the owner styles it through this. */
  state?: 'bad' | 'ghost';
  /** The first chip of a row takes the dialog's initial focus (focus moves to the first chip, spec 14.20). */
  initialFocus?: boolean;
  className?: string;
}

export const CodeChip = forwardRef<HTMLSpanElement, CodeChipProps>(function CodeChip({ n, word, state, initialFocus, className = '' }, ref) {
  return (
    <span ref={ref} className={`tx-chip ${className}`.trim()} role="listitem" aria-label={t('transfer.code.word', { n, word })} data-state={state} tabIndex={initialFocus ? -1 : undefined} data-initial-focus={initialFocus ? 'true' : undefined}>
      <i className="tx-chip-n" aria-hidden="true">{n}</i>{word}
    </span>
  );
});

export interface CodeChipsProps {
  words: readonly string[];
  /** The first chip takes the initial focus when the screen opens. */
  focusFirst?: boolean;
  /** An ended code: chips dimmed (spec 5.1 moment 13). */
  calm?: boolean;
  /** Things that sit after the chips in the same wrapping row (the receiving input's caret field). */
  children?: ReactNode;
  /** What the list is called for a screen reader (default: the S2 title). */
  label?: string;
  className?: string;
}

/** The chips of a code, in order. The wrapper keeps the chips' own width: long words wrap the row, never a chip (README question 1). */
export const CodeChips = forwardRef<HTMLDivElement, CodeChipsProps>(function CodeChips({ words, focusFirst = false, calm = false, children, label, className = '' }, ref) {
  return (
    <div ref={ref} className={`tx-chips ${className}`.trim()} role="list" aria-label={label ?? t('transfer.code.title')} data-calm={calm ? '' : undefined}>
      {words.map((word, index) => <CodeChip key={index} n={index + 1} word={word} initialFocus={focusFirst && index === 0} />)}
      {children}
    </div>
  );
});
