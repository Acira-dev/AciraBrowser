import {useEffect,useState} from 'react';
import {runtime} from '../runtime/client';
import type {TabSession} from '../runtime/types';
import type {ExtensionToolbarTarget} from '../components/BrowserExtensionActions';

/**
 * What to show while the next answer is being asked (every tab switch and every address change asks again): the last answer of the same profile, as long as the tab is not an error page.
 * The hook used to answer null for that moment, which took the toolbar's buttons off the page and built them again from nothing at every switch (their icons blink: ui/extensionButtonList.ts),
 * and which the sidebar's row had to patch over with its own memory. Another profile, an error page or no tab at all never shows this one's buttons, not even for a moment.
 */
export function keepTarget(previous:ExtensionToolbarTarget|null,next:ExtensionToolbarTarget|null,tab:Pick<TabSession,'browserProfileId'|'error'>|null):ExtensionToolbarTarget|null{
 if(next)return next;
 if(!tab||tab.error||!previous||previous.profileId!==tab.browserProfileId)return null;
 return previous;
}

/**
 * D156 (14.3, a member's recording): main answers null for a website tab that is LOADING (main.cjs extensions.toolbar-target: its page gives no
 * target until the load ends). That null means "not yet", not "no extensions": settling on it emptied the sidebar's pinned row and the toolbar's
 * buttons for the length of every load, and the rows under the sidebar's row moved up by its height and back. A null answer for a loading tab
 * keeps the hook asking, so it goes on showing what it showed (keepTarget: the same profile, never an error page's); the loaded tab's answer
 * (asked again when `loading` turns false) replaces it. A loaded tab's null is honoured as before.
 */
export const holdsForLoad=(next:ExtensionToolbarTarget|null,tab:Pick<TabSession,'loading'|'error'>|null):boolean=>!next&&!!tab&&tab.loading===true&&!tab.error;

/** What the hook returns: the answer, or while the next one is asked (`asking`) the held one. */
export const shownTarget=(answer:ExtensionToolbarTarget|null,asking:boolean,tab:Pick<TabSession,'browserProfileId'|'error'>|null):ExtensionToolbarTarget|null=>asking?keepTarget(answer,null,tab):answer;

/**
 * The page the hidden sidebar's waiting list asks for (SidebarExtensionsWarm): the one it started with, as long as that page is open (it asks once, not at every tab switch and
 * navigation of a sidebar nobody sees); when that page is closed, the page that is active now (a closed page has no answer, and its answer would empty the remembered target); never an error page.
 */
export const warmTab=<T extends {id:string;error?:unknown}>(kept:T|null,active:T|null,open:readonly {id:string}[]):T|null=>kept&&open.some(page=>page.id===kept.id)?kept:(active&&!active.error?active:null);

/** This window's last answer, so a place that mounts (the sidebar when it is revealed) starts from it instead of from nothing. */
let latest:ExtensionToolbarTarget|null=null;
export const rememberedExtensionTarget=():ExtensionToolbarTarget|null=>latest;
export const forgetExtensionTarget=():void=>{latest=null;};

export function useExtensionToolbar(tab:TabSession|null){
 const [answer,setAnswer]=useState<ExtensionToolbarTarget|null>(latest),[asking,setAsking]=useState(true);
 useEffect(()=>{let alive=true,request=0;setAsking(true);if(!tab||tab.error){setAnswer(null);setAsking(false);return;}const settle=(next:ExtensionToolbarTarget|null)=>{if(holdsForLoad(next,tab))return;/* D156: still asking until the load ends */latest=next;setAnswer(next);setAsking(false);};const refresh=async()=>{const version=++request;try{const result=await runtime.service({type:'extensions.toolbar-target',tabId:tab.id});if(alive&&version===request)settle(result.extensionToolbar||null);}catch{if(alive&&version===request)settle(null);}};void refresh();const unsubscribe=runtime.subscribeBrowser(event=>{if(event.type==='extensions-changed'&&event.profileId===tab.browserProfileId)void refresh();});return()=>{alive=false;request++;unsubscribe();};},[tab?.id,tab?.url,tab?.browserProfileId,tab?.contentKind,tab?.error,tab?.loading]);
 return shownTarget(answer,asking,tab);
}
