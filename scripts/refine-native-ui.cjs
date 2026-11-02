const fs=require('fs');const edit=(p,fn)=>fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8')));
edit('src/App.tsx',s=>s.replace(/        const header = document.querySelector<HTMLElement>\('.browser-shell'\)[^\n]*\n\s+const assistant =[^\n]*\n/,'').replace('pageImmediate: true, assistant','pageImmediate: true').replace('assistant: floatingAssistant, ','').replace(/        const floatingAssistant = undefined;\n/,''));
edit('src/runtime/types.ts',s=>s.replace(/  assistant\?:[^\n]*\n/,''));
edit('src/features/BrowserSettings.tsx',s=>s.replace('className="bs-main"','className="bs-main bs-page"'));
edit('src/features/FrostWorkspace.tsx',s=>s.replaceAll('<AnimatePresence initial>','<AnimatePresence initial={false}>'));
edit('qa/browser-smoke.mjs',s=>s.replace("colorPreset:'burgundy',appearance:'dark'","colorPreset:'Burgundy',accentColor:'#4d1821',browserTint:'#4d1821',appearance:'light'").replace("await ui.screenshot", "await ui.waitForTimeout(400);await ui.screenshot"));
edit('vite.config.ts',s=>s.replaceAll('5188','5194').replace("build: { target: 'es2022' }","build: { target: 'es2022', rollupOptions:{onwarn(warning,warn){if(warning.code!=='MODULE_LEVEL_DIRECTIVE')warn(warning);}} }"));
