'use strict';
const EVENTS={'spellcheck-dictionary-download-begin':'downloading','spellcheck-dictionary-download-success':'downloaded','spellcheck-dictionary-initialized':'ready','spellcheck-dictionary-download-failure':'failed'};
const clone=value=>({enabled:value.enabled,languages:[...value.languages]});
const equal=(a,b)=>a.enabled===b.enabled&&JSON.stringify(a.languages)===JSON.stringify(b.languages);
function spellcheckChoice(value,available,platform,allowEmpty=false){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['enabled','languages'].includes(key))||typeof value.enabled!=='boolean'||!Array.isArray(value.languages)||value.languages.length>8||new Set(value.languages).size!==value.languages.length)throw new Error('Choose spellchecking and up to eight supported languages.');
 if(platform==='darwin'){if(value.languages.length)throw new Error('This platform selects spelling languages through the system spellchecker.');}
 else if(value.languages.some(language=>typeof language!=='string'||!available.includes(language))||!allowEmpty&&value.enabled&&!value.languages.length)throw new Error('Select only languages supported by this native spellchecker.');
 return clone(value);
}
function createSpellcheckPolicy({database,getProfiles,onChange=()=>{},platform=process.platform}){
 if(typeof database?.policy!=='function'||typeof database?.setPolicy!=='function'||typeof database?.transaction!=='function'||typeof getProfiles!=='function'||typeof onChange!=='function'||!['win32','linux','darwin'].includes(platform))throw new Error('Spellchecking requires native profile policy and a supported platform.');
 const sessions=new Map();
 function profile(id){const profiles=getProfiles();if(!Array.isArray(profiles))throw new Error('Native spelling profiles are unavailable.');const matches=profiles.filter(value=>value.id===id);const value=matches[0];if(matches.length!==1||typeof value?.id!=='string'||!value.id||value.id.length>200||typeof value.partition!=='string'||!value.partition||value.partition.length>250)throw new Error('Select a canonical native spelling profile.');return value;}
 function available(session){const languages=session.availableSpellCheckerLanguages;if(!Array.isArray(languages)||languages.length>1000||languages.some(value=>typeof value!=='string'||!value||value.length>80)||new Set(languages).size!==languages.length)throw new Error('Native spelling languages are unavailable.');return [...languages];}
 function current(session){const enabled=session.isSpellCheckerEnabled(),languages=session.getSpellCheckerLanguages();if(typeof enabled!=='boolean'||!Array.isArray(languages))throw new Error('Native spelling state is unavailable.');return spellcheckChoice({enabled,languages:platform==='darwin'?[]:languages},available(session),platform,true);}
 function attached(session){const entry=sessions.get(session),canonical=entry&&profile(entry.profileId);if(!entry||canonical.partition!==entry.partition||!!canonical.private!==entry.privateMode||session.isPersistent()!==!entry.privateMode)throw new Error('The native spelling profile changed.');return entry;}
 function readPolicy(entry){const policy=database.policy(entry.profileId,'*');if(policy!==null&&policy!==undefined&&(typeof policy!=='object'||Array.isArray(policy)))throw new Error('The saved profile policy is malformed.');return policy||{};}
 function saved(entry,session){if(entry.privateMode)return clone(entry.choice);const policy=readPolicy(entry);return Object.hasOwn(policy,'spellcheck')?spellcheckChoice(policy.spellcheck,available(session),platform):clone(entry.baseline);}
 function status(session){const entry=attached(session),choice=saved(entry,session),native=current(session);return {profileId:entry.profileId,privateMode:entry.privateMode,languageMode:platform==='darwin'?'system':'selected',choice,current:native,matchesSaved:equal(choice,native),needsLanguageChoice:platform!=='darwin'&&native.enabled&&!native.languages.length,availableLanguages:platform==='darwin'?[]:available(session),resources:choice.languages.map(language=>({language,state:entry.resources.get(language)||'unobserved'})),observedResources:[...entry.resources].map(([language,state])=>({language,state})),downloadSource:platform==='darwin'?'system':'native-engine',failure:entry.failure,customWordScope:entry.privateMode?'unavailable':platform==='darwin'||platform==='win32'?'native-and-system':'native'};}
 function publish(session){try{const value=status(session),result=onChange(value,session);result?.catch?.(()=>{});}catch{}}
 function apply(session,value){session.setSpellCheckerEnabled(false);if(platform!=='darwin')session.setSpellCheckerLanguages([...value.languages]);session.setSpellCheckerEnabled(value.enabled);if(!equal(current(session),value))throw new Error('The native spelling choice could not be read back.');}
 function attach(session,profileId,privateMode){
  const canonical=profile(profileId);if(typeof privateMode!=='boolean'||!!canonical.private!==privateMode||typeof session?.isPersistent!=='function'||session.isPersistent()!==!privateMode||!privateMode&&!canonical.partition.startsWith('persist:')||privateMode&&canonical.partition.startsWith('persist:')||['isSpellCheckerEnabled','getSpellCheckerLanguages','setSpellCheckerEnabled','setSpellCheckerLanguages','on','off'].some(method=>typeof session[method]!=='function'))throw new Error('Attach the actual persistent or ephemeral native spelling session.');
  const existing=sessions.get(session);if(existing){if(existing.profileId!==profileId||existing.privateMode!==privateMode)throw new Error('One native spelling session cannot have two owners.');return status(session);}
  if([...sessions.values()].some(value=>value.profileId===profileId))throw new Error('One native spelling profile cannot have two sessions.');
  const baseline=current(session),entry={profileId,privateMode,partition:canonical.partition,baseline,choice:clone(baseline),resources:new Map(),listeners:[],muting:1,failure:null};sessions.set(session,entry);
  let mutated=false;try{
   for(const [event,state]of Object.entries(EVENTS)){const handler=(_event,language)=>{try{if(sessions.get(session)!==entry||typeof language!=='string'||!available(session).includes(language))return;if(entry.resources.size>=64&&!entry.resources.has(language))entry.resources.delete(entry.resources.keys().next().value);entry.resources.set(language,state);}catch{entry.failure='Native dictionary resource state is unavailable.';}if(!entry.muting)publish(session);};session.on(event,handler);entry.listeners.push(()=>session.off(event,handler));}
   const choice=saved(entry,session);if(!equal(choice,baseline)){mutated=true;apply(session,choice);}entry.muting=0;return status(session);
  }catch(error){entry.muting=0;let restored=!mutated;if(mutated)try{apply(session,baseline);restored=true;}catch{}if(restored){for(const remove of entry.listeners)remove();sessions.delete(session);}else{entry.failure='Native spelling could not be initialized or restored. Review its current settings.';publish(session);}throw error;}
 }
 function set(session,value){
  const entry=attached(session),selected=spellcheckChoice(value,available(session),platform),before=current(session);entry.muting++;entry.failure=null;
  try{
   if(entry.privateMode){apply(session,selected);attached(session);entry.choice=clone(selected);}
   else database.transaction(()=>{const policy=readPolicy(entry);database.setPolicy(entry.profileId,'*',{...policy,spellcheck:selected});apply(session,selected);attached(session);if(!equal(saved(entry,session),selected))throw new Error('The saved spelling choice could not be read back.');});
  }catch(error){try{apply(session,before);}catch{entry.failure='The native spelling state could not be restored. Review its current settings.';}throw error;}
  finally{entry.muting--;publish(session);}
  return status(session);
 }
 function release(session){const entry=sessions.get(session);if(!entry)return {released:false};if(entry.privateMode){entry.muting++;try{apply(session,entry.baseline);}catch(error){entry.failure='The private spelling baseline could not be restored.';throw error;}finally{entry.muting--;}}for(const remove of entry.listeners)remove();entry.resources.clear();sessions.delete(session);return {released:true};}
 return {attach,status,set,release};
}
module.exports={createSpellcheckPolicy,spellcheckChoice};
