import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// A DOM small enough for the glow engine: an app node with the frame's variables, elements with a style that serialises, the root.
class FakeStyle {
  props = new Map<string, string>();
  get opacity() { return this.props.get('opacity') ?? ''; } set opacity(v: string) { this.props.set('opacity', v); }
  get transition() { return this.props.get('transition') ?? ''; } set transition(v: string) { this.props.set('transition', v); }
  setProperty(name: string, value: string) { this.props.set(name, value); }
  removeProperty(name: string) { this.props.delete(name); }
  getPropertyValue(name: string) { return this.props.get(name) ?? ''; }
  get cssText() { return [...this.props].map(([k, v]) => `${k}: ${v};`).join(' '); }
  set cssText(text: string) { this.props.clear(); for (const part of text.split(';')) { const at = part.indexOf(':'); if (at > 0) this.props.set(part.slice(0, at).trim(), part.slice(at + 1).trim()); } }
}
class FakeEl {
  style = new FakeStyle(); className = ''; attrs = new Map<string, string>(); children: FakeEl[] = []; isConnected = true; offsetWidth = 0;
  setAttribute(k: string, v: string) { this.attrs.set(k, v); } getAttribute(k: string) { return this.attrs.get(k) ?? null; } removeAttribute(k: string) { this.attrs.delete(k); } hasAttribute(k: string) { return this.attrs.has(k); }
  prepend(el: FakeEl) { this.children.unshift(el); } /* the engine prepends layer 0, then layer 1: `frameLayers()` below puts them back in creation order */
  dataset: Record<string, string> = {};
}
const app = new FakeEl(), root = new FakeEl();
app.style.setProperty('--sidebar-rgb', '30 31 34'); app.style.setProperty('--sidebar-tone', 'dark'); app.style.setProperty('--sidebar-ink', '#e8eaed'); app.style.setProperty('--sidebar-muted', '#9aa0a6');
Object.assign(globalThis, {
  document: { querySelector: (sel: string) => sel.includes('.app') ? app : null, createElement: () => new FakeEl(), documentElement: root },
  matchMedia: () => ({ matches: false }), requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0), cancelAnimationFrame: () => {}, setTimeout
});

const frameLayers = () => [...app.children].reverse();
const BLUE = { color: '#3b6ff5', level: 'rich' as const, blocked: false }, GREEN = { color: '#1ed760', level: 'rich' as const, blocked: false };
const glow = await import('../src/ui/siteGlowEngine');
const mount = (ref: unknown) => { const el = new FakeEl(); const cleanup = (ref as (e: FakeEl) => (() => void) | undefined)(el); return { el, unmount: () => { el.isConnected = false; cleanup?.(); } }; };

test('a sidebar mounted before the glow follows both frame layers: colours, opacity and fade in lockstep', () => {
  const a = mount(glow.railGlowRef0), b = mount(glow.railGlowRef1);
  glow.syncSiteGlow(BLUE, { instant: false });
  const frame = frameLayers();
  assert.equal(frame.length, 2, 'the two frame layers exist');
  for (const [i, el] of [a.el, b.el].entries()) {
    assert.equal(el.style.opacity, frame[i].style.opacity, `rail layer ${i} has its frame layer's opacity`);
    assert.equal(el.style.transition, frame[i].style.transition, `rail layer ${i} fades with its frame layer`);
    assert.equal(el.style.getPropertyValue('--g1'), frame[i].style.getPropertyValue('--g1'));
  }
  // one of the two is in, the other out (the cross-fade pair)
  assert.deepEqual([a.el.style.opacity, b.el.style.opacity].map(Number).sort(), [0, Number(frame[0].style.opacity) || Number(frame[1].style.opacity)].sort());
  a.unmount(); b.unmount();
});

test('a sidebar that opens while the glow is on takes the current state at once, no fade from nothing', () => {
  const live = frameLayers();
  const a = mount(glow.railGlowRef0), b = mount(glow.railGlowRef1);
  for (const [i, el] of [a.el, b.el].entries()) { assert.equal(el.style.opacity, live[i].style.opacity); assert.equal(el.style.getPropertyValue('--g1'), live[i].style.getPropertyValue('--g1')); }
  assert.ok(Number(a.el.style.opacity) > 0 || Number(b.el.style.opacity) > 0, 'one of them carries the glow on arrival');
  a.unmount(); b.unmount();
});

test('a new colour cross-fades the sidebar layers with the frame layers; a sidebar that went away is left alone', () => {
  const a = mount(glow.railGlowRef0), b = mount(glow.railGlowRef1), gone = mount(glow.railGlowRef0);
  gone.unmount(); const before = gone.el.style.cssText;
  glow.syncSiteGlow(GREEN, { instant: false });
  const frame = frameLayers();
  for (const [i, el] of [a.el, b.el].entries()) { assert.equal(el.style.opacity, frame[i].style.opacity); assert.equal(el.style.transition, frame[i].style.transition); assert.equal(el.style.getPropertyValue('--g1'), frame[i].style.getPropertyValue('--g1')); }
  assert.match(a.el.style.transition + b.el.style.transition, /opacity 420ms/, 'it is a fade, not a cut');
  assert.equal(gone.el.style.cssText, before, 'an unmounted layer is not touched');
  glow.syncSiteGlow({ ...GREEN, color: undefined, blocked: true } as never, { instant: true });
  assert.equal(a.el.style.opacity, '0'); assert.equal(b.el.style.opacity, '0');
  a.unmount(); b.unmount();
});

test('the left wash is drawn by the sidebar, not by the frame layer, on both sides', () => {
  const css = fs.readFileSync(new URL('../src/styles/site-glow.css', import.meta.url), 'utf8');
  const frameRule = css.slice(css.indexOf('.st-glow {'), css.indexOf('}', css.indexOf('.st-glow {')));
  assert.ok(!/150px 46%/.test(frameRule) && !/--g1/.test(frameRule), 'the frame layer paints only the top and bottom washes');
  assert.match(css, /\.st-glow-rail \{[^}]*at 150px 46%[^}]*--g1/s, 'the sidebar layer paints the left wash 150px in from its outer edge');
  assert.match(css, /data-sidebar-side=right\] \.st-glow-rail[^}]*calc\(100% - 150px\) 46%/s, 'and mirrors for a sidebar on the right');
  assert.match(css, /forced-colors: active[^{]*\{[^}]*\.st-glow-rail \{ display: none/s);
  const sidebar = fs.readFileSync(new URL('../src/components/sidebar/AciraSidebar.tsx', import.meta.url), 'utf8');
  assert.ok((sidebar.match(/className="st-glow-rail"/g) || []).length === 2 && /ref=\{railGlowRef0\}/.test(sidebar) && /ref=\{railGlowRef1\}/.test(sidebar), 'the open sidebar renders the two layers');
});
