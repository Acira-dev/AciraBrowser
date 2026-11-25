/** D179 (member, 24 Nov): copy the page's address in one click. The address field carries a Copy link button at its right end that is not drawn at rest:
 * it shows while the pointer is over the field (or it has the keyboard focus) and never while the field is being edited (its own data-focused, toolbar-controls.css, address-copy).
 * It takes no room (a zero-width slot), so nothing in the field moves when it shows; the text under it fades out. It copies what Copy page address copies
 * (the Acira menu, Ctrl/Cmd+Shift+C), with the same "Link copied" toast. Offered for the pages that command copies: web and file pages. */
export const copyableAddress = (url: string | undefined): boolean => typeof url === 'string' && /^(https?|file):/i.test(url);
