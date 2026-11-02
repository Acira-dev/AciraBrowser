'use strict';
const fs=require('node:fs'),path=require('node:path');
// Unmodified pinned sources and full licenses are retained under vendor/.
const readability=fs.readFileSync(path.join(__dirname,'vendor/readability/Readability.js'),'utf8');
const purify=fs.readFileSync(path.join(__dirname,'vendor/dompurify/purify.min.js'),'utf8');
const WORLD=998;
function pageURL(value){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}}
function createReader({getContext}){
 const pending=new Set(),generations=new WeakMap();
 function current(wc){if(!wc||wc.isDestroyed())throw new Error('This website tab is no longer available.');const owner=getContext(wc),url=pageURL(wc.getURL());if(!owner||typeof owner.profileId!=='string'||!url)throw new Error('Open an ordinary website article first.');return {profileId:owner.profileId,tabId:owner.tabId,url,private:!!(owner.privateMode||owner.private),session:wc.session};}
 function track(wc){if(generations.has(wc))return;generations.set(wc,0);wc.on('did-start-navigation',(_e,_url,_inPlace,main)=>{if(main)generations.set(wc,(generations.get(wc)||0)+1);});}
 async function read(wc){
  const c=current(wc);track(wc);if(pending.has(wc))throw new Error('An article is already being prepared for this tab.');pending.add(wc);const generation=generations.get(wc);
  try{
   const result=await wc.executeJavaScriptInIsolatedWorld(WORLD,[{code:`(function(){${readability}\n${purify}\nreturn (${extractArticle.toString()})();})()`}],false);
   const now=current(wc);if(now.profileId!==c.profileId||now.tabId!==c.tabId||now.url!==c.url||now.session!==c.session||generations.get(wc)!==generation)throw new Error('The website changed before Reader finished. Try again on the article.');
   if(!result?.available)return {available:false,reason:result?.reason||'An article could not be extracted from this page.'};
   return {...result,url:c.url,profileId:c.profileId,private:c.private};
  }finally{pending.delete(wc);}
 }
 return {read};
}
// Runs in an isolated world with the engine DOM, no Node, IPC or page-defined globals.
// Parse only a clone; sanitized output has no images, frames, forms or remote resources.
function extractArticle(){
 const maxNodes=50000,maxText=1000000,maxHTML=1500000;
 if(!document.body)return {available:false,reason:'Wait for the article to finish loading.'};
 const walker=document.createTreeWalker(document.documentElement,NodeFilter.SHOW_ELEMENT);let count=0;while(walker.nextNode())if(++count>maxNodes)return {available:false,reason:'This page is too large for Reader.'};
 if(document.body.textContent.length>maxText)return {available:false,reason:'This page is too large for Reader.'};
 const clone=document.cloneNode(true);
 for(const node of clone.querySelectorAll('script,style,noscript,template,iframe,frame,object,embed,form,input,button,textarea,select,video,audio,canvas,svg,math,[hidden],[aria-hidden="true"],[data-acira-filter-control]'))node.remove();
 for(const node of clone.querySelectorAll('[style]'))if(node.style.display==='none'||node.style.visibility==='hidden')node.remove();
 const article=new Readability(clone,{maxElemsToParse:maxNodes,charThreshold:300,keepClasses:false,disableJSONLD:true}).parse();
 if(!article||article.length<200||!article.content||article.content.length>maxHTML)return {available:false,reason:'Reader could not find a supported article on this page.'};
 const fragment=DOMPurify.sanitize(article.content,{RETURN_DOM_FRAGMENT:true,ALLOWED_TAGS:['article','section','div','p','h1','h2','h3','h4','h5','h6','a','em','strong','b','i','u','s','del','blockquote','pre','code','ul','ol','li','dl','dt','dd','br','hr','table','thead','tbody','tfoot','tr','th','td','caption','sup','sub','figure','figcaption','span','time'],ALLOWED_ATTR:['href','title','lang','dir','colspan','rowspan','start','datetime'],ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false,FORBID_TAGS:['style','script','svg','math','template'],SANITIZE_NAMED_PROPS:true});
 for(const link of fragment.querySelectorAll('a')){try{const url=new URL(link.getAttribute('href'),document.URL);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Unsupported link');link.setAttribute('href',url.href);link.setAttribute('rel','noreferrer noopener');}catch{link.removeAttribute('href');}}
 const container=document.createElement('div');container.append(fragment);const text=container.textContent.trim();if(text.length<200)return {available:false,reason:'Reader could not find enough article text on this page.'};
 const clean=(value,length)=>String(value||'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').slice(0,length);
 return {available:true,title:clean(article.title||document.title,512),byline:clean(article.byline,256),excerpt:clean(article.excerpt,512),siteName:clean(article.siteName,256),language:clean(article.lang||document.documentElement.lang,35),direction:article.dir==='rtl'?'rtl':'ltr',html:container.innerHTML,text:clean(text,maxText),length:text.length,readingMinutes:Math.max(1,Math.ceil(text.split(/\s+/u).length/220)),imagesIncluded:false};
}
module.exports={createReader,pageURL};
