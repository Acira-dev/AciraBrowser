import {useSyncExternalStore} from 'react';
import museum from '../../public/artwork/catalog-v2/catalog.json';
import type {PersonalArtwork} from '../runtime/connectedServices';
import {cleanPicks,dailyStride,dayNumber,hashText,type ArtworkRotation} from './artworkPicks';

export const newTabModules={workspace:'Workspace header',artwork:'Artwork',name:'Profile name',mark:'Acira mark',search:'Search',shortcuts:'Shortcuts',saved:'Bookmarks',recent:'Recent pages'} as const;
export type NewTabModule=keyof typeof newTabModules;
export type Shortcut={id:string;title:string;url:string;start:boolean;sidebar:boolean};
/** How the painting is shown: a framed image on a calm page, or as the page background. */
export const artStyles={framed:'Framed',full:'Full background'} as const;
export type ArtStyle=keyof typeof artStyles;
export type NewTabPreferences={version:string;modules:Record<NewTabModule,boolean>;artwork:string;artStyle:ArtStyle;daily:boolean;/** A different painting on every new tab. */perTab:boolean;/** A different painting each hour. */hourly:boolean;/** Where the painting comes from: the built-in paintings, or an open collection fetched only when a new tab is shown. */collection:'built-in'|'landscapes'|'nature'|'space'|'architecture';/** Stable manual photo choice across tabs and restarts. */collectionSeed:string;/** The previous remote image, excluded from this manual choice when alternatives exist. */collectionExcludeId:string;/** What a rotating picture (every tab, hour or day) uses: every picture (today's behaviour), or only the pictures the person ticked. Nothing ticked behaves as every picture (artworkPicks.ts). */rotation:ArtworkRotation;/** The pictures the person ticked: built-in painting ids, `personal:<id>` for their own images, `<collection>:<id>` for collection pictures they have seen. */picks:string[];/** 14.1: the person's own pictures in the rotation: only them ("Your images" is the collection), mixed in with the collection, or not (today's way). ownImages.ts. */ownImages:'off'|'mixed'|'only';/** 14.4 live wallpaper: the profile's own video shows where the picture is (ui/liveWallpaper.ts). */ownVideo:boolean;/** 14.4: the video may play on battery (off by default; never a file the engine cannot decode efficiently). */videoOnBattery:boolean;/** The title, artist and year under the painting. */caption:boolean;frequent:boolean;shortcuts:Shortcut[]};
export interface CatalogArtwork{thumb?:string;objectPosition?:string;averageColor?:string;width?:number;height?:number;id:string;name:string;src:string;alt:string;artist?:string;date?:string;provider?:string;rights?:string;source?:string;position?:string}
/** Paintings wider than this are served as an on-device 1760px rendition in the framed view (see desktop/artwork-renditions.cjs). */
const renditionWidth=1760;
const withRendition=(item:CatalogArtwork):CatalogArtwork=>item.src.startsWith('/artwork/catalog-v2/')&&(item.width??0)>renditionWidth?{...item,thumb:`/artwork-r/${item.id}.jpg`}:item;
export const artworkCatalog:CatalogArtwork[]=[...(museum.paintings as CatalogArtwork[]).map(withRendition),{id:'dunes',name:'Quiet dunes',src:'/artwork/dunes.svg',alt:'Acira illustration of sunlit dunes'},{id:'peaks',name:'Evening peaks',src:'/artwork/peaks.svg',alt:'Acira illustration of mountain peaks at dusk'},
 {id:'windmill',name:'Windmill meadow',src:'/workspace-covers/windmill.webp',alt:'Windmill above a meadow',position:'50% 35%'},
 {id:'countryside',name:'Country lanes',src:'/workspace-covers/countryside.webp',alt:'Quiet countryside',position:'50% 50%'},
 {id:'wildflowers',name:'Wildflower lake',src:'/workspace-covers/wildflowers.webp',alt:'Wildflowers beside a lake',position:'50% 50%'},
 {id:'orchard',name:'Blossom orchard',src:'/workspace-covers/orchard.webp',alt:'Orchard in blossom',position:'50% 50%'},
 {id:'sea',name:'Sea breeze',src:'/workspace-covers/sea.webp',alt:'Coastal scene',position:'50% 55%'},
 {id:'garden',name:'Walled garden',src:'/workspace-covers/garden.webp',alt:'Sunlit walled garden',position:'50% 55%'},
];
export type WorkspaceArtwork=CatalogArtwork;
export const defaultArtwork=artworkCatalog[0].id;
const dailyArtwork=artworkCatalog.filter(item=>item.src.startsWith('/artwork/catalog-v2/'));
/** The painting after `currentId` in catalog order, wrapping at the end. Anything that is not a catalog painting (an illustration, a personal image) steps to the first one. `Change` uses it as a manual choice. */
export function nextPainting(currentId:string,items:CatalogArtwork[]=dailyArtwork):CatalogArtwork{const index=items.findIndex(item=>item.id===currentId);return items[(index+1)%items.length];}
/** A random painting of the collection other than `currentId` (a shuffle never lands on what is showing). `random` is injectable for tests. */
export function randomPainting(currentId:string,random:()=>number=Math.random,items:CatalogArtwork[]=dailyArtwork):CatalogArtwork{const pool=items.filter(item=>item.id!==currentId);return pool[Math.min(pool.length-1,Math.floor(random()*pool.length))];}
/** The painting for a local calendar day: identical all day, whatever the time or what is being typed. */
export function dailyArtworkFor(profile:string,date:Date,items:CatalogArtwork[]=dailyArtwork):CatalogArtwork{return items[(dayNumber(date)*dailyStride(items.length)+hashText(profile))%items.length];}
const personalId=/^personal:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const prefix='acira-new-tab:',listeners=new Set<()=>void>(),cache=new Map<string,{raw:string|null;value:NewTabPreferences}>(),temporary=new Map<string,NewTabPreferences>();
const defaults=():NewTabPreferences=>({version:'initial',modules:{workspace:true,artwork:true,name:false,mark:false,search:true,shortcuts:false,saved:true,recent:true},artwork:defaultArtwork,artStyle:'framed',daily:false,perTab:false,hourly:false,collection:'built-in',collectionSeed:'0',collectionExcludeId:'',rotation:'all',picks:[],ownImages:'off',ownVideo:false,videoOnBattery:false,caption:true,frequent:false,shortcuts:[]});
export function shortcutURL(value:string){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!/[\u0000-\u0020]/.test(value)&&value.length<=4096?url.href:null;}catch{return null;}}
function normalize(input:unknown):NewTabPreferences{
 const next=defaults();if(!input||typeof input!=='object')return next;const raw=input as Partial<NewTabPreferences>;
 for(const key of Object.keys(next.modules) as NewTabModule[])if(typeof raw.modules?.[key]==='boolean')next.modules[key]=raw.modules[key];
 if(typeof raw.artwork==='string'&&(raw.artwork==='coast'||personalId.test(raw.artwork)||artworkCatalog.some(item=>item.id===raw.artwork)))next.artwork=raw.artwork;
 next.artStyle=raw.artStyle==='full'?'full':'framed';next.daily=raw.daily===true;next.perTab=raw.perTab===true;next.hourly=raw.hourly===true;next.collection=(['landscapes','nature','space','architecture'] as const).find(id=>id===((raw.collection as string)==='nasa'?'space':raw.collection))??'built-in';if(typeof raw.collectionSeed==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(raw.collectionSeed))next.collectionSeed=raw.collectionSeed;if(typeof raw.collectionExcludeId==='string'&&raw.collectionExcludeId.length===next.collection.length+13&&new RegExp('^'+next.collection+':[a-f0-9]{12}$').test(raw.collectionExcludeId))next.collectionExcludeId=raw.collectionExcludeId;next.rotation=raw.rotation==='picks'?'picks':'all';/* 14.1: a saved own picture (before ownImages existed) is "Your images" with that picture: exactly what it showed */next.ownImages=raw.ownImages==='mixed'||raw.ownImages==='only'?raw.ownImages:personalId.test(next.artwork)?'only':'off';next.ownVideo=raw.ownVideo===true;next.videoOnBattery=raw.videoOnBattery===true;next.picks=cleanPicks(raw.picks,id=>artworkCatalog.some(item=>item.id===id));next.caption=raw.caption!==false;next.frequent=raw.frequent===true;if(typeof raw.version==='string')next.version=raw.version.slice(0,80);
 if(Array.isArray(raw.shortcuts)){const ids=new Set<string>();for(const item of raw.shortcuts.slice(0,12)){if(!item||typeof item!=='object'||typeof item.id!=='string'||typeof item.title!=='string'||typeof item.url!=='string')continue;const url=shortcutURL(item.url);if(!url||ids.has(item.id)||!item.title.trim())continue;ids.add(item.id);next.shortcuts.push({id:item.id.slice(0,80),title:item.title.trim().slice(0,80),url,start:item.start!==false,sidebar:item.sidebar===true});}}
 return next;
}
const key=(profile:string,privateMode:boolean)=>(privateMode?'private:':'normal:')+profile;
export function readNewTabPreferences(profile:string,privateMode=false):NewTabPreferences{
 const id=key(profile,privateMode);if(temporary.has(id))return temporary.get(id)!;
 let raw:string|null=null;try{if(!privateMode)raw=localStorage.getItem(prefix+profile);}catch{}
 const saved=cache.get(id);if(saved&&saved.raw===raw)return saved.value;
 let value=defaults();try{value=normalize(raw?JSON.parse(raw):null);if(!raw&&!privateMode&&localStorage.getItem('acira-study-cover:'+profile)==='hidden')value.modules.artwork=false;}catch{}
 cache.set(id,{raw,value});return value;
}
export function updateNewTabPreferences(profile:string,patch:Partial<NewTabPreferences>,privateMode=false){
 const previous=readNewTabPreferences(profile,privateMode),value=normalize({...previous,...patch,version:crypto.randomUUID()}),id=key(profile,privateMode);
 if(privateMode)temporary.set(id,value);else try{const raw=JSON.stringify(value);localStorage.setItem(prefix+profile,raw);temporary.delete(id);cache.set(id,{raw,value});}catch{temporary.set(id,value);}
 listeners.forEach(listener=>listener());return value;
}
function subscribe(listener:()=>void){listeners.add(listener);const storage=(event:StorageEvent)=>{if(event.key?.startsWith(prefix))listener();};window.addEventListener('storage',storage);return()=>{listeners.delete(listener);window.removeEventListener('storage',storage);};}
export function useNewTabPreferences(profile:string,privateMode=false){const value=useSyncExternalStore(subscribe,()=>readNewTabPreferences(profile,privateMode));return [value,(patch:Partial<NewTabPreferences>)=>updateNewTabPreferences(profile,patch,privateMode)] as const;}
export type ArtworkUndo={profile:string;privateMode:boolean;version:string};
export function hideWorkspaceArtwork(profile:string,privateMode=false){const previous=readNewTabPreferences(profile,privateMode);if(!previous.modules.artwork)return;const next=updateNewTabPreferences(profile,{modules:{...previous.modules,artwork:false}},privateMode),undo:ArtworkUndo={profile,privateMode,version:next.version};window.dispatchEvent(new CustomEvent('acira:artwork-hidden',{detail:undo}));}
export function undoWorkspaceArtwork(undo:ArtworkUndo,activeProfile:string){const current=readNewTabPreferences(undo.profile,undo.privateMode);if(activeProfile!==undo.profile||current.version!==undo.version||current.modules.artwork)return false;updateNewTabPreferences(undo.profile,{modules:{...current.modules,artwork:true}},undo.privateMode);return true;}
export function selectedArtwork(preferences:NewTabPreferences,profile:string,date=new Date(),personal:PersonalArtwork[]=[],seed?:string):CatalogArtwork{if(preferences.hourly){const pool:CatalogArtwork[]=[...artworkCatalog,...personal.map(own=>({id:'personal:'+own.id,name:own.name,src:own.url,alt:'Personal new-tab image'}))];let h=0;for(const ch of profile+date.toISOString().slice(0,13))h=(h*31+ch.charCodeAt(0))>>>0;return pool[h%pool.length];}if(preferences.perTab&&seed){const pool:CatalogArtwork[]=[...artworkCatalog,...personal.map(own=>({id:'personal:'+own.id,name:own.name,src:own.url,alt:'Personal new-tab image'}))];let h=0;for(const ch of seed)h=(h*31+ch.charCodeAt(0))>>>0;return pool[h%pool.length];}if(!preferences.daily){if(preferences.artwork==='coast')return artworkCatalog[0];const own=personal.find(item=>'personal:'+item.id===preferences.artwork);if(own)return{id:preferences.artwork,name:own.name,src:own.url,alt:'Personal new-tab image'};return artworkCatalog.find(item=>item.id===preferences.artwork)??artworkCatalog[0];}return dailyArtworkFor(profile,date);}
