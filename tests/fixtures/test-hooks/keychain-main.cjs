'use strict';
// Electron main for tests/test-hooks-keychain.test.cjs: runs desktop/test-hooks.cjs as a packaged Mac build would (isPackaged true) on a throwaway
// test profile, started without --use-mock-keychain. It never touches Safe Storage unless the mock keychain switch is on: without it, that would
// be the real Keychain.
const {app,safeStorage}=require('electron'),path=require('node:path');
const data=process.env.ACIRA_BROWSER_TEST_DATA;
if(!data||!path.isAbsolute(data))process.exit(2);
app.setPath('userData',data);
const {lockDown}=require('../../../desktop/test-hooks.cjs');
const result=lockDown({app:{isPackaged:true,getPath:name=>app.getPath(name),commandLine:app.commandLine},identity:{qa:false,dataFolder:'AciraBrowser'},env:process.env,platform:'darwin'});
const report=value=>process.stdout.write('RESULT '+JSON.stringify({result,...value})+'\n');
if(!app.commandLine.hasSwitch('use-mock-keychain')){report({mock:false});process.exit(0);}
app.on('window-all-closed',()=>{});
app.whenReady().then(()=>{report({mock:true,blob:safeStorage.encryptString('acira-keychain-check').toString('base64')});app.exit(0);});
