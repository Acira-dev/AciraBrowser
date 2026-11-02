'use strict';
// Only this QA process sees a synthetic OS home; import suggestions must never
// discover the person's actual browser accounts during a disposable UI test.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const data=path.resolve(process.env.ACIRA_BROWSER_TEST_DATA||'');
if(!data.startsWith(path.resolve('.qa-profiles')+path.sep))throw Error('Owned QA profile required');
const home=path.join(data,'fixture-home');fs.mkdirSync(home,{recursive:true});os.homedir=()=>home;
require(path.resolve(process.env.ACIRA_QA_MAIN||'desktop/main.cjs'));
