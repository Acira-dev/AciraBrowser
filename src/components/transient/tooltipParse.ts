/** Pure rules of the one tooltip (Tooltip.tsx), kept free of the DOM so they are tested directly.
 *
 * A tip string is `Title`, `Title · Keys` or either of those followed by a line break and a description:
 *   "Turn Focus off · Ctrl+Shift+F\nBring back the full toolbar."
 * Line 1 is the title and, after the last " · ", the key cap; every later line is the description. The key cap holds ONLY keys. */

export interface ParsedTip { text: string; key?: string; description?: string }

/** What a key cap may start with: a modifier or named key in words (Windows, Linux) or as the Mac glyph. */
const KEYS = /^(?:(?:Ctrl|Alt|Shift|Win|Cmd|Meta|Option)(?=\s*\+)|F\d{1,2}(?:\s*\+|$)|(?:Esc|Del|Enter)(?:\s*\+|$)|[⌘⌥⇧⌃])/;

export function parseTip(raw: string): ParsedTip {
  const [head = '', ...rest] = raw.replace(/\r\n?/g, '\n').split('\n');
  const description = rest.map((line) => line.trim()).filter(Boolean).join(' ') || undefined;
  const at = head.lastIndexOf(' · ');
  const keyed = at > 0 && KEYS.test(head.slice(at + 3).trim());
  const text = (keyed ? head.slice(0, at) : head).trim();
  return { text, ...(keyed ? { key: head.slice(at + 3).trim() } : {}), ...(description ? { description } : {}) };
}

/** A native page view draws over this layer, so a tip that would land on it moves or is refused. Setup is the exception:
 * while it is up, the page views are hidden behind it, so a web tab that happens to be active (the VPN "Get it" opens
 * one) must not make every (i) in setup refuse to show (R4-10). */
export const pageCoversTip = (blockPage: boolean, insideSetup: boolean) => blockPage && !insideSetup;
