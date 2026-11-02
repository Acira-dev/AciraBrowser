import {useSyncExternalStore} from 'react';
import {pageKey} from '../features/libraryModel';

type Arrival={url:string;profileId:string};
let arrival:Arrival|null=null;
const listeners=new Set<()=>void>();
const emit=()=>listeners.forEach(listener=>listener());
/** A saved row reserves its real list slot while the copied material travels into it. */
export function beginBookmarkArrival(url:string,profileId:string){const token={url:pageKey(url),profileId};arrival=token;emit();return()=>{if(arrival===token){arrival=null;emit();}};}
export function useBookmarkArrival(profileId:string){return useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},()=>arrival?.profileId===profileId?arrival:null);}
