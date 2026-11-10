// 13.5, a report: "I hide the sidebar with the button and when I click it again to show it, nothing happens" (sidebar on the right). Cause (measured on 13.4, Mac and the Windows stand-in, left and right
// alike): while the sidebar's slide (a view transition) plays, about half a second, every pointer event lands on the root element, so a second press reached nothing. The press is now handed to the
// sidebar button when the pointer is over it. The real-app proof is the rig's press-timing sweep; these are the rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { controlUnder, forwardSwallowedPress, FORWARDED_SWITCH, SIDEBAR_BUTTON, TOGGLE_NAME, type PressHost } from '../src/ui/swallowedPress';

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
type Handler = (event: any) => void;
function rig(buttons: { left: number; top: number; right: number; bottom: number }[], modeSwitch?: string, drawn?: { left: number; top: number; right: number; bottom: number } | null) {
  const root = { dataset: { modeSwitch } as { modeSwitch?: string }, querySelectorAll: (selector: string) => selector === SIDEBAR_BUTTON ? buttons.map(box => ({ getBoundingClientRect: () => box })) : [] };
  let handler: Handler | null = null; const clicked: any[] = []; let stopped = false;
  const host: PressHost = { root: root as any, listen: (_type, h) => { handler = h as Handler; return () => { stopped = true; handler = null; }; }, click: event => { clicked.push(event); }, ...(drawn !== undefined ? { pictureBox: () => drawn } : {}) };
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

test('a press on where the button is DRAWN goes to it too: the slide moves its picture across while its box is already at the new place', () => {
  const moved = { left: 240, top: 4, right: 268, bottom: 32 };          // the box after the layout flipped
  const drawnAtOldPlace = { left: 86, top: 4, right: 114, bottom: 32 };  // the transition draws the button where the person sees it
  const r = rig([moved], FORWARDED_SWITCH, drawnAtOldPlace);
  assert.equal(r.press(r.root, 100, 18), true, 'on the drawn button: taken');
  assert.equal(r.clicked.length, 1, 'once, not once per box');
  assert.equal(r.clicked[0].clientX, 100);
  r.press(r.root, 250, 18); assert.equal(r.clicked.length, 2, 'and on the box itself, as before');
  r.press(r.root, 170, 18); assert.equal(r.clicked.length, 2, 'between the two places: nothing there');
  const plain = rig([moved], FORWARDED_SWITCH, null); plain.press(plain.root, 100, 18); assert.equal(plain.clicked.length, 0, 'no picture box: only the box');
  const idle = rig([moved], undefined, drawnAtOldPlace); idle.press(idle.root, 100, 18); assert.equal(idle.clicked.length, 0);
  assert.equal(TOGGLE_NAME, 'acira-sidebar-toggle');
  assert.match(read('../src/styles/view-morph.css'), /view-transition-name:acira-sidebar-toggle/);
  assert.match(read('../src/ui/swallowedPress.ts'), /::view-transition-group\(\$\{TOGGLE_NAME\}\)/);
});

import { REMEMBER_MS, boxHolds } from '../src/ui/swallowedPress';
test('the beat before the pictures exist: a press on the place the button was last pressed is still the button (13.5 final run: three presses 250 ms apart, the third dropped 4 times in 40)', () => {
  // the button was pressed at (100,18); the queued slide flipped the layout, its box is at x 240 now; the group has no picture yet
  const old = { left: 86, top: 4, right: 114, bottom: 32 }, flipped = { left: 240, top: 4, right: 268, bottom: 32 };
  let box = old, clock = 0, handler: Handler | null = null; const clicked: any[] = [];
  const button = { getBoundingClientRect: () => box, dispatchEvent: () => true };
  const root = { dataset: { modeSwitch: FORWARDED_SWITCH as string | undefined }, querySelectorAll: (selector: string) => selector === SIDEBAR_BUTTON ? [button] : [] };
  const host: PressHost = { root: root as any, listen: (_t, h) => { handler = h as Handler; return () => {}; }, click: e => { clicked.push(e); }, buttonOf: target => target === button ? button : null, now: () => clock, pictureBox: () => null };
  forwardSwallowedPress(host);
  const press = (target: unknown, x: number, y: number) => { let prevented = false; handler?.({ type: 'click', target, button: 0, clientX: x, clientY: y, detail: 1, defaultPrevented: false, preventDefault() { prevented = true; } }); return prevented; };
  press(button, 100, 18);                                         // an ordinary press on the button: nothing to forward, but its place is remembered
  assert.equal(clicked.length, 0);
  box = flipped; clock = 270;                                    // the layout flipped under it
  assert.equal(press(root, 100, 18), true, 'a press at the remembered place goes to the button');
  assert.equal(clicked.length, 1);
  clock = 540; press(root, 100, 18); assert.equal(clicked.length, 2, 'and the one after it: each forwarded press renews the memory');
  press(root, 250, 18); assert.equal(clicked.length, 3, 'the box itself, as ever');
  clock = 540 + REMEMBER_MS + 1; press(root, 100, 18); assert.equal(clicked.length, 3, 'old: forgotten');
  clock = 10; press(root, 100, 18); assert.equal(clicked.length, 3, 'a clock that went back: forgotten');
  // a picture box exists: the group is exact, the remembered place is not used (the button has glided away from it)
  const drawn = { left: 170, top: 4, right: 198, bottom: 32 };
  const withPicture: PressHost = { ...host, pictureBox: () => drawn }; clicked.length = 0; clock = 0;
  forwardSwallowedPress(withPicture); press(button, 100, 18); clock = 100; box = flipped;
  press(root, 100, 18); assert.equal(clicked.length, 0, 'the picture is at 170, not at 100');
  press(root, 180, 18); assert.equal(clicked.length, 1, 'on the picture');
  // not during another switch, not when the press hit something else
  root.dataset.modeSwitch = 'appearance'; clicked.length = 0; press(button, 100, 18); press(root, 100, 18); assert.equal(clicked.length, 0);
  assert.equal(boxHolds(old, 100, 18), true); assert.equal(boxHolds(old, 114, 18), false); assert.equal(boxHolds({ left: 5, top: 5, right: 5, bottom: 9 }, 5, 6), false);
});

test('13.6 final run: a forwarded press that lands on the hidden duplicate button (empty box, first in the page) does not wipe the remembered place, so the third press in the beat before the pictures exist is still forwarded (Compact, 3 presses 250 ms apart)', () => {
  // two .sidebar-toggle-control buttons: the hidden duplicate FIRST (box 0,0,0,0), the visible one second; both carry the toggle's view-transition-name, so both get the group's picture box while it exists
  let clock = 0, handler: Handler | null = null, group: { left: number; top: number; right: number; bottom: number } | null = null; const toggled: string[] = [];
  const hidden: any = { id: 'hidden', getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0 }), dispatchEvent: () => true };
  const shown: any = { id: 'shown', box: { left: 240, top: 2, right: 268, bottom: 30 }, getBoundingClientRect() { return this.box; }, dispatchEvent: () => true };
  const root = { dataset: { modeSwitch: FORWARDED_SWITCH as string | undefined }, querySelectorAll: (selector: string) => selector === SIDEBAR_BUTTON ? [hidden, shown] : [] };
  const host: PressHost = { root: root as any, listen: (_t, h) => { handler = h as Handler; return () => {}; }, now: () => clock, pictureBox: () => group, buttonOf: target => target === hidden || target === shown ? target as any : null,
    click: e => { toggled.push((e.target as any).id); handler?.({ type: 'click', target: e.target, button: 0, clientX: e.clientX, clientY: e.clientY, detail: 1, defaultPrevented: false, preventDefault() {} }); } };   // the dispatched click comes back through the window listener, as in the page
  forwardSwallowedPress(host);
  const press = (target: unknown, x: number, y: number) => { let prevented = false; handler?.({ type: 'click', target, button: 0, clientX: x, clientY: y, detail: 1, defaultPrevented: false, preventDefault() { prevented = true; } }); return prevented; };
  press(shown, 254, 16);                                                         // press 1: the open sidebar's own button
  clock = 265; group = { left: 95.6, top: 2, right: 123.6, bottom: 30 }; shown.box = { left: 86, top: 2, right: 114, bottom: 30 };
  assert.equal(press(root, 100, 16), true, 'press 2, under the group: forwarded (to the first control holding the pointer, the hidden one)');
  assert.deepEqual(toggled, ['hidden']);
  clock = 533; group = null; shown.box = { left: 240, top: 2, right: 268, bottom: 30 };   // the queued slide flipped the layout; its pictures do not exist yet; the old picture is still at x 100
  assert.equal(press(root, 100, 16), true, 'press 3 in the beat: still forwarded, the remembered place was not wiped by the hidden button\'s empty box');
  assert.equal(toggled.length, 2);
});
