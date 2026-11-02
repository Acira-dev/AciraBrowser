const graphemes = (text: string) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)];

/** The monogram a profile form saves for the letter typed: upper case, unless that makes more than one character (ß becomes SS, and the
 * main process refuses a monogram of more than one), in which case the letter stays as typed. Characters as a person sees them: q̃ is one. */
export const avatarInitial = (typed: string): string => {
  const upper = typed.toLocaleUpperCase();
  return graphemes(upper).length === 1 ? upper : typed;
};

/** What the Initial box keeps of what was typed or pasted: the last character as a person sees it (one grapheme, so a flag 🇩🇪 or a
 * family 👨‍👩‍👧 stays whole instead of becoming half of one), with spaces round it dropped ("x " keeps x) and composed (é typed as e and a
 * combining accent is the one letter é). */
export const typedInitial = (value: string): string =>
  (graphemes(value.trim()).at(-1)?.segment ?? "").normalize("NFC");

/** An initial the form saves: one letter (with its accents) or digit. Main also takes one emoji; the form asks for a letter or digit. */
export const initialAllowed = (initial: string): boolean => !initial || /^(?:\p{L}\p{M}*|\p{N})$/u.test(initial);
