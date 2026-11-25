/**
 * Beta 14 smoothness (B3): the values one Seamless reveal or hide sets for its own motion (its length and curve, the page card's rim, corners, clip and
 * cut-out, the desktop backing's bands, the controls' glide, the page rise) used to be inline custom properties on <html> and on `.app`. Every element
 * inherits those, so each reveal and hide made Chromium restyle the whole interface (~550 elements) several times, inside the reveal's first task.
 *
 * Only the view-transition pictures and a handful of overlay pieces read them. They now live in ONE rule of their own whose selector is exactly those
 * readers: the pictures' root (`::view-transition`, from which every `::view-transition-*` picture inherits) and the pieces in EDGE_READERS. Setting one
 * restyles those pieces (and their few children), not the interface. The values, and the moment they apply (the next style update), are as before.
 *
 * A new rule that reads one of these names (directly or through keyframes it runs) must have its subject among EDGE_READERS:
 * tests/edge-vars.test.ts reads every stylesheet and fails until it does.
 */
export const EDGE_READERS = [
  ':root::view-transition',
  '.sidebar-page-rim',
  '.sidebar-page-corners',
  '.page-content',
  '.st-amb-side',
  '.st-amb-top',
  '.app.style-acira::before',
  '.acira-sidebar::after',
  '.st-glow',   // 14.1: the site glow's top band is cut with the page's hole while the interface floats over the live page (--sf-mask, styles/sidebar-overlay.css)
] as const;

const values = new Map<string, string>();
let rule: CSSStyleRule | null = null;

/** The rule, made on first use in a <style> of its own at the end of <head>; null where there is no document (tests, the preview's server side). */
function store(): CSSStyleRule | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function' || !document.head) return null;
  if (rule?.parentStyleSheet?.ownerNode?.isConnected) return rule;
  const element = document.createElement('style');
  element.dataset.edgeVars = '';
  element.textContent = `${EDGE_READERS.join(',')}{}`;
  document.head.append(element);
  const made = element.sheet?.cssRules[0];
  rule = made instanceof CSSStyleRule ? made : null;
  if (rule) for (const [name, value] of values) rule.style.setProperty(name, value);
  return rule;
}

/** Sets `--name` for the pictures and the overlay pieces. The same value again changes nothing (and restyles nothing). */
export function setEdgeVar(name: string, value: string): void {
  if (values.get(name) === value) return;
  const target = store();
  values.set(name, value);
  target?.style.setProperty(name, value);
}

export function removeEdgeVar(name: string): void {
  if (!values.delete(name)) return;
  store()?.style.removeProperty(name);
}

/** What `--name` is set to now ('' when it is not set), for the script that reads its own values back (as it read the inline style before). */
export const edgeVar = (name: string): string => values.get(name) ?? '';

/** For tests: forget everything. */
export function resetEdgeVars(): void { for (const name of [...values.keys()]) removeEdgeVar(name); }
