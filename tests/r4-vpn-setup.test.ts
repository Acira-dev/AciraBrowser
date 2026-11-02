import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SETUP_TOAST_LIMIT, clearSetupToasts, dismissSetupToast, setupToastRows, showSetupToast, subscribeSetupToasts} from '../src/features/onboarding/setupToastStore';

const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8').replace(/\r/g,'');

// R4-06 / R4-08 / R4-08b: setup's Connection sheet has a way back, "Get it" says what happened, and the page opens behind setup.

test('a setup toast appears at once, the same text again restarts instead of stacking, and it leaves by itself',async()=>{
  clearSetupToasts();
  let heard=0;const stop=subscribeSetupToasts(()=>heard++);
  const key=showSetupToast('Proton VPN’s download page is waiting',{ms:30});
  assert.equal(setupToastRows().length,1);
  assert.equal(showSetupToast('Proton VPN’s download page is waiting',{ms:30}),key,'same text, same row');
  assert.equal(setupToastRows().length,1);
  assert.equal(setupToastRows()[0].dismissible,false,'a plain confirmation carries no ×');
  await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(setupToastRows().length,0,'auto-dismissed');
  assert.ok(heard>=2,'listeners were told of the arrival and the departure');
  stop();
});

test('at most three show, newest last; an error carries a × and can be dismissed',()=>{
  clearSetupToasts();
  for(const text of ['a','b','c','d'])showSetupToast(text,{ms:60000});
  assert.deepEqual(setupToastRows().map(row=>row.text),['b','c','d']);
  const key=showSetupToast('failed',{tone:'error',ms:60000});
  assert.equal(setupToastRows().at(-1)!.dismissible,true);
  assert.equal(setupToastRows().length,SETUP_TOAST_LIMIT);
  dismissSetupToast(key);
  assert.ok(!setupToastRows().some(row=>row.key===key));
  clearSetupToasts();
  assert.equal(setupToastRows().length,0);
});

test('Get it opens the provider page in the BACKGROUND in setup, and in front in Settings',()=>{
  const hook=read('src/features/connection/useConnection.ts');
  assert.match(hook,/openProvider = \(url: string, options: \{ background\?: boolean \} = \{\}\) => runtime\.dispatch\(\{ type: 'tab\.new', url, \.\.\.\(options\.background \? \{ background: true \} : \{\}\) \}\)/,'only a caller that asks gets a background tab');
  const list=read('src/features/onboarding/VpnList.tsx');
  assert.match(list,/await openSite\(provider\.site, \{ background: true \}\)/,'setup asks for a background tab');
  const settings=read('src/features/settings/panels/privacy.tsx');
  assert.match(settings,/c\.openProvider\(provider\.url\)/,'Settings keeps the normal foreground tab');
  assert.doesNotMatch(read('src/features/connection/VpnPanel.tsx'),/background/,'the Settings and popup panel never opens a hidden tab');
});

test('Get it goes loader → check → "Added", with the pop-up naming the page, and failing back to the idle button with an error',()=>{
  const list=read('src/features/onboarding/VpnList.tsx');
  assert.match(list,/phase\(provider\.id, "loading"\)[\s\S]*await openSite[\s\S]*phase\(provider\.id, "added"\)[\s\S]*showSetupToast\(t\("setup\.vpn\.waiting", \{ name: provider\.name \}\)\)/);
  assert.match(list,/catch \{\s*phase\(provider\.id, "idle"\);\s*showSetupToast\(t\("setup\.vpn\.openFailed"[\s\S]*tone: "error"/,'a failed open leaves Get it usable and says so');
  assert.match(list,/preset=\{phase === "added" \? "check" : "loader"\}/,'one matrix: the loader becomes the check');
  assert.match(list,/phase === "idle" && onGet\(\)/,'a second click while adding or added does nothing, so no second tab');
  assert.doesNotMatch(list,/disabled=\{phase/,'the button is never disabled, so focus stays on it');
  const steps=read('src/features/onboarding/steps.tsx');
  assert.match(steps,/\{sheet && <ConnectionSheet[^\n]*\n[^\n]*\n\s*<SetupToastHost \/>/,'the pop-up outlives the sheet it was raised from');
});

test('every setup sheet has a Back: arrow, footer button and Esc, none of which applies anything',()=>{
  const steps=read('src/features/onboarding/steps.tsx');
  const connection=steps.slice(steps.indexOf('function ConnectionSheet'),steps.indexOf('/* ── Default browser'));
  assert.match(connection,/<SheetBack onClick=\{cancel\} \/>/,'the arrow');
  assert.match(connection,/<div className="fr-foot-start">[\s\S]*?onClick=\{cancel\}>\s*\{t\("setup\.back"\)\}/,'Back on the footer start, always (also when there is nothing to apply)');
  assert.match(connection,/event\.key === "Escape"[\s\S]*?latest\.current\.cancel\(\)/,'Esc goes back');
  assert.match(connection,/const cancel = \(\) => \{[\s\S]*?c\.setMode\(was\.mode\);[\s\S]*?c\.setHost\(was\.host\);[\s\S]*?c\.setPort\(was\.port\);[\s\S]*?onClose\(\);/,'back restores what was saved and closes');
  assert.doesNotMatch(connection.slice(0,connection.indexOf('const cancel')),/c\.apply\(\)/,'and does not call apply');
  const usage=steps.slice(steps.indexOf('function UsageSheet'),steps.indexOf('function ConnectionSheet'));
  assert.match(usage,/<SheetBack onClick=\{onClose\} \/>/,'the What’s sent sheet has the same arrow');
  const back=read('src/features/onboarding/SheetBack.tsx');
  assert.match(back,/title=\{`\$\{label\} · Esc`\}/,'the shortcut is shown');
  assert.match(back,/aria-label=\{label\}/);
});
