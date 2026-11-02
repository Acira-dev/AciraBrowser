// Owned native display instrumentation; no hooks or delay are enabled in product code.
const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const data=path.resolve(process.env.ACIRA_BROWSER_TEST_DATA||'');if(!data.startsWith(path.resolve('.qa-profiles')+path.sep))throw Error('Owned QA profile required');
const home=path.join(data,'fixture-home');fs.mkdirSync(home,{recursive:true});os.homedir=()=>home;
const main=path.resolve(process.env.ACIRA_QA_MAIN||'desktop/main.cjs'),desktop=path.dirname(main);const states=[];global.__aciraDisplayLayers=states;
for(const [file,factory] of [['page-still.cjs','createPageStill'],['page-scrim.cjs','createPageScrim']]){
 if(!fs.existsSync(path.join(desktop,file)))continue;
 const module=require(path.join(desktop,file)),make=module[factory];module[factory]=options=>{const record={file,views:[],calls:[]},Ctor=options.WebContentsView;states.push(record);const api=make({...options,...(process.env.DISPLAY_QA_SLOW_SETTLE==='1'?{later:(fn,ms)=>setTimeout(fn,ms===32?200:ms)}:{}),WebContentsView:function(prefs){const view=new Ctor(prefs);record.views.push(view);const set=view.setVisible.bind(view);view.setVisible=on=>{record.calls.push({at:Date.now(),visible:on});return set(on);};return view;}});record.api=api;return api;};
}
if(process.env.DISPLAY_QA_COMPLETE==='1')new(require(path.resolve('desktop/accounts/onboarding.cjs')).OnboardingStore)({directory:path.join(data,'setup')}).update('profile-personal',{complete:true,step:'finish'});
require(main);
