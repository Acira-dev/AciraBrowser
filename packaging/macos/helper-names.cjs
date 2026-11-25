'use strict';
// D139 (22 Nov 2026): Acira's page, graphics and plug-in processes showed in Activity Monitor as "Electron Helper", "Electron Helper (Renderer)",
// "(GPU)" and "(Plugin)", and carried Electron's bundle id com.github.Electron.helper. The Mac packagers copy the engine's Contents/Frameworks in
// whole and never renamed the four helper bundles (electron-builder does that in its own Mac step, which the Mac build does not use).
//
// Electron finds its helpers by NAME (shell/app/electron_main_delegate_mac.mm, OverrideChildProcessPath): first
// "Electron Helper<suffix>.app/Contents/MacOS/Electron Helper<suffix>", then the same with the MAIN bundle's CFBundleName in place of "Electron"
// (shell/common/application_info_mac.mm). With neither there it stops at once: "Unable to find helper app". So the helpers are named after the
// bundle they sit in, exactly: "Acira Browser Helper..." in the browser, "Acira Installer Helper..." in the installer, which is a copy of the
// browser bundle under its own name and would not start with the browser's helpers left in it.
//
// brandHelpers runs BEFORE anything is signed (the rename changes each helper's Info.plist and executable name, which its signature seals);
// assertHelperNames is the build's check afterwards. Neither touches Electron Framework.framework: its name is fixed in the engine and in the
// Widevine VMP signature.
const fs=require('node:fs/promises'),path=require('node:path'),plist=require('plist');

const ENGINE_NAME='Electron';
/** The four helper kinds: what follows "<name> Helper" in the bundle and executable name, and what follows "<id>.helper" in the bundle id
 *  (electron-builder's scheme, so a packaged Acira reads like any other packaged Electron app). */
const HELPER_KINDS=Object.freeze([
 Object.freeze({suffix:'',id:''}),
 Object.freeze({suffix:' (Renderer)',id:'.Renderer'}),
 Object.freeze({suffix:' (GPU)',id:'.GPU'}),
 Object.freeze({suffix:' (Plugin)',id:'.Plugin'}),
]);
const helperName=(name,kind)=>name+' Helper'+kind.suffix;
const helperId=(id,kind)=>id+'.helper'+kind.id;
const exists=file=>fs.lstat(file).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});

/** The name and id the helpers are derived from: the bundle's own CFBundleName and CFBundleIdentifier. */
async function bundleIdentity(bundle){
 const info=plist.parse(await fs.readFile(path.join(bundle,'Contents/Info.plist'),'utf8'));
 const name=info.CFBundleName,id=info.CFBundleIdentifier;
 if(typeof name!=='string'||!name.trim()||name!==name.trim()||/[\/\0]/.test(name))throw Error('Mac helper names need the bundle\'s CFBundleName: '+JSON.stringify(name));
 if(name===ENGINE_NAME)throw Error('The bundle is still named "'+ENGINE_NAME+'": name it before its helpers are named after it.');
 if(typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(id))throw Error('Mac helper ids need the bundle\'s CFBundleIdentifier: '+JSON.stringify(id));
 return {name,id};
}

/** Renames the four helper bundles in bundle/Contents/Frameworks from "<from> Helper..." to "<the bundle's CFBundleName> Helper...": the bundle
 *  folder, its executable, and CFBundleName / CFBundleDisplayName / CFBundleExecutable / CFBundleIdentifier in its Info.plist (every other key
 *  stays). from: the name they carry now: the engine's ("Electron"), or the browser's when the installer is made from a copy of the browser.
 *  All four must be there and none may be named already: nothing is renamed unless everything can be. Signatures are NOT made here. */
async function brandHelpers(bundle,{from=ENGINE_NAME}={}){
 const {name,id}=await bundleIdentity(bundle),frameworks=path.join(bundle,'Contents/Frameworks');
 if(from===name)throw Error('The helpers in '+path.basename(bundle)+' are already named after "'+name+'".');
 const plan=[];
 for(const kind of HELPER_KINDS){
  const old=helperName(from,kind),next=helperName(name,kind),source=path.join(frameworks,old+'.app'),target=path.join(frameworks,next+'.app');
  if(!await exists(path.join(source,'Contents/MacOS',old))||!await exists(path.join(source,'Contents/Info.plist')))throw Error('Missing Mac helper "'+old+'" in '+path.basename(bundle)+': nothing was renamed.');
  if(await exists(target))throw Error('A Mac helper named "'+next+'" is already in '+path.basename(bundle)+': nothing was renamed.');
  plan.push({kind,old,next,source,target});
 }
 const done=[];
 for(const {kind,old,next,source,target} of plan){
  const infoFile=path.join(source,'Contents/Info.plist'),info=plist.parse(await fs.readFile(infoFile,'utf8'));
  Object.assign(info,{CFBundleName:next,CFBundleDisplayName:next,CFBundleExecutable:next,CFBundleIdentifier:helperId(id,kind)});
  await fs.writeFile(infoFile,plist.build(info));
  await fs.rename(path.join(source,'Contents/MacOS',old),path.join(source,'Contents/MacOS',next));
  await fs.rename(source,target);
  done.push({bundle:target,name:next,id:helperId(id,kind)});
 }
 await assertHelperNames(bundle);
 return done;
}

/** The build's check: bundle/Contents/Frameworks holds exactly the four helpers named after the bundle's own CFBundleName, each with one
 *  executable of the same name and an Info.plist that says the same, and no other .app (a helper left with the engine's name, or with the
 *  browser's name inside the installer, is found here: the app would not start, or would show another program's name). Throws with every problem. */
async function assertHelperNames(bundle){
 const {name,id}=await bundleIdentity(bundle),frameworks=path.join(bundle,'Contents/Frameworks'),problems=[];
 const expected=new Map(HELPER_KINDS.map(kind=>[helperName(name,kind)+'.app',kind]));
 const found=(await fs.readdir(frameworks)).filter(entry=>entry.endsWith('.app')).sort();
 for(const entry of found)if(!expected.has(entry))problems.push('"'+entry+'" is not a helper of "'+name+'" (its name must start with "'+name+' Helper")');
 for(const [entry,kind] of expected){
  const wanted=helperName(name,kind),root=path.join(frameworks,entry);
  if(!found.includes(entry)){problems.push('"'+entry+'" is missing');continue;}
  let programs=[];try{programs=(await fs.readdir(path.join(root,'Contents/MacOS'))).sort();}catch{/* reported below */}
  if(programs.length!==1||programs[0]!==wanted)problems.push('"'+entry+'" must hold the one executable "'+wanted+'", it holds '+JSON.stringify(programs));
  let info={};try{info=plist.parse(await fs.readFile(path.join(root,'Contents/Info.plist'),'utf8'));}catch{problems.push('"'+entry+'" has no readable Info.plist');continue;}
  for(const key of ['CFBundleName','CFBundleDisplayName','CFBundleExecutable'])if(info[key]!==wanted)problems.push('"'+entry+'" '+key+' is '+JSON.stringify(info[key])+', not "'+wanted+'"');
  if(info.CFBundleIdentifier!==helperId(id,kind))problems.push('"'+entry+'" CFBundleIdentifier is '+JSON.stringify(info.CFBundleIdentifier)+', not "'+helperId(id,kind)+'"');
 }
 if(problems.length)throw Error('Mac helper names in '+path.basename(bundle)+' are wrong: '+problems.join('; ')+'.');
 return [...expected.keys()].map(entry=>path.join(frameworks,entry));
}

module.exports={ENGINE_NAME,HELPER_KINDS,helperName,helperId,bundleIdentity,brandHelpers,assertHelperNames};
