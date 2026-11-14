import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// 13.8 (smoothness): a new site colour must not write a custom property on <html>. Every element inherits a root custom property, so the
// write restyled the whole interface inside the tab switch's commit (most switches and navigations change the colour); nothing read it.
// Fails on 13.8 ba6910ed: syncSiteGlow set `--site-rgb` on the root.
class FakeStyle {
  props = new Map<string, string>();
  get opacity() { return this.props.get('opacity') ?? ''; } set opacity(v: string) { this.props.set('opacity', v); }
  get transition() { return this.props.get('transition') ?? ''; } set transition(v: string) { this.props.set('transition', v); }
  setProperty(name: string, value: string) { this.props.set(name, value); }
  removeProperty(name: string) { this.props.delete(name); }
  getPropertyValue(name: string) { return this.props.get(name) ?? ''; }
  get cssText() { return [...this.props].map(([k, v]) => `${k}: ${v};`).join(' '); }
  set cssText(text: string) { this.props.clear(); }
}
class FakeEl {
  style = new FakeStyle(); className = ''; attrs = new Map<string, string>(); children: FakeEl[] = []; isConnected = true; offsetWidth = 0;
  setAttribute(k: string, v: string) { this.attrs.set(k, v); } getAttribute(k: string) { return this.attrs.get(k) ?? null; } removeAttribute(k: string) { this.attrs.delete(k); } hasAttribute(k: string) { return this.attrs.has(k); }
  prepend(el: FakeEl) { this.children.unshift(el); }
  dataset: Record<string, string> = {};
}
const app = new FakeEl(), root = new FakeEl();
app.style.setProperty('--sidebar-rgb', '30 31 34'); app.style.setProperty('--sidebar-tone', 'dark'); app.style.setProperty('--sidebar-ink', '#e8eaed'); app.style.setProperty('--sidebar-muted', '#9aa0a6');
Object.assign(globalThis, {
  document: { querySelector: (sel: string) => sel.includes('.app') ? app : null, createElement: () => new FakeEl(), documentElement: root },
  matchMedia: () => ({ matches: false }), requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0), cancelAnimationFrame: () => {}, setTimeout
});
const glow = await import('../src/ui/siteGlowEngine');

test('a site colour paints the glow layers and writes no custom property on the root', () => {
  for (const color of ['#3b6ff5', '#1ed760', '#e6bf33']) {
    glow.syncSiteGlow({ color, level: 'soft', blocked: false }, { instant: true });
    assert.equal(root.attrs.get('data-site-color'), 'soft', 'the setting is still on the root (the tab glow CSS reads it)');
    assert.deepEqual([...root.style.props.keys()].filter(k => k.startsWith('--')), [], 'no custom property on <html>');
    assert.ok(app.children.some(layer => layer.style.getPropertyValue('--g1')), 'the colour lives on the glow layers');
  }
  glow.syncSiteGlow({ level: 'off', blocked: false }, { instant: true });
  assert.deepEqual([...root.style.props.keys()].filter(k => k.startsWith('--')), []);
});

test('no stylesheet, component or main-process file reads or writes --site-rgb', () => {
  const root = path.join(import.meta.dirname, '..');
  const hits: string[] = [];
  const walk = (dir: string) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) walk(f); else if (/\.(css|tsx?|cjs|mjs|js|html)$/.test(e.name) && /var\(--site-rgb|['"`]--site-rgb['"`]/.test(fs.readFileSync(f, 'utf8'))) hits.push(path.relative(root, f)); } };
  for (const dir of ['src', 'desktop']) walk(path.join(root, dir));
  assert.deepEqual(hits, [], 'a reader of --site-rgb needs the colour from the glow layers instead');
});
