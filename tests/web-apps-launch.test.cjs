'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {appIdFromArgv,WEB_APP_ARG}=require('../desktop/web-apps.cjs');

test('a shortcut launch names one installed app by its 20-hex id',()=>{
 assert.equal(WEB_APP_ARG,'--acira-app=');
 assert.equal(appIdFromArgv(['Acira.exe','--acira-app=0123456789abcdef0123','https://app.test/']),'0123456789abcdef0123');
 assert.equal(appIdFromArgv(['electron','C:/app','--acira-app=abcdefabcdefabcdefab']),'abcdefabcdefabcdefab');
});

test('anything else is not an app launch',()=>{
 for(const argv of [[],null,undefined,['Acira.exe','https://app.test/'],['--acira-app='],['--acira-app=XYZ'],['--acira-app=0123456789ABCDEF0123'],['--acira-app=0123456789abcdef012'],['--acira-app=../../evil'],[42,{}]])
  assert.equal(appIdFromArgv(argv),null,JSON.stringify(argv));
});
