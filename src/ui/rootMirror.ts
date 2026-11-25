import { createElement, useInsertionEffect, type ReactElement } from 'react';

/**
 * Beta 14 (smoothness B1): conditions the stylesheets used to ask with `:has()` on <html>, <body> or `.app` (124 selectors: the setup dialog, the rail's
 * expanded / peek / shelf state, Sidebar mode, Seamless, the layout, the native page, the popup scrim, reduced motion) are mirrored as `data-m-*`
 * attributes on <html>, and the build (scripts/postcss-root-has.cjs) asks the attribute instead of `:has()`.
 *
 * WHY. A `:has()` whose subject is the root or `.app` makes EVERY node inserted, removed or restyled anywhere in the interface re-check the root, and
 * Chromium then invalidates the whole subtree under it: each layout read inside a click paid a full recalculation of the interface (4 per tab click on
 * an M5, ~595 elements each). With the attributes, a DOM change restyles only what it touches.
 *
 * EXACT. A mirror is set by a component rendered INSIDE the element the condition looks for (`<RootMirror>`), or by the component that renders that
 * element's class from the same values, in `useInsertionEffect`: it runs in the same commit as the DOM change, before any layout effect can read
 * styles, and its cleanup runs when the element leaves the DOM (an AnimatePresence exit keeps the element, and the mirror with it, until it is gone).
 * Several elements may hold one name at once: each value is counted, and the attribute is the set of values present (`~=` in the stylesheets).
 */
const live = new Map<string, Map<string, number>>();

function apply(name: string): void {
  if (typeof document === 'undefined') return;
  const values = live.get(name), root = document.documentElement, attr = 'data-m-' + name;
  if (!values || !values.size) { if (root.hasAttribute(attr)) root.removeAttribute(attr); return; }
  const text = [...values.keys()].sort().join(' ');
  if (root.getAttribute(attr) !== text) root.setAttribute(attr, text);
}

/** Holds `value` under `name` until the returned function is called. '' means "present" (`[data-m-name]`). */
export function mirrorOn(name: string, value = ''): () => void {
  let values = live.get(name);
  if (!values) live.set(name, values = new Map());
  for (const token of value.split(' ')) values.set(token, (values.get(token) ?? 0) + 1);
  apply(name);
  let done = false;
  return () => {
    if (done) return; done = true;
    const now = live.get(name);
    if (!now) return;
    for (const token of value.split(' ')) { const n = (now.get(token) ?? 0) - 1; if (n > 0) now.set(token, n); else now.delete(token); }
    apply(name);
  };
}

/** Mirrors `value` under `name` while the calling component is mounted and the value is not null/undefined/false. */
export function useRootMirror(name: string, value: string | null | undefined | false): void {
  useInsertionEffect(() => (value === null || value === undefined || value === false ? undefined : mirrorOn(name, value)), [name, value]);
}

/** Rendered inside the element a condition looks for: present exactly while that element is in the DOM. Renders nothing. */
export function RootMirror({ name, value = '' }: { name: string; value?: string | null | false }): ReactElement | null {
  useRootMirror(name, value);
  return null;
}
/** `<RootMirror>` as a plain element factory, for places that build children arrays. */
export const rootMirror = (name: string, value: string | null | false = '') => createElement(RootMirror, { name, value, key: 'root-mirror-' + name });

/** For tests: what is held now. */
export const mirrorState = (): Record<string, string[]> => Object.fromEntries([...live].map(([name, values]) => [name, [...values.keys()].sort()]));

// The motion scale `.app` carries in its inline style (App: `--motion-scale: motionScaleOf(settings)`), published by App in the same commit, so
// splitMotion.motionScale() answers without getComputedStyle (17 forced style reads in one tab click on Beta 14 before this).
let appMotionScale: number | null = null;
export function publishAppMotionScale(value: number): void { appMotionScale = value; }
export function useAppMotionScale(value: number): void {
  useInsertionEffect(() => { publishAppMotionScale(value); }, [value]);
}
export const publishedAppMotionScale = (): number | null => appMotionScale;
/** Rendered inside `.app` with the value of its inline `--motion-scale`. */
export function AppMotionScale({ value }: { value: number }): ReactElement | null { useAppMotionScale(value); return null; }
