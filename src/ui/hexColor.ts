/** What a colour field commits when it loses focus or gets Enter: the six-digit colour typed (a three-digit one is doubled), or null when
 *  it is not a colour or is the colour already shown. Leaving a field alone must not pin the shown colour (often the finish's own tint) as a custom one. */
export function colorToCommit(input: string, shown: string): string | null {
  const next = /^#[\da-f]{3}$/i.test(input) ? '#' + input.slice(1).split('').map((char) => char + char).join('') : /^#[\da-f]{6}$/i.test(input) ? input : null;
  return next && next.toLowerCase() !== shown.toLowerCase() ? next : null;
}
