'use strict';
// Real Electron language preferences; no request rewriting, UA spoofing or navigator shims.
function checkedLanguages(value) {
  if (value === null) return null;
  if (!Array.isArray(value) || !value.length || value.length > 8
    || value.some(tag => typeof tag !== 'string' || tag.length > 40 || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(tag)))
    throw Error('Choose up to eight valid language codes, in preference order.');
  try { return Intl.getCanonicalLocales(value); } catch { throw Error('Choose valid language codes such as en-US or fr.'); }
}
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
function createWebsiteLanguages({database, systemLanguages = () => []}) {
  const sessions = new WeakMap();
  const system = () => { try { const tags=checkedLanguages(systemLanguages());return tags?.length?tags:['en-US']; } catch { return ['en-US']; } };
  const saved = id => { if(!id)return null;const value=database.policy(id,'*')?.websiteLanguages;try { return value===undefined?null:checkedLanguages(value); } catch { return null; } };
  function attach(session,profileId,{privateMode=false,tor=false,inheritProfileId}={}) {
    const existing=sessions.get(session);
    if(existing){if(existing.profileId!==profileId)throw Error('Website-language session owner changed.');return status(session);}
    const choice=privateMode?saved(inheritProfileId):saved(profileId),current=tor?['en-US','en']:(choice||system());
    // Called before WebContents creation. Existing pages retain their prior native settings;
    // a changed preference deliberately waits for a complete restart.
    // Preserve Chromium's native language reduction for the system default.
    // Calling the setter with the full OS list would disclose extra languages.
    if(choice||tor)session.setUserAgent(session.getUserAgent(),current.join(','));
    sessions.set(session,{profileId,privateMode,tor,current:[...current],initialChoice:choice});
    return status(session);
  }
  function entry(session){const found=sessions.get(session);if(!found)throw Error('Website languages are not ready.');return found;}
  function status(session){
    const value=entry(session),choice=value.privateMode?value.initialChoice:saved(value.profileId),preferred=value.tor?['en-US','en']:(choice||system());
    // `visible` is what a website can read now (a chosen language list or Tor as is; the system default shows only its first language, like
    // Chromium's reduced header), `willSee` what it will read after a restart. `current` and `preferred` stay the raw lists the engine was given.
    const reduced=list=>value.tor||choice?[...list]:list.slice(0,1);
    return {profileId:value.profileId,privateMode:value.privateMode,tor:value.tor,choice,
      current:[...value.current],preferred:[...preferred],visible:value.tor||value.initialChoice?[...value.current]:value.current.slice(0,1),willSee:reduced(preferred),restartRequired:!same(preferred,value.current)};
  }
  function set(session,languages){
    const value=entry(session);if(value.privateMode||value.tor)throw Error('Change website languages in an ordinary profile. Private and Tor choices are not saved.');
    const choice=checkedLanguages(languages);
    database.transaction(()=>{const policy={...(database.policy(value.profileId,'*')||{})};if(choice===null)delete policy.websiteLanguages;else policy.websiteLanguages=choice;database.setPolicy(value.profileId,'*',policy);});
    return status(session);
  }
  /** What a website can read as navigator.languages: equal to the Accept-Language this session sends (a choice or Tor as is; the system default is reduced to its first language, like Chromium's native header). */
  function pageLanguages(session){const value=sessions.get(session);if(!value)return [system()[0]];return value.tor||value.initialChoice?[...value.current]:value.current.slice(0,1);}
  /** The first language websites will read for an ordinary profile whose session is not set up yet: its saved choice, else the system's first language. */
  function firstLanguage(profileId){return (saved(profileId)||system())[0]||'';}
  return {attach,status,set,pageLanguages,firstLanguage};
}
module.exports={createWebsiteLanguages,checkedLanguages};
