// Alt+Shift+Up/Down moves a sidebar tab and the keyboard stays on it. Moving a tab into or out of a tab group builds its row again (another parent) when
// main's new order arrives, a round trip later; the one-frame refocus found the old row, which then went, and focus fell to the page: the next press did nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { keepTabFocus, neighbourTabId, type TabFocusEnvironment } from '../src/ui/sidebarFocus';

const rig = () => {
  const body = {name: 'body'}, frames: Array<() => void> = [], focused: string[] = [];
  let time = 0, active: unknown = null, row: {focus: () => void; name: string} | null = null;
  const make = (name: string) => ({name, focus: () => { focused.push(name); active = name; }});
  const env: TabFocusEnvironment = {find: () => row, active: () => active, body, now: () => time, frame: run => { frames.push(run); }};
  const step = (ms = 16) => { time += ms; const run = frames.shift(); run?.(); };
  return {env, body, make, step, focused, setRow: (r: typeof row) => { row = r; }, setActive: (a: unknown) => { active = a; }, frames: () => frames.length};
};

test('focus lost to the page because the row was rebuilt goes back to the new row, even when the new order arrives many frames later', () => {
  const r = rig(), old = r.make('old row');
  r.setRow(old); r.setActive('old row');
  keepTabFocus('t1', r.env);
  for (let i = 0; i < 10; i++) r.step();                       // main has not answered yet: the old row still has focus
  assert.deepEqual(r.focused, [], 'nothing is stolen while the row still has focus');
  const fresh = r.make('new row'); r.setRow(fresh); r.setActive(r.body);   // the new order arrived: the old row is gone, the page has focus
  for (let i = 0; i < 4; i++) r.step();
  assert.deepEqual(r.focused, ['new row'], 'focus is put back once, on the new row');
});

test('focus the person moved elsewhere is never taken back, and the watch ends', () => {
  const r = rig(), row = r.make('row');
  r.setRow(row); r.setActive('another control');
  keepTabFocus('t1', r.env);
  for (let i = 0; i < 80; i++) r.step();
  assert.deepEqual(r.focused, []);
  assert.equal(r.frames(), 0, 'it stops after a short while');
});

test('a row that is not there yet is waited for', () => {
  const r = rig();
  r.setActive(r.body); keepTabFocus('t1', r.env);
  for (let i = 0; i < 3; i++) r.step();
  assert.deepEqual(r.focused, []);
  r.setRow(r.make('late row')); r.step();
  assert.deepEqual(r.focused, ['late row']);
});

test('the sidebar uses it for Alt+Shift+Up/Down on a tab row, not a single next-frame focus', () => {
  const source = fs.readFileSync(new URL('../src/components/sidebar/AciraSidebar.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('keepTabFocus(tab.id,tabFocusEnvironment())'));
  assert.ok(!source.includes("requestAnimationFrame(()=>document.querySelector<HTMLElement>(`.acira-sidebar [data-tab-id=\"${id}\"] .sb-tab-main`)?.focus())"));
});

test('Delete on a tab row moves focus to the row below, or above for the last one, so the arrow keys keep working', () => {
  assert.equal(neighbourTabId(['a', 'b', 'c'], 'a'), 'b');
  assert.equal(neighbourTabId(['a', 'b', 'c'], 'b'), 'c');
  assert.equal(neighbourTabId(['a', 'b', 'c'], 'c'), 'b', 'the last row falls back to the one above');
  assert.equal(neighbourTabId(['a'], 'a'), undefined, 'the only tab has no neighbour');
  assert.equal(neighbourTabId(['a', 'b'], 'x'), undefined);
  const source = fs.readFileSync(new URL('../src/components/sidebar/AciraSidebar.tsx', import.meta.url), 'utf8');
  const at = source.indexOf("event.key==='Delete'&&!pinned");
  assert.ok(at > 0 && source.slice(at, at + 400).includes('keepTabFocus(next,tabFocusEnvironment())'), 'the Delete handler hands focus on');
});
