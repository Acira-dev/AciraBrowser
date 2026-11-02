/** A colour typed or pasted into a hex field, as lower-case #rrggbb: spaces around it and the # are optional, three digits are doubled.
 *  null when it is not a colour. */
export function parseHexColor(input: string): string | null {
  const digits = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(input.trim())?.[1];
  if (!digits) return null;
  return '#' + (digits.length === 3 ? digits.split('').map((char) => char + char).join('') : digits).toLowerCase();
}

/** A field applies a colour while typing only once it has all six digits, so typing "ff0" on the way to "ff0000" never flashes yellow. */
export function completeHexColor(input: string): string | null {
  return /^#?[\da-f]{6}$/i.test(input.trim()) ? parseHexColor(input) : null;
}

/** What a colour field commits when it loses focus or gets Enter: the colour typed (see parseHexColor), or null when
 *  it is not a colour or is the colour already shown. Leaving a field alone must not pin the shown colour (often the finish's own tint) as a custom one. */
export function colorToCommit(input: string, shown: string): string | null {
  const next = parseHexColor(input);
  return next && next !== shown.toLowerCase() ? next : null;
}
