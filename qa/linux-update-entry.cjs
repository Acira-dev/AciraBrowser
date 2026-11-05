'use strict';
// QA-only entry selector. AppImageUpdater relaunches without CLI arguments;
// keep the owned CDP connection available after that real native relaunch.
if(require('../package.json').aciraIdentity==='qa'&&process.env.ACIRA_UPDATE_TEST&&process.env.ACIRA_BROWSER_TEST_DATA){
 const {app}=require('electron');
 app.commandLine.appendSwitch('remote-debugging-port','0');
 if(process.env.ACIRA_LINUX_QA_KEYRING==='gnome-libsecret')app.commandLine.appendSwitch('password-store','gnome-libsecret');
 if(process.env.ACIRA_LINUX_QA_GL==='gl')app.commandLine.appendSwitch('use-angle','gl');
}
require('../desktop/main.cjs');
