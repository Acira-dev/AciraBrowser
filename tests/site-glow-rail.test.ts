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
  shown: string | null = null;   /* what the layer is drawn at right now (the computed opacity); null = settled at its inline opacity */
  style = new FakeStyle(); className = ''; attrs = new Map<string, string>(); children: FakeEl[] = []; isConnected = true; offsetWidth = 0;
  setAttribute(k: string, v: string) { this.attrs.set(k, v); } getAttribute(k: string) { return this.attrs.get(k) ?? null; } removeAttribute(k: string) { this.attrs.delete(k); } hasAttribute(k: string) { return this.attrs.has(k); }
  prepend(el: FakeEl) { this.children.unshift(el); } /* the engine prepends layer 0, then layer 1: `frameLayers()` below puts them back in creation order */
  dataset: Record<string, string> = {};
}
const app = new FakeEl(), root = new FakeEl();
app.style.setProperty('--sidebar-rgb', '30 31 34'); app.style.setProperty('--sidebar-tone', 'dark'); app.style.setProperty('--sidebar-ink', '#e8eaed'); app.style.setProperty('--sidebar-muted', '#9aa0a6');
Object.assign(globalThis, {
  getComputedStyle: (el: FakeEl) => ({ opacity: el.shown ?? el.style.opacity }),
  document: { querySelector: (sel: string) => sel.includes('.app') ? app : null, createElement: () => new FakeEl(), documentElement: root },
  matchMedia: () => ({ matches: false }), requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0), cancelAnimationFrame: () => {}, setTimeout
});

const frameLayers = () => [...app.children].reverse();
const BLUE = { color: '#3b6ff5', level: 'rich' as const, blocked: false }, GREEN = { color: '#1ed760', level: 'rich' as const, blocked: false };
const glow = await import('../src/ui/siteGlowEngine');
const mount = (ref: unknown) => { const el = new FakeEl(); const cleanup = (ref as (e: FakeEl) => (() => void) | undefined)(el); return { el, unmount: () => { el.isConnected = false; cleanup?.(); } }; };

test('a sidebar mounted before the glow follows all three frame layers: colours, opacity and fade in lockstep', () => {
  const rails = [mount(glow.railGlowRef0), mount(glow.railGlowRef1), mount(glow.railGlowRef2)];
  glow.syncSiteGlow(BLUE, { instant: false });
  const frame = frameLayers();
  assert.equal(frame.length, 3, 'the three frame layers exist');
  for (const [i, r] of rails.entries()) {
    assert.equal(r.el.style.opacity, frame[i].style.opacity, `rail layer ${i} has its frame layer's opacity`);
    assert.equal(r.el.style.transition, frame[i].style.transition, `rail layer ${i} fades with its frame layer`);
    assert.equal(r.el.style.getPropertyValue('--g1'), frame[i].style.getPropertyValue('--g1'));
  }
  const opacities = rails.map(r => Number(r.el.style.opacity)).sort();
  assert.deepEqual(opacities.slice(0, 2), [0, 0]); assert.ok(opacities[2] > 0);
  for (const r of rails) r.unmount();
});

test('a sidebar that opens while the glow is on takes the current state at once, no fade from nothing', () => {
  const live = frameLayers();
  const rails = [mount(glow.railGlowRef0), mount(glow.railGlowRef1), mount(glow.railGlowRef2)];
  for (const [i, r] of rails.entries()) { assert.equal(r.el.style.opacity, live[i].style.opacity); assert.equal(r.el.style.getPropertyValue('--g1'), live[i].style.getPropertyValue('--g1')); }
  assert.ok(rails.some(r => Number(r.el.style.opacity) > 0), 'one of them carries the glow on arrival');
  for (const r of rails) r.unmount();
});

test('a new colour cross-fades the sidebar layers with the frame layers; a sidebar that went away is left alone', () => {
  const rails = [mount(glow.railGlowRef0), mount(glow.railGlowRef1), mount(glow.railGlowRef2)], gone = mount(glow.railGlowRef0);
  gone.unmount(); const before = gone.el.style.cssText;
  glow.syncSiteGlow(GREEN, { instant: false });
  const frame = frameLayers();
  for (const [i, r] of rails.entries()) { assert.equal(r.el.style.opacity, frame[i].style.opacity); assert.equal(r.el.style.transition, frame[i].style.transition); assert.equal(r.el.style.getPropertyValue('--g1'), frame[i].style.getPropertyValue('--g1')); }
  assert.match(rails.map(r => r.el.style.transition).join(' '), /opacity 420ms/, 'it is a fade, not a cut');
  assert.equal(gone.el.style.cssText, before, 'an unmounted layer is not touched');
  glow.syncSiteGlow({ ...GREEN, color: undefined, blocked: true } as never, { instant: true });
  for (const r of rails) assert.equal(r.el.style.opacity, '0');
  for (const r of rails) r.unmount();
});

// A colour that arrives while a fade is running used to be painted into the layer that was still fading out (its colour swapped while visible, its opacity snapped to 0): the frame's tint lost a fifth of its strength in one frame.
test('a colour that arrives inside a running fade goes on a layer that shows nothing: the layer that is fading out is neither repainted nor cut', () => {
  assert.equal(glow.pickGlowLayer([0, 0, 0], 0), 1, 'at rest: the first layer after the front');
  assert.equal(glow.pickGlowLayer([.4, .6, 0], 1), 2, 'a fade is running: the free layer takes the new colour');
  assert.equal(glow.pickGlowLayer([.3, .7, .2], 1), 2, 'a third colour inside two fades: the one that shows the least');
  assert.equal(glow.pickGlowLayer([0, 1, 0], 2), 0, 'the front is never taken');
  const rails = [mount(glow.railGlowRef0), mount(glow.railGlowRef1), mount(glow.railGlowRef2)];
  glow.syncSiteGlow({ ...BLUE }, { instant: true });
  glow.syncSiteGlow({ ...GREEN }, { instant: false });
  const frame = frameLayers(), mid = frame.map(el => el.style.getPropertyValue('--g1'));
  const greenAt = frame.findIndex(el => Number(el.style.opacity) > 0), blueAt = frame.findIndex((el, i) => i !== greenAt && el.style.getPropertyValue('--g1') !== '' && el.style.opacity === '0' && el.style.transition.includes('opacity 420ms'));
  assert.ok(greenAt >= 0 && blueAt >= 0, 'one layer fades in, one fades out');
  frame[greenAt].shown = '0.35'; frame[blueAt].shown = '0.55';
  const blueColour = frame[blueAt].style.getPropertyValue('--g1');
  glow.syncSiteGlow({ color: '#e95142', level: 'rich', blocked: false }, { instant: false });
  assert.equal(frame[blueAt].style.getPropertyValue('--g1'), blueColour, 'the layer that is fading out keeps its colour');
  assert.ok(frame[blueAt].style.transition.includes('opacity 420ms') && frame[blueAt].style.opacity === '0', 'and goes on fading from where it is (a transition, never none)');
  assert.ok(frame[greenAt].style.transition.includes('opacity 420ms') && frame[greenAt].style.opacity === '0', 'the one that was fading in turns round from where it is');
  const third = frame.findIndex((_, i) => i !== greenAt && i !== blueAt);
  assert.ok(Number(frame[third].style.opacity) > 0 && frame[third].style.getPropertyValue('--g1') !== mid[third], 'the new colour is on the free layer, fading in');
  frame[greenAt].shown = null; frame[blueAt].shown = null;
  glow.syncSiteGlow({ color: undefined, level: 'rich', blocked: true } as never, { instant: true });
  for (const r of rails) r.unmount();
});

test('the left wash is drawn by the sidebar, not by the frame layer, on both sides', () => {
  const css = fs.readFileSync(new URL('../src/styles/site-glow.css', import.meta.url), 'utf8');
  const frameRule = css.slice(css.indexOf('.st-glow {'), css.indexOf('}', css.indexOf('.st-glow {')));
  assert.ok(!/150px 46%/.test(frameRule) && !/--g1/.test(frameRule), 'the frame layer paints only the top and bottom washes');
  assert.match(css, /\.st-glow-rail \{[^}]*at 150px 46%[^}]*--g1/s, 'the sidebar layer paints the left wash 150px in from its outer edge');
  assert.match(css, /data-sidebar-side=right\] \.st-glow-rail[^}]*calc\(100% - 150px\) 46%/s, 'and mirrors for a sidebar on the right');
  assert.match(css, /forced-colors: active[^{]*\{[^}]*\.st-glow-rail \{ display: none/s);
  const sidebar = fs.readFileSync(new URL('../src/components/sidebar/AciraSidebar.tsx', import.meta.url), 'utf8');
  assert.ok((sidebar.match(/className="st-glow-rail"/g) || []).length === 3 && /ref=\{railGlowRef0\}/.test(sidebar) && /ref=\{railGlowRef1\}/.test(sidebar) && /ref=\{railGlowRef2\}/.test(sidebar), 'the open sidebar renders the two layers');
});
