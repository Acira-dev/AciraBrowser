import {useCallback,useEffect,useRef,useState} from 'react';
import {runtime} from '../runtime/client';
import type {TabSession} from '../runtime/types';
import type {ReaderState} from '../components/ReaderPane';
import {isWebsite} from '../runtime/newTabPage';

export function useReader(tab:TabSession){
 const [reader,setReader]=useState<ReaderState|null>(null),current=useRef(tab),active=useRef(reader),generation=useRef(0),mounted=useRef(true);current.current=tab;active.current=reader;
 const close=useCallback(()=>{generation.current++;active.current=null;setReader(null);},[]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
 const toggle=useCallback(async()=>{const source=current.current;if(!isWebsite(source)||source.error)return;if(active.current?.tabId===source.id){close();return;}const version=++generation.current,pending:ReaderState={tabId:source.id,url:source.url,profileId:source.browserProfileId};active.current=pending;setReader(pending);try{const result=await runtime.service({type:'reader.read',tabId:source.id});if(!mounted.current||version!==generation.current)return;const now=current.current;if(now.id!==source.id||now.url!==source.url||now.browserProfileId!==source.browserProfileId){close();return;}if(result.reader?.available&&result.reader.url===source.url&&result.reader.profileId===source.browserProfileId)setReader({...pending,article:result.reader});else setReader({...pending,error:result.reader&&!result.reader.available?result.reader.reason:'Reader could not prepare this article.'});}catch(error){if(mounted.current&&version===generation.current)setReader({...pending,error:error instanceof Error?error.message:'Reader could not prepare this article.'});}},[close]);
 useEffect(()=>{const opened=active.current;if(opened&&(opened.tabId!==tab.id||opened.url!==tab.url||opened.profileId!==tab.browserProfileId||tab.loading))close();},[tab.id,tab.url,tab.browserProfileId,tab.loading,close]);
 useEffect(()=>runtime.subscribeBrowser(event=>{if(event.type==='reader-invalidated'&&event.tabId===active.current?.tabId)close();if(event.type==='ui'&&event.action==='reader'&&(!event.targetTabId||event.targetTabId===current.current.id))void toggle();}),[toggle,close]);
 return {reader,toggle,close};
}
