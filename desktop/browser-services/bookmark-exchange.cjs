'use strict';
const {Parser}=require('htmlparser2');
const url=value=>{try{const parsed=new URL(value);return ['https:','http:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password?parsed.href:null;}catch{return null;}};
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

/** Parse Netscape bookmark HTML as inert data using maintained htmlparser2 (MIT). */
function parseBookmarkHTML(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>16*1024*1024)throw new Error('Bookmark HTML exceeds the 16MB import limit.');
 const root={children:[]},stack=[root];let capture=null,pending=null,count=0,skipped=0;
 const append=node=>{if(++count>50000)throw new Error('Bookmark file contains more than 50000 entries.');stack.at(-1).children.push(node);};
 const parser=new Parser({onopentag(name,attrs){if(name==='h3'||name==='a'){capture={tag:name,text:'',attrs};}else if(name==='dl'){if(stack.length>=64)throw new Error('Bookmark folders are nested too deeply.');stack.push(pending||stack.at(-1));pending=null;}},ontext(value){if(capture)capture.text+=value;},onclosetag(name){if(capture?.tag===name){const {text:label,attrs}=capture;capture=null;if(name==='h3'){pending={type:'folder',name:label.trim().slice(0,2048)||'Bookmarks',children:[]};append(pending);}else{const target=url(attrs.href);if(target)append({type:'url',name:label.trim().slice(0,2048)||new URL(target).hostname,url:target});else skipped++;}}else if(name==='dl'&&stack.length>1){stack.pop();pending=null;}}},{decodeEntities:true,lowerCaseTags:true,lowerCaseAttributeNames:true});
 parser.end(text);return {roots:{html:{name:'Imported bookmarks',children:root.children}},skipped};
}

function exportBookmarkHTML(nodes,profileId){
 const scoped=nodes.filter(n=>n.browserProfileId===profileId),ids=new Set(scoped.map(n=>n.id)),children=new Map(),seen=new Set();
 for(const node of scoped){const parent=ids.has(node.parentId)?node.parentId:null;if(!children.has(parent))children.set(parent,[]);children.get(parent).push(node);}
 const render=(parent,depth)=>{if(depth>64)return '';let text='';for(const node of (children.get(parent)||[]).sort((a,b)=>(a.position||0)-(b.position||0))){if(seen.has(node.id))continue;seen.add(node.id);const indent='    '.repeat(depth),target=node.url&&url(node.url);if(target)text+=`${indent}<DT><A HREF="${escape(target)}">${escape(node.title||target)}</A>\n`;else if(!node.url)text+=`${indent}<DT><H3>${escape(node.title||'Bookmarks')}</H3>\n${indent}<DL><p>\n${render(node.id,depth+1)}${indent}</DL><p>\n`;}return text;};
 const body=render(null,1);return '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Acira bookmarks</TITLE>\n<H1>Acira bookmarks</H1>\n<DL><p>\n'+body+'</DL><p>\n';
}
const exportSettings=['searchEngine','bookmarksBar','bookmarksOnNewTabOnly','appearance','style','glassOpacity','translucentOpacity','reducedMotion','reducedTransparency','toolbarLayout','verticalTabs','showHome','showTabOverview','addressSuggestions','interfaceScale','workspace'];
function exportAciraData(state,profileId,{history=false}={}){
 const profile=state.browserProfiles.find(p=>p.id===profileId);if(!profile||profile.private)throw new Error('Private browsing data cannot be exported.');
 const bookmarks=state.bookmarkNodes.filter(n=>n.browserProfileId===profileId).map(({id,parentId,title,url,position,createdAt})=>({id,parentId,title,...(url?{url}:{}),position,createdAt}));
 return {format:'acira-local-data',version:1,createdAt:new Date().toISOString(),profile:{name:profile.name},bookmarks,settings:Object.fromEntries(exportSettings.filter(k=>Object.hasOwn(state.settings,k)).map(k=>[k,state.settings[k]])),...(history?{history:state.browsingHistory.filter(v=>v.browserProfileId===profileId).map(({url,title,time})=>({url,title,time}))}:{})};
}
module.exports={parseBookmarkHTML,exportBookmarkHTML,exportAciraData};
