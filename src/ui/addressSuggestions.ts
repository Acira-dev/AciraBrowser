import { navigationTitle,resolveNavigation } from '../runtime/navigation';
import { siteIdentity } from '../runtime/sites';
import { effectiveProviders,resolveSearch } from '../runtime/searchProviders';
import type { BrowserAction,BrowserSnapshot,SearchEngine } from '../runtime/types';
import { bookmarksVisibleFrom,historyVisibleFrom,tabVisibleFrom } from './suggestionPrivacy';

import { t } from '../i18n';
import { answerFor } from './addressAnswers';
import { matchCommands,type AddressCommand } from './addressCommands';
export type AddressSuggestionKind='tab'|'bookmark'|'history'|'url'|'search'|'answer'|'command';
/** An `answer` row (a calculation, a conversion, the time in a city) has no address: choosing it copies `copy`. A `command` row runs the registry command `commandId`, with its shortcut in `keys`. */
export interface AddressSuggestion {id:string;kind:AddressSuggestionKind;title:string;url:string;detail:string;tabId?:string;historyId?:string;copy?:string;commandId?:string;keys?:string}
export const searchEngineName=(engine:SearchEngine)=>({google:'Google',duckduckgo:'DuckDuckGo',bing:'Bing'})[engine]||'Google';

function normalizedUrl(input:string):string|null{
 const target=resolveNavigation(input);
 return target.error||target.query?null:target.url;
}
export function addressDisplayUrl(url:string){return url.replace(/^https?:\/\//i,'').replace(/^www\./i,'').replace(/\/$/,'');}
function matchScore(query:string,title:string,url:string){
 if(!query)return 0;
 const text=title.toLocaleLowerCase(),address=addressDisplayUrl(url).toLocaleLowerCase(),full=url.toLocaleLowerCase();
 if(address===query||full===query)return 1500;
 if(address.startsWith(query)||full.startsWith(query))return 1200;
 if(text===query)return 1100;
 if(text.startsWith(query))return 950;
 const words=query.split(/\s+/).filter(Boolean),haystack=`${text} ${address}`;
 return words.every(word=>haystack.includes(word))?650:-1;
}

/** Pure local ranking. Profile-specific history never crosses browsing profiles, and no source crosses a privacy line
 * (`suggestionPrivacy.ts`): an ordinary tab never names a private, Tor or secured tab; a Tor tab reads nothing ordinary. */
export function rankAddressSuggestions(input:string,state:Pick<BrowserSnapshot,'tabs'|'activeTabId'|'activeBrowserProfileId'|'browsingHistory'|'bookmarks'|'settings'>&Partial<Pick<BrowserSnapshot,'websiteLanguage'|'browserProfiles'>>,limit=8,extras:{commands?:readonly AddressCommand[];now?:Date}={}):AddressSuggestion[]{
 const query=input.trim().slice(0,4096),normalized=query.toLocaleLowerCase(),current=state.tabs.find(tab=>tab.id===state.activeTabId),profile=current?.browserProfileId||state.activeBrowserProfileId;
 const viewer=current??{browserProfileId:profile},history=historyVisibleFrom(state,viewer,state.browsingHistory),bookmarks=bookmarksVisibleFrom(state,viewer)?state.bookmarks:[];
 const candidates=new Map<string,{item:AddressSuggestion;score:number;order:number}>();let order=0;
 const add=(kind:AddressSuggestionKind,url:string,title:string,bonus:number,detail:string,tabId?:string,historyId?:string)=>{
  const valid=normalizedUrl(url);if(!valid||valid==='acira://new')return;
  const score=matchScore(normalized,title,valid);if(score<0)return;
  const item:AddressSuggestion={id:`local:${valid}`,kind,title:title||navigationTitle(valid),url:valid,detail,...tabId?{tabId}:{},...historyId?{historyId}:{}};
  const previous=candidates.get(valid),candidate={item,score:score+bonus,order:order++};
  if(!previous||candidate.score>previous.score)candidates.set(valid,candidate);
 };
 state.tabs.forEach((tab,index)=>{if(tab.browserProfileId===profile&&tab.id!==state.activeTabId&&tabVisibleFrom(state,viewer,tab))add('tab',tab.url,tab.customTitle||tab.title,220-index,t('addresssuggestions.alreadyOpen'),tab.id);});
 const historyTitles=new Map<string,string>();for(const visit of history)if(visit.browserProfileId===profile&&!historyTitles.has(visit.url))historyTitles.set(visit.url,visit.title);
 bookmarks.forEach((url,index)=>add('bookmark',url,historyTitles.get(url)||siteIdentity(url).label,150-index,t('addresssuggestions.bookmark')));
 history.forEach((visit,index)=>{if(visit.browserProfileId===profile)add('history',visit.url,visit.title,100-Math.min(index,99),t('addresssuggestions.fromHistory'),undefined,visit.id);});
 const local=[...candidates.values()].sort((a,b)=>b.score-a.score||a.order-b.order).map(candidate=>candidate.item);
 if(!query)return local.slice(0,limit);
 // Enter takes the first row, so it is always what was typed (Chromium: the default match "can always be predicted").
 // Only an address the input visibly begins may come first; titles and mid-word matches never replace a search.
 const engine=current?.privacy==='tor'?'duckduckgo':state.settings.searchEngine;
 const providers=effectiveProviders(current?.privacy==='tor'?undefined:state.settings.searchProviders??undefined,engine);
 const target=resolveNavigation(query,engine,providers,state.websiteLanguage);
 let typed:AddressSuggestion|undefined;
 if(!target.error){
  if(target.query){const resolved=resolveSearch(query,providers),provider=providers.engines.find(item=>item.id===resolved?.engineId);typed={id:`search:${query}`,kind:'search',title:query,url:target.url,detail:t("addresssuggestions.searchEngine", { engine: provider?.name||searchEngineName(engine) })};}
  else typed=local.find(item=>item.url===target.url)??{id:`url:${target.url}`,kind:'url',title:addressDisplayUrl(target.url),url:target.url,detail:t("addresssuggestions.openAddress")};
 }
 const first=local.find(item=>item!==typed&&completesAddress(normalized,item.url))??(typed?.kind==='search'?knownSite(normalized,local):undefined);
 const ordered=[...first?[first]:[],...typed?[typed]:[],...local.filter(item=>item!==first&&item!==typed)];
 return withExtraRows(query,ordered,extras).slice(0,Math.max(1,limit));
}

/** The rows that are not places: an answer first (it is what was asked for), then the typed row Enter takes as ever, then matching commands, then the rest. Typing a URL or an ordinary search adds nothing, so Enter does what it always did. */
function withExtraRows(query:string,rows:AddressSuggestion[],extras:{commands?:readonly AddressCommand[];now?:Date}):AddressSuggestion[]{
 const answer=answerFor(query,extras.now?{now:extras.now}:{});
 const commands=matchCommands(query,extras.commands??[]);
 if(!answer&&!commands.length)return rows;
 const answerRow:AddressSuggestion[]=answer?[{id:'answer',kind:'answer',title:answer.value,url:'',detail:answer.detail,copy:answer.copy}]:[];
 const commandRows:AddressSuggestion[]=commands.map(command=>({id:`command:${command.id}`,kind:'command',title:command.name,url:'',detail:'',commandId:command.id,...command.shortcut?{keys:command.shortcut}:{}}));
 return [...answerRow,...rows.slice(0,1),...commandRows,...rows.slice(1)];
}

/** A typed prefix of a web address the profile already knows: "you" → youtube.com, "youtube.com/wat" → that page.
    Without a slash only site roots qualify, so "google" searches instead of reopening an old results page. */
function completesAddress(query:string,url:string){
 if(!/^https?:\/\//i.test(url)||query.length<3&&!query.includes('.'))return false;
 const display=addressDisplayUrl(url).toLocaleLowerCase();
 if(!display.startsWith(query))return false;
 if(query.includes('/'))return true;
 try{const parsed=new URL(url);return parsed.pathname==='/'&&!parsed.search&&!parsed.hash;}catch{return false;}
}

/** A site the profile knows only from inner pages (a fresh profile has watched videos, never opened the front page): "youtube" → youtube.com
    once any youtube.com page is in the rows this tab may see. Chromium offers the host's root the same way. Only a typed prefix of the host
    qualifies, so a title or a mid-word match still never replaces a search. */
function knownSite(query:string,local:AddressSuggestion[]):AddressSuggestion|undefined{
 if(/[\s/]/.test(query)||query.length<3&&!query.includes('.'))return undefined;
 // Several hosts can begin with the typed name: the one with the most pages the person can see wins, the first-ranked on a tie.
 const sites=new Map<string,number>();
 for(const item of local){
  if(!/^https?:\/\//i.test(item.url))continue;
  try{
   const parsed=new URL(item.url);
   if(!parsed.host.replace(/^www\./i,'').toLocaleLowerCase().startsWith(query))continue;
   const root=`${parsed.protocol}//${parsed.host}/`;
   sites.set(root,(sites.get(root)??0)+1);
  }catch{}
 }
 const root=[...sites].sort((x,y)=>y[1]-x[1])[0]?.[0];
 return root?{id:`url:${root}`,kind:'url',title:siteIdentity(root).label,url:root,detail:t('addresssuggestions.openAddress')}:undefined;
}

/** Opening a suggestion navigates the current tab. Reusing another tab is an explicit action. */
export function addressSuggestionAction(suggestion:AddressSuggestion,switchToTab=false,tabId?:string):BrowserAction {
 if(switchToTab&&suggestion.kind==='tab'&&suggestion.tabId)return {type:'tab.select',id:suggestion.tabId};
 return {type:'tab.navigate',url:suggestion.url,...tabId?{tabId}:{}};
}

/** Tab accepts a local completion without visiting it; Enter performs navigation. */
export function addressCompletion(query:string,suggestion:AddressSuggestion):string|null{
 if(suggestion.kind==='search'||suggestion.kind==='answer'||suggestion.kind==='command')return null;
 const value=addressDisplayUrl(suggestion.url),input=query.trim();
 // Only a visible prefix can be completed in place; anything else would replace the typed text.
 return input&&value.toLocaleLowerCase().startsWith(input.toLocaleLowerCase())&&value.length>input.length?value:null;
}

/** Focus alone never opens the list: only the person’s own draft on this tab does (arrow keys open it on purpose).
 * Reading the field’s DOM value here was the bug: a new tab can take focus in the same commit that switched to it,
 * while the field still shows the previous tab’s URL, and that opened every open tab as a “Switch to tab” list. */
export function opensSuggestionsOnFocus({enabled,draftTabId,tabId,draft}:{enabled:boolean;draftTabId:string|null;tabId:string;draft:string}){
 return enabled&&draftTabId===tabId&&draft.trim().length>0;
}
export function nextAddressSuggestion(index:number,key:'ArrowUp'|'ArrowDown',count:number){
 if(!count)return -1;
 return key==='ArrowDown'?(index+1+count)%count:index<=0?count-1:index-1;
}
