/* Beta 14: the sample's line icons (the reference sample `P`): 24 x 24, 1.6 stroke (1.5 inside a tile), round caps and joins, drawn in the text colour. The toolbar prompts
 * (src/features/dialogs/PromptCards.tsx, the update prompt) take theirs from here. `eyeOff` is the one that is not in the sample: the sample's eye with a slash, for the password shown. */
export const GLYPHS: Record<string, string> = {
  camera: '<path d="M14.5 4h-5L7.5 6.5h-3a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h15a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z"/><circle cx="12" cy="10" r="2.4"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/>',
  key: '<circle cx="7.5" cy="15.5" r="4"/><path d="M10.4 12.6 19 4M15.5 7.5l2.5 2.5M13.5 9.5l2 2"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.7-4.3L3.5 9M3.5 4.5V9H8M4 13a8 8 0 0 0 14.7 4.3l1.8-2.3M20.5 19.5V15H16"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4.5 4.5l15 15"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  // the sample's, for the permissions it did not show (a badge on the site's icon: what it asks for)
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  cookie: '<path d="M12 3a9 9 0 1 0 9 9 4 4 0 0 1-5-5 4 4 0 0 1-4-4z"/><path d="M8.5 11.5h.01M12 16h.01M15.5 14h.01M9 15.5h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  // not in the sample: drawn in its hand (24 x 24, round caps and joins) for the permissions it did not show
  clipboard: '<rect x="6" y="4.5" width="12" height="16" rx="2.5"/><path d="M9.5 4.5V4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v.5M9.5 10h5M9.5 14h5"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  network: '<circle cx="12" cy="12" r="9"/><path d="M3.5 9.5h17M3.5 14.5h17M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z"/>',
};
export function Glyph({ name, className = '' }: { name: string; className?: string }) {
  return <svg className={`dlg-ico ${className}`} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: GLYPHS[name] || '' }}/>;
}
