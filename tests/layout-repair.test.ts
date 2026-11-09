import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {layoutRepair,layoutRepairMs} from '../src/ui/layoutSync';

const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('the sidebar-only switch is put back in line with the saved layout when they disagree',()=>{
  assert.equal(layoutRepair(true,true),null);
  assert.equal(layoutRepair(false,false),null);
  // Saved layout is toolbar tabs, the switch still says sidebar: the strip is hidden and the sidebar draws no tabs.
  assert.deepEqual(layoutRepair(false,true),{tabs:false});
  // Saved layout is sidebar tabs, the switch was lost (storage cleared): the strip shows instead of the sidebar list.
  assert.deepEqual(layoutRepair(true,false),{tabs:true});
});

test('a change made in Settings has time to reach the saved setting before any repair',()=>{
  assert.ok(layoutRepairMs>=500,'repair must wait out the IPC round trip');
});

test('the layout repair is wired into the browser view',()=>{
  const app=read('src/App.tsx');
  assert.match(app,/useLayoutRepair\(s\.verticalTabs,storedRail\.tabs/,'the repair reads the switch as stored');
  assert.match(app,/railPrefs=\{tabs:useShownTabsSwitch\(s\.verticalTabs,storedRail\.tabs,tab\.browserProfileId\)\}/,'the window is drawn from the switch as shown (a profile just arriving keeps the setting\'s layout)');
});

test('a view that throws reloads itself, a crashed browser view is reloaded by the main process, both with a limit',()=>{
  const boundary=read('src/main.tsx');
  assert.match(boundary,/componentDidCatch/);
  assert.match(boundary,/acira-ui-recovery/);
  // the planner (src/ui/viewRecovery.ts, tests/view-recovery.test.ts): a failure is tried again in place twice, then reloads twice a minute at most
  assert.match(boundary,/planRecovery\(/);
  assert.match(read('src/ui/viewRecovery.ts'),/MAX_RELOADS = 2/);
  const main=read('desktop/main.cjs');
  assert.match(main,/contents\.on\('render-process-gone'/);
  assert.match(main,/uiCrashTimes\.length>=3/);
  assert.match(main,/contents\.reload\(\)/);
});
