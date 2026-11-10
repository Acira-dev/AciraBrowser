// 13.5, a report: "I hide the sidebar with the button and when I click it again to show it, nothing happens" (sidebar on the right). Cause (measured on 13.4, Mac and the Windows stand-in, left and right
// alike): while the sidebar's slide (a view transition) plays, about half a second, every pointer event lands on the root element, so a second press reached nothing. The press is now handed to the
// sidebar button when the pointer is over it. The real-app proof is the rig's press-timing sweep; these are the rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { controlUnder, forwardSwallowedPress, FORWARDED_SWITCH, SIDEBAR_BUTTON, type PressHost } from '../src/ui/swallowedPress';

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
type Handler = (event: any) => void;
function rig(buttons: { left: number; top: number; right: number; bottom: number }[], modeSwitch?: string) {
  const root = { dataset: { modeSwitch } as { modeSwitch?: string }, querySelectorAll: (selector: string) => selector === SIDEBAR_BUTTON ? buttons.map(box => ({ getBoundingClientRect: () => box })) : [] };
  let handler: Handler | null = null; const clicked: any[] = []; let stopped = false;
  const host: PressHost = { root: root as any, listen: (_type, h) => { handler = h as Handler; return () => { stopped = true; handler = null; }; }, click: event => { clicked.push(event); } };
  const stop = forwardSwallowedPress(host);
  const press = (target: unknown, x: number, y: number, extra: Record<string, unknown> = {}) => { let prevented = false; const event = { type: 'click', target, button: 0, clientX: x, clientY: y, detail: 1, defaultPrevented: false, preventDefault() { prevented = true; }, ...extra }; handler?.(event); return prevented; };
  return { root, press, clicked, stop, stopped: () => stopped };
}
const box = { left: 86, top: 4, right: 114, bottom: 32 };

test('a press the root swallowed during the sidebar slide goes to the button under the pointer, once, with its position and no keyboard detail of zero', () => {
  const r = rig([box], FORWARDED_SWITCH);
  assert.equal(r.press(r.root, 100, 18), true, 'the swallowed click is taken');
  assert.equal(r.clicked.length, 1);
  assert.equal(r.clicked[0].clientX, 100); assert.equal(r.clicked[0].clientY, 18);
  assert.ok(r.clicked[0].detail >= 1, 'a mouse click, not the keyboard\'s (App.tsx reads detail 0 as "by keyboard")');
});

test('nothing else is forwarded: not outside the button, not without a slide, not for another switch, not when the press hit something, not other buttons', () => {
  const outside = rig([box], FORWARDED_SWITCH);
  for (const [x, y] of [[85, 18], [114, 18], [100, 3], [100, 32], [600, 400]]) assert.equal(outside.press(outside.root, x, y), false, `${x},${y}`);
  const idle = rig([box], undefined); idle.press(idle.root, 100, 18); assert.equal(idle.clicked.length, 0, 'no switch playing: the browser delivers presses itself');
  const other = rig([box], 'appearance'); other.press(other.root, 100, 18); assert.equal(other.clicked.length, 0, 'an appearance switch');
  const hit = rig([box], FORWARDED_SWITCH); hit.press({ tagName: 'BUTTON' }, 100, 18); assert.equal(hit.clicked.length, 0, 'the press reached a real element: not ours to forward');
  const right = rig([box], FORWARDED_SWITCH); right.press(right.root, 100, 18, { button: 2 }); assert.equal(right.clicked.length, 0, 'a right click');
  const eaten = rig([box], FORWARDED_SWITCH); eaten.press(eaten.root, 100, 18, { defaultPrevented: true }); assert.equal(eaten.clicked.length, 0, 'a click something already handled');
  const none = rig([], FORWARDED_SWITCH); none.press(none.root, 100, 18); assert.equal(none.clicked.length, 0, 'no sidebar button on screen (Seamless, or Sidebar + address in Full)');
});

test('with several buttons (the toolbar\'s and the compact row\'s) the one under the pointer gets it; an empty box (display none) never does; the listener can be stopped', () => {
  assert.equal(controlUnder([{ control: 'a', box: { left: 0, top: 0, right: 0, bottom: 0 } }, { control: 'b', box }], 100, 18), 'b');
  assert.equal(controlUnder([{ control: 'a', box: { left: 0, top: 0, right: 0, bottom: 0 } }], 0, 0), null);
  const r = rig([box, { left: 300, top: 4, right: 328, bottom: 32 }], FORWARDED_SWITCH);
  r.press(r.root, 310, 10); assert.equal(r.clicked.length, 1);
  r.stop(); assert.equal(r.stopped(), true);
});

test('the sidebar button is the class the toolbar draws, the switch is the sidebar\'s own, and App installs the forwarding once', () => {
  assert.equal(SIDEBAR_BUTTON, '.sidebar-toggle-control'); assert.equal(FORWARDED_SWITCH, 'layout');
  assert.match(read('../src/App.tsx'), /useEffect\(\(\) => forwardSwallowedPress\(browserPressHost\(\)\), \[\]\);/);
  assert.match(read('../src/App.tsx'), /className="sidebar-toggle-control"/);
  assert.match(read('../src/ui/sharedMotion.ts'), /root\.dataset\.modeSwitch = kind;/, 'the attribute the rule reads is the one startModeTransition sets');
});

import { INTENT_MS, openBeforePress } from '../src/ui/swallowedPress';
test('quick presses alternate from what the last press meant, not from the frame that is still showing the old state', () => {
  // render says open (base true); press 1 at t=0 means hidden; the screen has not caught up at t=40: press 2 turns it back on
  const one = { open: false, base: true, at: 0 };
  assert.equal(openBeforePress(null, true, 0), true, 'no earlier press: the rendered state');
  assert.equal(openBeforePress(one, true, 40), false, 'press 2 sees "hidden" (the intent) while the render still says open');
  const two = { open: true, base: true, at: 40 };
  assert.equal(openBeforePress(two, true, 80), true, 'press 3 sees "shown": it hides again');
  // the render caught up (closed): the intent made from "open" no longer applies, the rendered state is the truth
  assert.equal(openBeforePress(one, false, 300), false);
  assert.equal(openBeforePress({ open: true, base: false, at: 300 }, false, 500), true, 'a queued second press: the render is still closed (base false), the intent says shown');
  // any other change retires it: the key shows the sidebar while an old intent says hidden
  assert.equal(openBeforePress({ open: false, base: true, at: 0 }, false, 600), false, 'rendered closed, intent from open: ignored');
  assert.equal(openBeforePress({ open: false, base: false, at: 0 }, false, 600), false);
  assert.equal(openBeforePress(one, true, INTENT_MS + 1), true, 'old: the rendered state');
  assert.equal(openBeforePress(one, true, -5), true, 'a clock that went back: the rendered state');
});
