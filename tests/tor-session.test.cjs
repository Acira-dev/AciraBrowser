'use strict';
// R3-61: one Tor connection per app session. Source tripwires for the wiring that unit tests cannot reach (desktop/main.cjs is one
// big closure); the engine and service behaviour has its own unit tests in tor-engine.test.cjs and tor-window.test.cjs, and the
// real bootstrap check is qa/n-tor-session.mjs.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8').replace(/\r\n/g,'\n');
const main=read('desktop/main.cjs'),engine=read('desktop/browser-services/tor-engine.cjs'),registry=require('../desktop/shortcut-registry.cjs');

test('the last Tor tab or window closing never stops tor; only Acira quitting does',()=>{
 const acquire=/acquire\(id\)\{[^\n]*\n?/.exec(engine)[0];
 assert.ok(!/\bstop\(\)/.test(acquire),'releasing a lease must not stop tor');
 assert.match(engine,/freshCircuits\(\)/,'circuits are renewed when nobody is using Tor');
 assert.match(main,/app\.on\('will-quit',\(\)=>\{try\{if\(torService\)void torService\.engine\.stop\(\)/,'tor ends with the app');
});

test('opening a Tor tab starts Tor at once: a window with Tor tabs watches status and warms the engine when a new Tor tab appears',()=>{
 assert.match(main,/function syncTor\(\)\{/);
 // Locked-page reconciliation and dead-page cleanup make no new website views; Tor is still checked before page creation.
 assert.match(main,/function syncPages\(\)\{if\(!mainWindow\|\|!pagesAllowed\)return;(?:securedPages\.reconcile\(state\);)?(?:reapDeadPages\(\);)?syncTor\(\);/,'every state change checks for Tor tabs before it makes pages');
 const body=/function syncTor\(\)\{[^\n]*/.exec(main)[0];
 assert.match(body,/svc\.watch\(status=>emitBrowser\(\{type:'tor-status',status\}\)\)/,'the window shows live Tor status even with no Tor page');
 assert.match(body,/if\(fresh\)svc\.warm\(\)/,'a new Tor tab warms Tor');
 assert.match(body,/torSeen/,'only a Tor tab that was not seen before warms (a Tor tab that stays does not restart anything)');
});

test('New Tor identity resets the Tor tabs of every window, asks first, and acts only in Tor',()=>{
 assert.match(main,/resetTabs:async\(\)=>\{const reset=\[\];await Promise\.all\(\[\.\.\.controllers\]\.map\(async other=>/,'all windows, awaited');
 assert.match(main,/async resetTor\(\)\{\s*const torTabs=state\.tabs\.filter\(t=>torMode\|\|t\.privacy==='tor'\)/);
 assert.match(main,/inTor:torMode\|\|state\.tabs\.some\(t=>t\.privacy==='tor'\)/,'a Tor tab with no page yet may ask');
 assert.match(main,/case 'tor-identity':if\(torMode\|\|state\.tabs\.some\(t=>t\.privacy==='tor'\)\)\{[^\n]*targetTabId:'identity'/,'the command opens the confirmation in the Tor panel, and only in Tor');
 const command=registry.COMMANDS.find(item=>item.id==='tor-identity');
 assert.ok(command);assert.deepEqual(command.defaults,['Mod+Shift+U']);assert.equal(command.action.action,'tor-identity');
});

test('the Tor panel and the menu ask before a new identity, in plain words from the catalog',()=>{
 const panel=read('src/features/tor/TorPopover.tsx'),menu=read('src/components/BrowserMenu.tsx'),en=JSON.parse(read('src/i18n/en.json'));
 assert.match(panel,/role="alertdialog"/);assert.match(panel,/t\('tor\.identity\.body'\)/);assert.match(panel,/newTorIdentity\(\)/);
 assert.match(menu,/torActive&&torIdentity&&row\(/,'the menu row exists only in Tor');
 for(const id of ['tor.identity.title','tor.identity.body','tor.identity.confirm','shortcutCmd.tor-identity'])assert.ok(en[id],id);
 assert.match(en['tor.identity.body'],/cookies/);assert.match(en['tor.identity.body'],/Other tabs/);
});

test('R3-62: the Tor pill keeps the loading matrix, fades it after connecting and leaves a clean pill; the field carries the Tor gradient; no second matrix beside it',()=>{
 const chip=read('src/features/tor/TorChip.tsx'),css=read('src/features/tor/tor.css'),app=read('src/App.tsx');
 assert.match(chip,/'off' \| 'on' \| 'done'/,'three matrix states: none, connecting or stopped, the one connected ripple');
 assert.match(chip,/RIPPLE_MS \* motionScale\(\)/,'R3-17: the ripple timer honours --motion-scale');assert.match(chip,/FADE_MS \* motionScale\(\)/,'and so does the fade');
 assert.match(chip,/seen\.current && !reducedMotion && motionScale\(\) > 0 \? 'done' : 'off'/,'a chip that never watched Tor connect (a tab opened on a live connection) shows no matrix; the ripple plays only after a connection was watched');
 assert.match(chip,/data-matrix=\{matrix === 'off' \? 'off' : 'on'\}/);
 assert.match(css,/\.tor-chip\[data-matrix=off\] \.tor-chip-mark\{width:0;[^}]*opacity:0/,'the slot closes and fades');
 assert.match(css,/\.address-bar\[data-tor\][^{]*\{background-image:linear-gradient\(90deg/,'the field gradient starts at the pill');
 assert.match(app,/data-tor=\{isTorWindow\(state\) \|\| undefined\}/);
 assert.match(app,/<TorSecurityGlyph loading=\{tab\.loading\}/,'no second matrix while Tor connects: the page-info button shows its plain icon');
 assert.match(css,/\.app \.tor-chip,\.tor-chip\{[^}]*color:var\(--tor-ink\);background:transparent;/,'R3-69: no box of its own at rest; the label sits on the wash');
 assert.doesNotMatch(css,/animation:|@keyframes/,'the pill itself never animates; only the matrix component does');
});
