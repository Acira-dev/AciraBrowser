'use strict';
// Electron main for tests/test-hooks-debug-port.test.cjs: runs desktop/test-hooks.cjs as a packaged build would (isPackaged true), on a
// throwaway userData folder, then reports once Electron is ready. The test then knocks on the debugging port from outside.
const {app}=require('electron'),path=require('node:path');
const data=process.env.HOOK_FIXTURE_DATA;
if(!data||!path.isAbsolute(data))process.exit(2);
app.setPath('userData',data);
if(!app.getPath('userData').startsWith(data))process.exit(3);
const {lockDown}=require('../../../desktop/test-hooks.cjs');
const removed=lockDown({app:{isPackaged:true,getPath:name=>app.getPath(name),commandLine:app.commandLine},identity:{qa:false,dataFolder:'AciraBrowser'},env:process.env});
// On the person's own profile lockDown also drops --use-mock-keychain; this test run puts it back so it never reaches the real Keychain.
if(!app.commandLine.hasSwitch('use-mock-keychain'))app.commandLine.appendSwitch('use-mock-keychain');
app.on('window-all-closed',()=>{});
app.whenReady().then(()=>setTimeout(()=>process.stdout.write('READY '+JSON.stringify({removed,switch:app.commandLine.hasSwitch('remote-debugging-port'),hidden:process.env.ACIRA_BROWSER_TEST_HIDDEN||null})+'\n'),400));
