/** Direction of Acira's interface only; never applied to a website document. */
export function interfaceDirection(locale: string): 'ltr' | 'rtl' {
  return locale.toLowerCase().split(/[-_]/)[0] === 'ar' ? 'rtl' : 'ltr';
}

/** Keep language and direction together, including the initial English render. */
export function applyDocumentLocale(root: Pick<HTMLElement, 'lang' | 'dir'>, locale: string): void {
  root.lang = locale;
  root.dir = interfaceDirection(locale);
}

/** Hebrew and Arabic letters, with their presentation forms. */
const rtlLetters = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
/** Text in a right-to-left interface without a single right-to-left letter (an English message, a site's name) reads left to right:
 *  its full stop and brackets stay at its end. `undefined` keeps the interface's direction (every other text, and every left-to-right
 *  interface: an English sentence with an Arabic name in it is still an English sentence). */
export function ownTextDirection(text: string, interfaceDir = typeof document === 'undefined' ? 'ltr' : document.documentElement.dir): 'ltr' | undefined {
  return interfaceDir === 'rtl' && !rtlLetters.test(text) ? 'ltr' : undefined;
}
