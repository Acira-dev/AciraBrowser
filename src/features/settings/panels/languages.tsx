import type { SettingsPanel, SettingsPanelProps } from '../panels';
import { SettingGroup, SettingRow, Select } from '../controls';
import { useT } from '../../../i18n';
import { LOCALES } from '../../../i18n/locales';
import {useEffect,useState} from 'react';
import {runtime} from '../../../runtime/client';
import type {WebsiteLanguageStatus} from '../../../runtime/types';
import {SettingNote} from '../controls';

/** "en-US" -> "English (United States)", in the interface language; a tag the platform cannot name is shown as it is. */
const languageNames=(tags:string[])=>{try{const names=new Intl.DisplayNames([document.documentElement.lang||undefined].filter(Boolean) as string[],{type:'language',languageDisplay:'standard'});return tags.map(tag=>names.of(tag)||tag).join(', ');}catch{return tags.join(', ');}};

/** Settings › Languages: the interface language. "Same as Windows" (the default) follows the system display language. */
function LanguageSettings({ state, dispatch }: SettingsPanelProps) {
  const t = useT();
  const value = state.settings.language ?? 'system';
  const options = [{ value: 'system', label: t('language.system') }, ...LOCALES.map(locale => ({ value: locale.code as string, label: locale.native }))];
  const [web,setWeb]=useState<WebsiteLanguageStatus>(),[problem,setProblem]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{let alive=true;setWeb(undefined);setProblem('');runtime.service({type:'website-language.status'})
    .then(result=>{if(alive)setWeb(result.websiteLanguages);}).catch(error=>{if(alive)setProblem(String(error.message||error));});return()=>{alive=false;};},[state.activeBrowserProfileId]);
  const chooseWebsite=async(value:string)=>{setBusy(true);setProblem('');try{setWeb((await runtime.service({type:'website-language.set',languages:value==='system'?null:[value]})).websiteLanguages);}catch(error){setProblem(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
  const webOptions=[{value:'system',label:t('language.system')},...LOCALES.map(locale=>({value:locale.code==='en'?'en-US':locale.code,label:locale.native}))];
  const websiteValue=web?.choice?.[0]||'system';
  if(!webOptions.some(option=>option.value===websiteValue))webOptions.push({value:websiteValue,label:websiteValue});
  return (
    <SettingGroup title={t('language.title')} id="language-group">
      <SettingRow id="interface-language" title={t('language.title')} detail={t('language.detail')}>
        <Select value={value} label={t('language.title')} options={options} onChange={language => dispatch({ type: 'settings.update', patch: { language } })} />
      </SettingRow>
      <SettingRow id="website-language" title={t('language.websiteTitle')} detail={t('language.websiteDetail')} info={t('language.websiteHelp')}>
        <Select value={websiteValue} label={t('language.websiteTitle')} options={webOptions} disabled={!web||busy||web.privateMode||web.tor} onChange={value=>void chooseWebsite(value)}/>
      </SettingRow>
      {web && <SettingNote>{t('language.websiteCurrent',{languages:languageNames(web.visible??web.current)})}</SettingNote>}
      {web?.restartRequired && <SettingNote>{t('language.websiteRestart')}</SettingNote>}
      {(web?.privateMode||web?.tor) && <SettingNote>{t('language.websitePrivate')}</SettingNote>}
      {problem && <SettingNote>{problem}</SettingNote>}
    </SettingGroup>
  );
}

const panel: SettingsPanel = { section: 'Languages', icon: 'Globe2', order: 15, Component: LanguageSettings };
export default panel;
