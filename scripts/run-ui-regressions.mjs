// Native UI regressions on disposable profiles. Keep one GPU/browser test active
// at a time so focus and compositor state cannot invalidate another case.
import{spawnSync}from'node:child_process';import path from'node:path';
// Windows needs a visible compositor for view-transition acceptance. Profiles stay disposable.
const root=path.resolve(import.meta.dirname,'..');
for(const name of ['locked-page-resume','workspace-carry-and-cover','sidebar-reveal-motion','compact-seamless-review','cover-zoom-review','page-zoom-rendering','light-tab-selection-review','profile-switch-motion','third-profile-switch','profile-window-first-paint','many-profiles-switch','profile-switch-lands','hidden-window-sleep']){
 console.log('\n[ui-regression] '+name);
 const result=spawnSync(process.execPath,[path.join(root,'qa',name+'.mjs')],{cwd:root,stdio:'inherit',env:process.platform==='win32'?{...process.env,D_VISIBLE:'1'}:process.env});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status??1);
}
