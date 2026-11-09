import type { SearchEngine } from './types';

/** Local search providers and "!keyword query" shortcuts. The strict validator that guards settings updates lives in
 *  desktop/browser-services/search-providers.cjs; this module resolves input with the already-validated list. */
export interface SearchProvider{id:string;name:string;keyword:string;template:string}
export interface SearchProviders{defaultId:string;engines:SearchProvider[]}
export interface SearchResolution{url:string;query:string;engineId:string;bangUsed:boolean}

const MARKER='ACIRA_QUERY_PLACEHOLDER_73C9';
export const defaultSearchProviders=():SearchProviders=>({defaultId:'google',engines:[
  {id:'google',name:'Google',keyword:'g',template:'https://www.google.com/search?q=%s'},
  {id:'duckduckgo',name:'DuckDuckGo',keyword:'d',template:'https://duckduckgo.com/?q=%s'},
  {id:'bing',name:'Bing',keyword:'b',template:'https://www.bing.com/search?q=%s'},
  {id:'youtube',name:'YouTube',keyword:'yt',template:'https://www.youtube.com/results?search_query=%s'},
  {id:'gmail',name:'Gmail',keyword:'gm',template:'https://mail.google.com/mail/u/0/#search/%s'},
  {id:'wikipedia',name:'Wikipedia',keyword:'w',template:'https://en.wikipedia.org/wiki/Special:Search?search=%s'},
  {id:'wikipedia-full',name:'Wikipedia (full text)',keyword:'wiki',template:'https://en.wikipedia.org/w/index.php?fulltext=1&search=%s'},
  {id:'github',name:'GitHub',keyword:'gh',template:'https://github.com/search?q=%s'},
  {id:'stackoverflow',name:'Stack Overflow',keyword:'so',template:'https://stackoverflow.com/search?q=%s'},
  {id:'mdn',name:'MDN Web Docs',keyword:'mdn',template:'https://developer.mozilla.org/en-US/search?q=%s'},
  {id:'npm',name:'npm',keyword:'npm',template:'https://www.npmjs.com/search?q=%s'},
  {id:'reddit',name:'Reddit',keyword:'r',template:'https://www.reddit.com/search/?q=%s'},
  {id:'amazon',name:'Amazon',keyword:'a',template:'https://www.amazon.com/s?k=%s'},
  {id:'google-maps',name:'Google Maps',keyword:'maps',template:'https://www.google.com/maps/search/%s'},
  {id:'google-images',name:'Google Images',keyword:'img',template:'https://www.google.com/search?tbm=isch&q=%s'},
  {id:'google-news',name:'Google News',keyword:'news',template:'https://news.google.com/search?q=%s'},
  {id:'x',name:'X',keyword:'tw',template:'https://x.com/search?q=%s'},
  {id:'ecosia',name:'Ecosia',keyword:'ecosia',template:'https://www.ecosia.org/search?q=%s'},
  {id:'imdb',name:'IMDb',keyword:'imdb',template:'https://www.imdb.com/find/?q=%s'},
  {id:'google-translate',name:'Google Translate',keyword:'translate',template:'https://translate.google.com/?sl=auto&op=translate&text=%s'}]});
/** Ids of every engine in the stock list: Settings treats a list with other ids as customised. */
export const stockEngineIds=():string[]=>defaultSearchProviders().engines.map(engine=>engine.id);

/** Text with every lone surrogate half replaced by U+FFFD (what String.prototype.toWellFormed does): encodeURIComponent throws "URI malformed" on one, and a
 *  throw while the address list renders emptied the whole list (a long paste cut inside an emoji by the 4096-character limit leaves one). */
const wellFormed=(text:string)=>text.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,'\ufffd');
const encode=(query:string)=>encodeURIComponent(query).replace(/[!'()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase());

/** Providers to search with: the saved list, or the stock list with the legacy default engine selected. */
export function effectiveProviders(saved:SearchProviders|undefined,engine:SearchEngine):SearchProviders {
  if(Array.isArray(saved?.engines)&&saved!.engines.length&&saved!.engines.every(item=>typeof item?.template==='string'&&item.template.includes('%s')&&typeof item.id==='string')&&saved!.engines.some(item=>item.id===saved!.defaultId))return saved!;
  return {...defaultSearchProviders(),defaultId:engine};
}

/** Returns null when the text is not a usable search (empty after the shortcut or a bare "."/".." path segment). */
export function resolveSearch(input:string,providers:SearchProviders):SearchResolution|null {
  let query=wellFormed(input).trim().replace(/\s+/gu,' '),engine=providers.engines.find(item=>item.id===providers.defaultId)||providers.engines[0],bangUsed=false;
  const match=/^!([a-z0-9][a-z0-9_-]{0,23})(?:\s+(.*))?$/i.exec(query),selected=match&&providers.engines.find(item=>item.keyword&&item.keyword===match[1].toLowerCase());
  if(selected){engine=selected;query=match![2]||'';bangUsed=true;}
  if(!query||!engine)return null;
  if(['.','..'].includes(query)&&new URL(engine.template.replace('%s',MARKER)).pathname.split('/').includes(MARKER))return null;
  return {url:engine.template.replace('%s',encode(query)),query,engineId:engine.id,bangUsed};
}
