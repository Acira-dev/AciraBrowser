/** Direction of Acira's interface only; never applied to a website document. */
export function interfaceDirection(locale: string): 'ltr' | 'rtl' {
  return locale.toLowerCase().split(/[-_]/)[0] === 'ar' ? 'rtl' : 'ltr';
}

/** Keep language and direction together, including the initial English render. */
export function applyDocumentLocale(root: Pick<HTMLElement, 'lang' | 'dir'>, locale: string): void {
  root.lang = locale;
  root.dir = interfaceDirection(locale);
}
