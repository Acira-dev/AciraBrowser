import { carriesHttpsFirst,navigationTitle,resolveNavigation } from '../runtime/navigation';
import { siteIdentity } from '../runtime/sites';
import { effectiveProviders,resolveSearch,type SearchProviders } from '../runtime/searchProviders';
import { queryOfSearchUrl,SUGGEST_MAX_ROWS } from '../runtime/searchSuggest';
import type { BrowserAction,BrowserSnapshot,SearchEngine } from '../runtime/types';
import { bookmarksVisibleFrom,historyVisibleFrom,tabVisibleFrom } from './suggestionPrivacy';

import { t } from '../i18n';
import { answerFor } from './addressAnswers';
import { matchCommands,type AddressCommand } from './addressCommands';
export type AddressSuggestionKind='tab'|'bookmark'|'history'|'url'|'search'|'answer'|'command'|'suggestion';
/** A `suggestion` row (Beta 14) is a plain-text suggestion from the search engine the person chose: its `title` is the text, its `url` the default engine's search for it, its `detail` the service's name. It only ever comes after the person's own rows. An `answer` row (a calculation, a conversion, the time in a city) has no address: choosing it copies `copy`. A `command` row runs the registry command `commandId`, with its shortcut in `keys`. */
export interface AddressSuggestion {id:string;kind:AddressSuggestionKind;title:string;url:string;detail:string;tabId?:string;historyId?:string;copy?:string;commandId?:string;keys?:string}
/** The typed row is ONE row for as long as it means the same thing (a search, or an address that is none of the stored pages): its id does not carry the text. The id is the row's React key and its
 *  motion identity (ui/suggestionMotion.ts re-forms a row it has not placed), so an id that changed with every letter re-formed the whole row, the engine's name beside it too (blurred, faded in
 *  again), once per keystroke (a member's report, 14.4). Now the row's node stays and only its text changes; a row that changes place, or becomes another kind of row, still re-forms. */
export const TYPED_SEARCH_ID='typed:search',TYPED_URL_ID='typed:url';
export const searchEngineName=(engine:SearchEngine)=>({google:'Google',duckduckgo:'DuckDuckGo',bing:'Bing'})[engine]||'Google';

// Each address is resolved once, not at every keystroke (13.8: resolving every history visit again was about half of a 5000-visit ranking, which
// ran per keystroke in the interface and again in the suggestion list). The answer depends on the address alone (default engine, no providers).
const NORMALIZED_CACHE_LIMIT=20000;
const normalizedCache=new Map<string,string|null>();
/** How many addresses are remembered resolved (for tests: a ranking repeated over the same history resolves nothing again). */
export const normalizedAddressCount=():number=>normalizedCache.size;
export const NORMALIZED_ADDRESS_LIMIT=NORMALIZED_CACHE_LIMIT;
function normalizedUrl(input:string):string|null{
 const known=normalizedCache.get(input);if(known!==undefined)return known;
 const target=resolveNavigation(input),value=target.error||target.query?null:target.url;
 if(normalizedCache.size>=NORMALIZED_CACHE_LIMIT)normalizedCache.clear();
 normalizedCache.set(input,value);return value;
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

type BookmarkSource=Pick<BrowserSnapshot,'bookmarks'|'tabs'>&Partial<Pick<BrowserSnapshot,'browserProfiles'|'bookmarkNodes'>>;
export interface BookmarkEntry{url:string;title:string;/** The bookmark's other names for the same address, and the page's history title: they find the row without naming it. */alsoNamed:string[];/** Its place in the bookmark list. */index:number}
/** This profile's own ordinary bookmarks as the address field shows them (shared with Command search). 14.4 (a member's report): a bookmark row wears the bookmark's OWN name, then the page's history title, then the site's label. Two bookmarks on one site used to read the
 * same (the label, twice). The names come from this profile's own ordinary bookmarks, and only when the privacy rule lets bookmarks be shown at all (none from a Tor tab of an ordinary window). An address saved under two
 * names is one row (the list is keyed by address): the name that comes first in the bookmark list titles it, and the other names still find it. */
export function bookmarkEntries(state:BookmarkSource,viewer:Parameters<typeof bookmarksVisibleFrom>[1],profile:string,history:readonly {url:string;title:string;browserProfileId?:string}[]):BookmarkEntry[]{
 if(!bookmarksVisibleFrom(state,viewer)||!state.bookmarks.length)return [];
 const historyTitles=new Map<string,string>();for(const visit of history)if(visit.browserProfileId===profile&&!historyTitles.has(visit.url))historyTitles.set(visit.url,visit.title);
 const names=new Map<string,string[]>();
 for(const node of state.bookmarkNodes??[]){
  const name=node.title?.trim();if(!node.url||!name||node.tor||node.browserProfileId!==profile)continue;
  const known=names.get(node.url);if(!known)names.set(node.url,[name]);else if(!known.includes(name))known.push(name);
 }
 return state.bookmarks.map((url,index)=>{const own=names.get(url)??[],historyTitle=historyTitles.get(url);
  return {url,title:own[0]||historyTitle||siteIdentity(url).label,alsoNamed:[...own.slice(1),...historyTitle?[historyTitle]:[]],index};});
}
/** Command search (14.5): the bookmarks the address field would offer for this text, by the address field's own matching (exact and prefix addresses, whole names, every word found), best first. */
export function bookmarkMatches(input:string,state:BookmarkSource&Pick<BrowserSnapshot,'activeTabId'|'activeBrowserProfileId'|'browsingHistory'|'settings'>,limit=4):{url:string;title:string;score:number}[]{
 const normalized=input.trim().slice(0,4096).toLocaleLowerCase();if(!normalized)return [];
 const current=state.tabs.find(tab=>tab.id===state.activeTabId),profile=current?.browserProfileId||state.activeBrowserProfileId,viewer=current??{browserProfileId:profile};
 const found=new Map<string,{url:string;title:string;score:number;index:number}>();
 for(const entry of bookmarkEntries(state,viewer,profile,historyVisibleFrom(state,viewer,state.browsingHistory))){
  const valid=normalizedUrl(entry.url);if(!valid||valid==='acira://new')continue;
  const score=Math.max(matchScore(normalized,entry.title,valid),...entry.alsoNamed.map(text=>matchScore(normalized,text,valid)));if(score<0)continue;
  const known=found.get(valid);if(!known||score>known.score)found.set(valid,{url:valid,title:entry.title,score,index:entry.index});
 }
 return [...found.values()].sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,limit).map(({url,title,score})=>({url,title,score}));
}
/** Pure local ranking. Profile-specific history never crosses browsing profiles, and no source crosses a privacy line
 * (`suggestionPrivacy.ts`): an ordinary tab never names a private, Tor or secured tab; a Tor tab reads nothing ordinary. */
export function rankAddressSuggestions(input:string,state:Pick<BrowserSnapshot,'tabs'|'activeTabId'|'activeBrowserProfileId'|'browsingHistory'|'bookmarks'|'settings'>&Partial<Pick<BrowserSnapshot,'websiteLanguage'|'browserProfiles'|'bookmarkNodes'>>,limit=8,extras:{commands?:readonly AddressCommand[];now?:Date}={}):AddressSuggestion[]{
 const query=input.trim().slice(0,4096),normalized=query.toLocaleLowerCase(),current=state.tabs.find(tab=>tab.id===state.activeTabId),profile=current?.browserProfileId||state.activeBrowserProfileId;
 const viewer=current??{browserProfileId:profile},history=historyVisibleFrom(state,viewer,state.browsingHistory),bookmarks=bookmarksVisibleFrom(state,viewer)?state.bookmarks:[];
 const candidates=new Map<string,{item:AddressSuggestion;score:number;order:number}>();let order=0;
 const add=(kind:AddressSuggestionKind,url:string,title:string,bonus:number,detail:string,tabId?:string,historyId?:string,alsoMatching:readonly string[]=[])=>{
  const valid=normalizedUrl(url);if(!valid||valid==='acira://new')return;
  const score=Math.max(matchScore(normalized,title,valid),...alsoMatching.map(text=>matchScore(normalized,text,valid)));if(score<0)return;
  const item:AddressSuggestion={id:`local:${valid}`,kind,title:title||navigationTitle(valid),url:valid,detail,...tabId?{tabId}:{},...historyId?{historyId}:{}};
  const previous=candidates.get(valid),candidate={item,score:score+bonus,order:order++};
  if(!previous||candidate.score>previous.score)candidates.set(valid,candidate);
 };
 const alreadyOpen=t('addresssuggestions.alreadyOpen'),bookmarkLabel=t('addresssuggestions.bookmark'),fromHistory=t('addresssuggestions.fromHistory');
 state.tabs.forEach((tab,index)=>{if(tab.browserProfileId===profile&&tab.id!==state.activeTabId&&tabVisibleFrom(state,viewer,tab))add('tab',tab.url,tab.customTitle||tab.title,220-index,alreadyOpen,tab.id);});
 for(const entry of bookmarkEntries(state,viewer,profile,history))add('bookmark',entry.url,entry.title,150-entry.index,bookmarkLabel,undefined,undefined,entry.alsoNamed);
 history.forEach((visit,index)=>{if(visit.browserProfileId===profile)add('history',visit.url,visit.title,100-Math.min(index,99),fromHistory,undefined,visit.id);});
 const local=[...candidates.values()].sort((a,b)=>b.score-a.score||a.order-b.order).map(candidate=>candidate.item);
 if(!query)return local.slice(0,limit);
 // Enter takes the first row, so it is always what was typed (Chromium: the default match "can always be predicted").
 // Only an address the input visibly begins may come first; titles and mid-word matches never replace a search.
 const engine=current?.privacy==='tor'?'duckduckgo':state.settings.searchEngine;
 const providers=effectiveProviders(current?.privacy==='tor'?undefined:state.settings.searchProviders??undefined,engine);
 const target=resolveNavigation(query,engine,providers,state.websiteLanguage);
 let typed:AddressSuggestion|undefined;
 if(!target.error){
  if(target.query){const resolved=resolveSearch(query,providers),provider=providers.engines.find(item=>item.id===resolved?.engineId);typed={id:TYPED_SEARCH_ID,kind:'search',title:query,url:target.url,detail:t("addresssuggestions.searchEngine", { engine: provider?.name||searchEngineName(engine) })};}
  else typed=local.find(item=>item.url===target.url)??{id:TYPED_URL_ID,kind:'url',title:addressDisplayUrl(target.url),url:target.url,detail:t("addresssuggestions.openAddress")};
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
export function addressSuggestionAction(suggestion:AddressSuggestion,switchToTab=false,tabId?:string,typed?:string):BrowserAction {
 if(switchToTab&&suggestion.kind==='tab'&&suggestion.tabId)return {type:'tab.select',id:suggestion.tabId};
 // `typed` is the text in the field: a row that is its default https address carries that to the reducer (carriesHttpsFirst), so a failed secure connection may offer http.
 return {type:'tab.navigate',url:suggestion.url,...tabId?{tabId}:{},...typed!==undefined&&carriesHttpsFirst(resolveNavigation(typed),suggestion.url)?{httpsFirst:true}:{}};
}

/** What the search engine suggested for the typed text: the service's name and its plain-text suggestions (at most 5). */
export interface EngineSuggestions{name:string;items:readonly string[]}
/** The person's own rows first and unchanged, then the engine's suggestions as a group of their own (Beta 14): never above, never in between, so a row on screen never moves when one arrives.
 *  A suggestion the list already shows (a history row's title, the text of a search results page in history, the typed row) is not shown twice. Choosing one searches for it with the default engine. */
export function withEngineSuggestions(rows:AddressSuggestion[],engine:EngineSuggestions|null|undefined,providers:SearchProviders,typed:string):AddressSuggestion[]{
 if(!engine?.items.length)return rows;
 const shown=new Set<string>([typed.trim().replace(/\s+/g,' ').toLocaleLowerCase()]);
 for(const row of rows){
  shown.add(row.title.trim().toLocaleLowerCase());
  if(row.kind==='history'||row.kind==='bookmark'){const text=queryOfSearchUrl(row.url,providers);if(text)shown.add(text.replace(/\s+/g,' ').toLocaleLowerCase());}
 }
 const extra:AddressSuggestion[]=[];
 for(const text of engine.items){
  const key=text.trim().replace(/\s+/g,' ').toLocaleLowerCase();
  if(!key||shown.has(key))continue;
  const resolved=resolveSearch(text,providers);if(!resolved)continue;
  shown.add(key);extra.push({id:`engine:${text}`,kind:'suggestion',title:text,url:resolved.url,detail:engine.name});
  if(extra.length===SUGGEST_MAX_ROWS)break;
 }
 return extra.length?[...rows,...extra]:rows;
}

/** Tab accepts a local completion without visiting it; Enter performs navigation. A search engine's suggestion puts its own text in the bar for editing (Tab or Right arrow). */
export function addressCompletion(query:string,suggestion:AddressSuggestion):string|null{
 if(suggestion.kind==='suggestion')return suggestion.title;
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
