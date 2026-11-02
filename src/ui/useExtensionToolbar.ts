import {useEffect,useState} from 'react';
import {runtime} from '../runtime/client';
import type {TabSession} from '../runtime/types';
import type {ExtensionToolbarTarget} from '../components/BrowserExtensionActions';

export function useExtensionToolbar(tab:TabSession|null){
 const [target,setTarget]=useState<ExtensionToolbarTarget|null>(null);
 useEffect(()=>{let alive=true,request=0;setTarget(null);if(!tab||tab.error)return;const refresh=async()=>{const version=++request;try{const result=await runtime.service({type:'extensions.toolbar-target',tabId:tab.id});if(alive&&version===request)setTarget(result.extensionToolbar||null);}catch{if(alive&&version===request)setTarget(null);}};void refresh();const unsubscribe=runtime.subscribeBrowser(event=>{if(event.type==='extensions-changed'&&event.profileId===tab.browserProfileId)void refresh();});return()=>{alive=false;request++;unsubscribe();};},[tab?.id,tab?.url,tab?.browserProfileId,tab?.contentKind,tab?.error,tab?.loading]);
 return target;
}
