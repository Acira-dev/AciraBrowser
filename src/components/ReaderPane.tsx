import {useLayoutEffect,useRef,type MouseEvent} from 'react';
import {ArrowLeft,ExternalLink} from './AppIcons';
import '../styles/reader.css';

import type {ReaderArticle} from '../runtime/connectedServices';
import { t } from '../i18n';
export type {ReaderArticle} from '../runtime/connectedServices';
export type ReaderState={tabId:string;url:string;profileId:string;article?:ReaderArticle;error?:string};
export function ReaderPane({reader,onClose,onOpen}:{reader:ReaderState;onClose:()=>void;onOpen:(url:string,background:boolean)=>void}){
 const root=useRef<HTMLElement>(null);
 useLayoutEffect(()=>{
  const node=root.current,previous=document.activeElement;
  node?.focus({preventScroll:true});
  // Article completion must not steal focus from a control the reader chose.
  // Restore the launch control only while focus still belongs to this pane.
  return()=>{if(node?.contains(document.activeElement)&&previous instanceof HTMLElement&&previous.isConnected&&!previous.closest('[inert]'))previous.focus({preventScroll:true});};
 },[reader.tabId]);
 const link=(event:MouseEvent<HTMLElement>)=>{const anchor=(event.target as Element).closest('a[href]');if(!anchor)return;event.preventDefault();if(![0,1].includes(event.button))return;try{const url=new URL(anchor.getAttribute('href')!,reader.url);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)onOpen(url.href,event.button===1||event.ctrlKey||event.metaKey);}catch{}};
 return <section className="reader-pane" aria-label={t("readerpane.reader")} aria-busy={!reader.article&&!reader.error} ref={root} tabIndex={-1} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();onClose();}}}>
  <header className="reader-toolbar"><button type="button" onClick={onClose}><ArrowLeft size={16}/>{t("readerpane.backToPage")}</button><a href={reader.url} onClick={event=>{event.preventDefault();onClose();}}><span>{new URL(reader.url).hostname}</span><ExternalLink size={14}/></a></header>
  <div className="reader-scroll">
   {!reader.article&&!reader.error&&<p role="status">{t("readerpane.preparingReader")}</p>}
   {reader.error&&<div className="reader-unavailable"><h1>{t("readerpane.readerIsUnavailableForThis")}</h1><p role="status">{reader.error}</p><button type="button" className="btn" onClick={onClose}>{t("readerpane.backToPage")}</button></div>}
   {reader.article&&<article lang={reader.article.language||undefined} dir={reader.article.direction}><header><p className="reader-source">{reader.article.siteName||new URL(reader.url).hostname} · {t("readerpane.minRead", { minutes: reader.article.readingMinutes })}</p><h1>{reader.article.title}</h1>{reader.article.byline&&<p className="reader-byline">{reader.article.byline}</p>}</header><div className="reader-content" onClick={link} onAuxClick={link} dangerouslySetInnerHTML={{__html:reader.article.html}}/><footer>{t("readerpane.readerUsesALocalText")}</footer></article>}
  </div>
 </section>;
}
