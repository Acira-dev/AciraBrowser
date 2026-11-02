'use strict';
const {ElectronChromeExtensions,setSessionPartitionResolver}=require('electron-chrome-extensions'),{fitExtensionAction}=require('./extension-action-sizing.cjs');
const attached=new WeakSet(),uiSessions=new WeakSet(),partitions=new Map();let resolverInstalled=false;
/** Trusted native adapter; renderer receives only a resolved target, never a session factory. */
function createExtensionToolbar({getContext,getProfiles,getSession,manager}){
 function profile(id){return getProfiles().find(p=>p.id===id&&!p.private&&typeof p.partition==='string'&&p.partition.startsWith('persist:'));}
 if(!resolverInstalled){setSessionPartitionResolver(partition=>{const record=partitions.get(partition);if(!record||!record.allowed())throw new Error('Unknown ordinary extension profile.');return record.session;});resolverInstalled=true;}
 function attach(profileId){const selected=profile(profileId);if(!selected)throw new Error('Select an ordinary extension profile.');manager.list(profileId);const session=getSession(selected.partition),runtime=ElectronChromeExtensions.fromSession(session);if(!runtime)throw new Error('The extension runtime is not initialized.');partitions.set(selected.partition,{session,allowed:()=>profile(profileId)?.partition===selected.partition});if(!attached.has(session)){runtime.on('browser-action-popup-created',fitExtensionAction);attached.add(session);}return session;}
 function target(wc){const disabled={supported:false,profileId:null,partition:null,webContentsId:null,pinnedIds:[],actionIds:[]};if(!wc||wc.isDestroyed())return disabled;const owner=getContext(wc),selected=owner&&profile(owner.profileId);if(!selected||owner.privateMode||owner.private||wc.session!==getSession(selected.partition)||!/^https?:\/\//i.test(wc.getURL()))return disabled;attach(selected.id);const loaded=manager.list(selected.id).extensions.filter(e=>e.enabled&&e.status==='loaded'&&e.hasAction);return {supported:true,profileId:selected.id,partition:selected.partition,webContentsId:wc.id,pinnedIds:loaded.filter(e=>e.pinned).map(e=>e.id),actionIds:loaded.map(e=>e.id)};}
 function installUI(session){if(!session||uiSessions.has(session))return;ElectronChromeExtensions.handleCRXProtocol(session);uiSessions.add(session);}
 /** The New Tab page and other acira:// pages are not extension tabs: show the pinned buttons for the profile with no specific tab (-1). */
 function profileTarget(profileId){const selected=profile(profileId);const disabled={supported:false,profileId:null,partition:null,webContentsId:null,pinnedIds:[],actionIds:[]};if(!selected)return disabled;attach(selected.id);const loaded=manager.list(selected.id).extensions.filter(e=>e.enabled&&e.status==='loaded'&&e.hasAction);return {supported:true,profileId:selected.id,partition:selected.partition,webContentsId:-1,pinnedIds:loaded.filter(e=>e.pinned).map(e=>e.id),actionIds:loaded.map(e=>e.id)};}
 return {attach,target,profileTarget,installUI};
}
module.exports={createExtensionToolbar};
