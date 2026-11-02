const fs=require('fs');const edit=(p,fn)=>fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8')));
edit('src/App.tsx',s=>s.replaceAll(" || tab.contentKind === 'fixture'",'').replaceAll("tab.contentKind === 'fixture'",'false').replace(/        if \(event.action === 'focus-composer'\)\n[^\n]*\n/,'').replace('state.closeRequest, ','').replaceAll('browsingWorkspaceLinks(state)',"[{page:'history',label:'History',icon:'history' as const}]").replaceAll('initial>','initial={false}>').replaceAll('initial animate','initial={false} animate'));
edit('src/features/FrostWorkspace.tsx',s=>s.replace(/        if \(mode === 'agent'\)\n\s+onStartTask\(value\);\n\s+else\n\s+onNavigate\(value\);/,'        onNavigate(value);'));
edit('src/components/TabGroupControls.tsx',s=>s.replace(/\{aiEnabled\(state\)&&item\('Ask Acira about this group'[\s\S]*?\}\)\}/,''));
edit('src/features/BrowserSettings.tsx',s=>s.replace('<AppearancePanel settings={s} onChange={update}/>','<AppearancePanel settings={s} onChange={update} onMore={()=>{}}/>'));
edit('src/runtime/browserChrome.ts',s=>s.replace("||tab.contentKind==='fixture'",''));
edit('src/runtime/core.ts',s=>s.replace('BrowserAction,BrowserSnapshot,TabSession','BrowserAction,BrowserSnapshot,TabSession,BrowserEvent').replace(',profile,s.experience',',profile').replace("tab.control='human';",''));
edit('src/ui/useNewTabReveal.ts',s=>s.replace(/   if\(tab.newTabMode==='agent'\)\{[^\n]*\}\n   else\{([^\n]*)\}/,'   {$1}').replace("||tab.contentKind==='fixture'",''));
