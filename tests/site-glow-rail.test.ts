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
  prepend(el: FakeEl) { this.children.unshift(el); } /* the engine prepends layer 0, then layer 1: `frameLayers()` below puts them back in creation order (three: Beta 14/site tint) */
  dataset: Record<string, string> = {};
}
const app = new FakeEl(), root = new FakeEl();
app.style.setProperty('--sidebar-rgb', '30 31 34'); app.style.setProperty('--sidebar-tone', 'dark'); app.style.setProperty('--sidebar-ink', '#e8eaed'); app.style.setProperty('--sidebar-muted', '#9aa0a6');
Object.assign(globalThis, {
  getComputedStyle: (el: FakeEl) => ({ opacity: el.shown ?? el.style.opacity }),
  document: { querySelector: (sel: string) => sel.includes('.app') ? app : null, createElement: () => new FakeEl(), documentElement: root },
  matchMedia: () => ({ matches: false }), requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0), cancelAnimationFrame: () => {}, setTimeout
});

const allFrame = () => [...app.children].reverse();   // creation order: top 0, bottom 0, top 1, bottom 1, ...
const frameLayers = () => allFrame().filter(el => el.getAttribute('data-band') === 'top');
const bottomLayers = () => allFrame().filter(el => el.getAttribute('data-band') === 'bottom');
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
  // one is in, the others out
  const opacities = rails.map(r => Number(r.el.style.opacity)).sort();
  assert.deepEqual(opacities.slice(0, 2), [0, 0]); assert.ok(opacities[2] > 0);
  const low = bottomLayers(); assert.equal(low.length, 3, 'and a bottom band for each');
  for (const [i, el] of low.entries()) { assert.equal(el.style.opacity, frame[i].style.opacity, `bottom band ${i}: the top band's opacity`); assert.equal(el.style.transition, frame[i].style.transition, `bottom band ${i}: its fade`); assert.equal(el.style.getPropertyValue('--g3'), frame[i].style.getPropertyValue('--g3')); assert.equal(el.style.getPropertyValue('--g2'), frame[i].style.getPropertyValue('--g2')); }
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

// Beta 14 full pass round 5 (G4 / the toolbar tint): a colour that arrives while a fade is running used to be painted into the layer that was still fading out (its colour swapped while visible, its opacity snapped to 0).
test('a colour that arrives inside a running fade goes on a layer that shows nothing: the layer that is fading out is neither repainted nor cut', () => {
  assert.equal(glow.pickGlowLayer([0, 0, 0], 0), 1, 'at rest: the first layer after the front');
  assert.equal(glow.pickGlowLayer([.4, .6, 0], 1), 2, 'a fade is running: the free layer takes the new colour');
  assert.equal(glow.pickGlowLayer([.3, .7, .2], 1), 2, 'a third colour inside two fades: the one that shows the least');
  assert.equal(glow.pickGlowLayer([0, 1, 0], 2), 0, 'the front is never taken');
  const rails = [mount(glow.railGlowRef0), mount(glow.railGlowRef1), mount(glow.railGlowRef2)];
  glow.syncSiteGlow({ ...BLUE }, { instant: true });
  glow.syncSiteGlow({ ...GREEN }, { instant: false });
  const frame = frameLayers(), mid = frame.map(el => el.style.getPropertyValue('--g1'));
  // 120 ms into the green fade: the green layer is half in, the blue one half out
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
  const low = bottomLayers(); for (const i of [blueAt, greenAt, third]) { assert.equal(low[i].style.opacity, frame[i].style.opacity, `the bottom band ${i} fades as its top band`); assert.equal(low[i].style.transition, frame[i].style.transition); }
  assert.equal(low[blueAt].style.getPropertyValue('--g3'), frame[blueAt].style.getPropertyValue('--g3'), 'the fading-out band keeps its colour too');
  frame[greenAt].shown = null; frame[blueAt].shown = null;
  glow.syncSiteGlow({ color: undefined, level: 'rich', blocked: true } as never, { instant: true });
  for (const r of rails) r.unmount();
});

test('final round, item 5: the bottom band is not drawn (it lit only the strip under the page card, a line from the sidebar\'s edge); the layers stay', () => {
  const css = fs.readFileSync(new URL('../src/styles/site-glow.css', import.meta.url), 'utf8');
  assert.ok(/\.st-glow\[data-band=bottom\] \{ display: none; \}/.test(css), 'the bottom band does not paint');
  assert.ok(!/\.st-glow\[data-band=top\] \{[^}]*display: none/.test(css), 'the top band (the toolbar\'s light) still does');
});

test('the left light is drawn by the sidebar, not by the frame layer, on both sides: the edge light, not a round wash (Beta 14, F5)', () => {
  const css = fs.readFileSync(new URL('../src/styles/site-glow.css', import.meta.url), 'utf8');
  const frameRule = css.slice(css.indexOf('.st-glow {'), css.indexOf('}', css.indexOf('.st-glow {')));
  assert.ok(!/--g1/.test(frameRule), 'the frame layer paints only the top and bottom washes');
  // Beta 14 two-band split: each band is taller than its wash reaches, so outside the bands the old full-window layer was alpha 0
  const top = /\.st-glow\[data-band=top\] \{\s*top: 0; height: (\d+)px;\s*background: radial-gradient\(ellipse 50% 170px at 70% 30px, var\(--g2, transparent\) 0%, color-mix\(in srgb, var\(--g2, transparent\) 52%, transparent\) 22%, color-mix\(in srgb, var\(--g2, transparent\) 20%, transparent\) 46%, transparent 76%\);/.exec(css);
  const bottom = /\.st-glow\[data-band=bottom\] \{\s*bottom: 0; height: (\d+)px;\s*background: radial-gradient\(ellipse 55% 140px at 40% 100%, var\(--g3, transparent\) 0%, color-mix\(in srgb, var\(--g3, transparent\) 52%, transparent\) 22%, color-mix\(in srgb, var\(--g3, transparent\) 20%, transparent\) 46%, transparent 76%\);/.exec(css);
  assert.ok(top && bottom, 'two bands with the old gradients, stop for stop');
  assert.ok(Number(top![1]) >= 30 + .76 * 170 + 20, 'the top band reaches past its wash (159 px) with a margin');
  assert.ok(Number(bottom![1]) >= .76 * 140 + 20, 'the bottom band reaches past its wash (106 px) with a margin');
  assert.ok(!/150px 46%|360px 64%/.test(css), 'the round blob is gone');
  // the light sits on the sidebar's edge, at the selected row: the seam and the lights are at --ab-ex (the edge) and --ab-ty (the row's centre)
  assert.match(css, /\.st-glow-rail\[data-lit\]::before \{[^}]*at var\(--ab-ex\) var\(--ab-ty\)[^}]*--g1/s, 'radial lights hung on the edge at the row (no seam line: frame at rest)');
  assert.match(css, /@property --ab-edge-y \{ syntax: '<length>'; inherits: true;/, 'registered, so it glides with the selection and the pseudo-elements read it');
  assert.match(css, /html\[data-sidebar-side=right\] \.st-glow-rail \{[^}]*clip-path: inset\(0 0 0 16px\); --ab-ex: 0%/s, 'and mirrors for a sidebar on the right');
  assert.match(css, /forced-colors: active[^{]*\{[^}]*\.st-glow-rail \{ display: none/s);
  const sidebar = fs.readFileSync(new URL('../src/components/sidebar/AciraSidebar.tsx', import.meta.url), 'utf8');
  assert.ok((sidebar.match(/className="st-glow-rail"/g) || []).length === 6 && /ref=\{railGlowRef0\}/.test(sidebar) && /ref=\{railGlowRef1\}/.test(sidebar) && /ref=\{railGlowRef2\}/.test(sidebar), 'the open sidebar and the rail each render the three layers');
});

// Beta 14 fullpass3 (guard c2): the edge light's two pseudo-elements per layer exist only on a LIT rail (`data-lit`), because every style recalculation walks every element and the Sidebar mode morph recalculates the whole tree each frame.
test('a rail is lit while its light shows or fades away, and not otherwise: the incoming layer at once, the outgoing one after its fade, all away when the glow goes', async () => {
  const lit = (r: ReturnType<typeof mount>) => r.el.hasAttribute('data-lit'), wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const rails = [mount(glow.railGlowRef0), mount(glow.railGlowRef1), mount(glow.railGlowRef2)], count = (list = rails) => list.filter(lit).length;
  assert.equal(count(), 0, 'no glow: no pseudo-elements on any layer');
  glow.syncSiteGlow(BLUE, { instant: false });
  assert.equal(count(), 1, 'a colour arrives: the incoming layer is lit, the waiting ones are not');
  const incoming = rails.find(lit)!;
  assert.ok(Number(incoming.el.style.opacity) > 0 && rails.filter(r => r !== incoming).every(r => r.el.style.opacity === '0'), 'the lit one is the one that fades in');
  glow.syncSiteGlow(GREEN, { instant: false });
  assert.equal(count(), 2, 'a new colour: the new layer is lit at once and the old one stays lit while it fades out (never a cut)');
  await wait(520);
  assert.equal(count(), 1, 'after the old layer has faded it is put away');
  assert.equal(lit(incoming), false, 'the old one');
  const late = [mount(glow.railGlowRef0), mount(glow.railGlowRef1), mount(glow.railGlowRef2)];   // a sidebar that mounts now wears the current state: the lit layer is lit
  assert.equal(count(late), 1, 'a sidebar that opens while the glow is on lights only the layer that carries it');
  glow.syncSiteGlow({ ...GREEN, color: undefined, blocked: true } as never, { instant: false });
  assert.ok(count([...rails, ...late]) >= 1, 'the glow goes: the lit layer stays lit while it fades away');
  await wait(520);
  assert.equal(count([...rails, ...late]), 0, 'faded away: no layer has a pseudo-element');
  glow.syncSiteGlow(BLUE, { instant: false });
  glow.syncSiteGlow({ ...BLUE, color: undefined, blocked: true } as never, { instant: true });
  assert.equal(count(rails), 0, 'an instant removal puts them away at once');
  for (const r of [...rails, ...late]) r.unmount();
});

test('the stylesheet generates the edge light\'s pseudo-elements only for a lit rail: no rule on `.st-glow-rail::before/::after` without the gate', () => {
  const css = fs.readFileSync(new URL('../src/styles/site-glow.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /\.st-glow-rail::(?:before|after)/, 'every rule on the rail\'s pseudo-elements says [data-lit]');
  assert.ok((css.match(/\.st-glow-rail\[data-lit\]::(?:before|after)/g) || []).length >= 6);
  const engine = fs.readFileSync(new URL('../src/ui/siteGlowEngine.ts', import.meta.url), 'utf8');
  assert.match(engine, /for \(const el of stackOf\(inIndex\)\) lightRail\(el, true\);/, 'the incoming layer is lit with its rails (and its frame layer: site-glow-idle-layers.test.ts)');
  assert.match(engine, /unlightWhenFaded\(index, instant \? 0 : FADE_MS \+ 40\)/);
});

test('the edge light\'s top: a rail wears the band\'s bottom as --ab-top-y and data-top while there is a toolbar beside it, a later sidebar wears the same, and none without one', () => {
  const a = mount(glow.railGlowRef0), b = mount(glow.railGlowRef1);
  assert.equal(a.el.hasAttribute('data-top'), false, 'nothing measured yet: no mask');
  glow.placeEdgeTop(36);
  for (const r of [a, b]) { assert.equal(r.el.style.getPropertyValue('--ab-top-y'), '36px'); assert.equal(r.el.hasAttribute('data-top'), true); }
  const late = mount(glow.railGlowRef0);
  assert.equal(late.el.style.getPropertyValue('--ab-top-y'), '36px', 'a sidebar that opens now begins its light at the same line');
  assert.equal(late.el.hasAttribute('data-top'), true);
  glow.placeEdgeTop(0);
  for (const r of [a, b, late]) assert.equal(r.el.hasAttribute('data-top'), false, 'no toolbar beside the sidebar (Seamless, hidden): the light runs to the top as before');
  for (const r of [a, b, late]) r.unmount();
});
