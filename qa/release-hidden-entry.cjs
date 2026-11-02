'use strict';
const fs=require('node:fs'),path=require('node:path'),{app}=require('electron');
if(process.env.ACIRA_BROWSER_TEST_HIDDEN!=='1'||!process.env.ACIRA_BROWSER_TEST_DATA)throw new Error('Release fixture requires explicit hidden disposable data');
const data=path.resolve(process.env.ACIRA_BROWSER_TEST_DATA);if(!data.startsWith(path.resolve('.qa-profiles')+path.sep))throw new Error('Release profile must remain inside the owned QA directory');
// Import discovery may only see an explicit synthetic source inside this fixture.
if(!process.env.LOCALAPPDATA||!path.resolve(process.env.LOCALAPPDATA).startsWith(data+path.sep))process.env.LOCALAPPDATA=path.join(data,'empty-import-sources');
const candidate=path.resolve(process.env.ACIRA_RELEASE_CANDIDATE||'');
if(!fs.existsSync(path.join(candidate,'build-identity.json')))throw new Error('Release candidate identity is required');
// Keep genuine popup/opener/session mechanics while preventing popup focus.
// This visibility-only fixture adaptation is recorded in every native report.
app.on('web-contents-created',(_event,contents)=>{
  const register=contents.setWindowOpenHandler.bind(contents);
  contents.setWindowOpenHandler=handler=>register(details=>{
    const answer=handler(details);return answer?.action==='allow'?{...answer,overrideBrowserWindowOptions:{...answer.overrideBrowserWindowOptions,show:false}}:answer;
  });
});
require(path.join(candidate,'desktop/main.cjs'));
