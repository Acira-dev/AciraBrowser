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

const allFrame = () => [...app.children].reverse();   // creation order: top 0, bottom 0, top 1, bottom 1, ... (Beta 14 two-band split)
const frameLayers = () => allFrame().filter(el => el.getAttribute('data-band') === 'top');
const bottomLayers = () => allFrame().filter(el => el.getAttribute('data-band') === 'bottom');
const BLUE = { color: '#3b6ff5', level: 'rich' as const, blocked: false }, GREEN = { color: '#1ed760', level: 'rich' as const, blocked: false };
const glow = await import('../src/ui/siteGlowEngine');
const mount = (ref: unknown) => { const el = new FakeEl(); const cleanup = (ref as (e: FakeEl) => (() => void) | undefined)(el); return { el, unmount: () => { el.isConnected = false; cleanup?.(); } }; };
const lit = (el: FakeEl) => el.hasAttribute('data-lit'), wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Beta 14 speed pass (RAM bar): every idle frame layer kept `will-change: opacity`, so the three full-window layers stayed on the compositor from the first colour on, each with a compositor
// surface of its own (12.6 MB at 2x in dark) and an overlap layer above it: +50 MB of GPU memory against 13.8. A frame layer now wears `data-lit` like the rails, and only a lit layer keeps will-change.
test('a frame layer is lit while its glow shows or fades away, and not otherwise, with its rails', async () => {
  const rails = [mount(glow.railGlowRef0), mount(glow.railGlowRef1), mount(glow.railGlowRef2)];
  glow.syncSiteGlow(BLUE, { instant: false });
  const frame = frameLayers();
  assert.equal(frame.length, 3);
  assert.equal(frame.filter(lit).length, 1, 'a colour arrives: only the layer that fades in is lit');
  const blue = frame.findIndex(lit);
  assert.ok(Number(frame[blue].style.opacity) > 0, 'the lit one is the one that shows');
  assert.ok(lit(rails[blue].el), 'its rail with it');
  assert.deepEqual(bottomLayers().map(lit), frame.map(lit), 'and each band has its bottom band lit with it');
  glow.syncSiteGlow(GREEN, { instant: false });
  const green = frame.findIndex((el, i) => i !== blue && lit(el));
  assert.ok(green >= 0 && lit(frame[blue]), 'a new colour: the new layer is lit at once, the old one stays lit while it fades out');
  await wait(520);
  assert.deepEqual(frame.map(lit), frame.map((_, i) => i === green), 'after the fade only the layer that shows is lit');
  glow.syncSiteGlow({ ...GREEN, color: undefined, blocked: true } as never, { instant: false });
  assert.ok(lit(frame[green]), 'the glow goes: the layer stays lit while it fades away');
  await wait(520);
  assert.equal(frame.filter(lit).length, 0, 'faded away: no frame layer is lit');
  assert.equal(rails.filter(r => lit(r.el)).length, 0, 'and no rail');
  assert.equal(bottomLayers().filter(lit).length, 0, 'and no bottom band');
  glow.syncSiteGlow(BLUE, { instant: true });
  assert.equal(frame.filter(lit).length, 1, 'an instant colour lights its layer at once');
  glow.syncSiteGlow({ ...BLUE, color: undefined, blocked: true } as never, { instant: true });
  assert.equal(frame.filter(lit).length, 0, 'and an instant removal puts it away at once');
  for (const r of rails) r.unmount();
});

test('only a lit glow layer is kept on the compositor: an idle frame layer or rail drops will-change, a lit one keeps it', () => {
  const css = fs.readFileSync(new URL('../src/styles/site-glow.css', import.meta.url), 'utf8');
  const rule = (sel: string) => { const at = css.indexOf(sel + ' {'); assert.ok(at >= 0, sel); return css.slice(at, css.indexOf('}', at)); };
  assert.match(rule('.st-glow'), /will-change: opacity/, 'a layer that shows a glow stays a layer of its own, as before');
  assert.match(rule('.st-glow-rail'), /will-change: opacity/);
  assert.match(css, /\.st-glow:not\(\[data-lit\]\), \.st-glow-rail:not\(\[data-lit\]\) \{ will-change: auto; \}/, 'an idle one does not');
  assert.ok(!/\.st-glow[^{,]*:not\(\[data-lit\]\)[^{]*\{[^}]*(opacity|display|visibility|transition)/.test(css), 'nothing else changes for an idle layer: the picture (opacity 0) and its fades are the same');
});
