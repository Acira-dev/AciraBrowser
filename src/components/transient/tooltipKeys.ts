/** What a key press does to the tooltip (TooltipHost): any key hides it, but Esc on an info tip that a click pinned open is
 * used up closing it. Otherwise the same Esc also skipped setup, or closed the popup the tip sits in, so one press took two
 * layers away at once ("Esc closes the innermost layer first"). A tip that is only hovered is not a layer: Esc passes
 * through it, as before. */
export function tipKeyAction(key: string, shown: boolean, pinned: boolean): 'consume' | 'hide' {
  return key === 'Escape' && shown && pinned ? 'consume' : 'hide';
}
