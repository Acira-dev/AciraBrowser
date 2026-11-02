'use strict';
// Frame and document identity for chrome.webNavigation and chrome.webRequest (P5), as Chrome's ExtensionApiFrameIdMap gives them:
//  - frameId: 0 for a page's main frame, the frame tree node id for any other frame, -1 when a request has no frame (workers);
//  - parentFrameId: the parent's frameId, -1 for a main frame;
//  - documentId: 32 upper-case hex characters, a new one each time a frame commits a new document (cross-document navigation);
//  - frameType 'outermost_frame' | 'sub_frame', documentLifecycle 'active'.
// One registry per session (Symbol.for('acira.ext-documents-v1')) so both packages hand out the same documentId for the same document.
const crypto=require('node:crypto');
const DOCUMENTS=Symbol.for('acira.ext-documents-v1');
const read=(fn,fallback)=>{try{const value=fn();return value===undefined?fallback:value;}catch{return fallback;}};

function frameIdOf(frame){if(!frame)return -1;return read(()=>(frame.parent?frame.frameTreeNodeId:0),-1);}
function parentFrameIdOf(frame){const parent=read(()=>frame?.parent,null);return parent?frameIdOf(parent):-1;}
const frameTypeOf=frame=>(read(()=>frame?.parent,null)?'sub_frame':'outermost_frame');
const newDocumentId=()=>crypto.randomBytes(16).toString('hex').toUpperCase();
const DOCUMENT_ID=/^[0-9A-F]{32}$/;

function documentsFor(session){
 if(session&&session[DOCUMENTS])return session[DOCUMENTS];
 const byFrame=new WeakMap(),byId=new Map();
 const remember=(frame,id)=>{byFrame.set(frame,id);byId.set(id,new WeakRef(frame));if(byId.size>20000)for(const [key,ref] of byId){const found=ref.deref();if(!found||read(()=>found.isDestroyed?.(),false)||byFrame.get(found)!==key)byId.delete(key);if(byId.size<=10000)break;}return id;};
 const registry={
  /** The current document of a frame (assigned on first sight; replaced by commit()). */
  idOf(frame){if(!frame)return undefined;const known=byFrame.get(frame);return known||remember(frame,newDocumentId());},
  /** A frame committed a new document: it gets a new documentId. */
  commit(frame){if(!frame)return undefined;const old=byFrame.get(frame);if(old)byId.delete(old);return remember(frame,newDocumentId());},
  /** The live frame that holds this document, or null. */
  frameOf(id){const frame=byId.get(String(id).toUpperCase())?.deref();if(!frame||read(()=>frame.isDestroyed?.(),false)||byFrame.get(frame)!==String(id).toUpperCase())return null;return frame;},
  isDocumentId:value=>typeof value==='string'&&DOCUMENT_ID.test(value)
 };
 if(session)try{Object.defineProperty(session,DOCUMENTS,{value:registry,configurable:true});}catch{}
 return registry;
}

/** Chrome's frame fields for one frame: {frameId, parentFrameId, documentId, parentDocumentId?, frameType, documentLifecycle}. */
function frameFields(docs,frame,{document=true}={}){
 const parent=read(()=>frame.parent,null);
 return {frameId:frameIdOf(frame),parentFrameId:parent?frameIdOf(parent):-1,...(document?{documentId:docs.idOf(frame)}:{}),
  ...(parent?{parentDocumentId:docs.idOf(parent)}:{}),frameType:parent?'sub_frame':'outermost_frame',documentLifecycle:'active'};
}

module.exports={documentsFor,frameIdOf,parentFrameIdOf,frameTypeOf,frameFields,read,DOCUMENTS};
