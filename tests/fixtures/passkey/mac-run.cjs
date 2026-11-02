'use strict';
// Isolated HTTPS test origin and synthetic authenticator. This exercises real
// sandbox/contextBridge/IPC plumbing; it is never evidence of Apple approval.
const {app,BrowserWindow,session,ipcMain}=require('electron');
const path=require('node:path'),os=require('node:os');
const {createMacPasskeys,nativeBridge}=require('../../../desktop/browser-services/mac-passkeys.cjs');
const {result}=require('./records.cjs');
app.setPath('userData',path.join(os.tmpdir(),'acira-mac-passkeys-'+process.pid));
app.on('window-all-closed',()=>{});
process.on('unhandledRejection',error=>{process.stdout.write('ERROR '+error.stack+'\n');app.exit(1);});
app.whenReady().then(async()=>{
 const real=nativeBridge().support();let simulated=false;const calls=[];
 const service=createMacPasskeys({ipcMain,native:{support:()=>simulated?{available:true}:real,start:async(_handle,input)=>{calls.push(input.operation);return result(input);},cancel:()=>{}}});
 const out={realSupport:real,simulatedAuthenticator:true};
 for(const phase of ['disabled','enabled']){
  simulated=phase==='enabled';
  const ses=session.fromPartition('mac-passkey-'+phase+'-'+process.pid);
  ses.protocol.handle('https',request=>new Response(new URL(request.url).pathname==='/frame'?'<title>Frame</title>':'<!doctype html><title>Passkey fixture</title><iframe src="https://passkey.test/frame"></iframe>',{headers:{'content-type':'text/html'}}));
  ses.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'native-preload.cjs')});
  ses.registerPreloadScript({type:'frame',filePath:path.join(__dirname,'../../../desktop/browser-services/mac-passkey-preload.cjs')});
  const win=new BrowserWindow({show:false,webPreferences:{session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:true}});
  // Synthetic focused owner; no real OS UI is requested in this fixture.
  service.attach(win.webContents,()=>({active:true,window:{isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false,isFocused:()=>true,getNativeWindowHandle:()=>Buffer.alloc(8)}}));
  await win.loadURL('https://passkey.test/');
  if(phase==='disabled')out.disabled=await win.webContents.executeJavaScript(`({secure:isSecureContext,unchanged:CredentialsContainer.prototype.get===window.__nativePasskeyBaseline.get,nodeExposed:typeof require!=='undefined'||typeof process!=='undefined'})`);
  else out.enabled=await win.webContents.executeJavaScript(`(async()=>{
   const a=await navigator.credentials.get({publicKey:{challenge:new Uint8Array([1,2,3]),rpId:'passkey.test',userVerification:'required'}});
   const c=await navigator.credentials.create({publicKey:{challenge:new Uint8Array([4]),rp:{id:'passkey.test',name:'Fixture'},user:{id:new Uint8Array([5]),name:'Fixture',displayName:'Fixture'},pubKeyCredParams:[{type:'public-key',alg:-7}]}});
   return {secure:isSecureContext,assertion:a instanceof PublicKeyCredential&&a.response instanceof AuthenticatorAssertionResponse,registration:c instanceof PublicKeyCredential&&c.response instanceof AuthenticatorAttestationResponse,algorithm:c.response.getPublicKeyAlgorithm(),client:JSON.parse(new TextDecoder().decode(a.response.clientDataJSON)),conditional:await PublicKeyCredential.isConditionalMediationAvailable(),nodeExposed:typeof require!=='undefined'||typeof process!=='undefined',bridgeExposed:typeof window.__aciraNativePasskeys!=='undefined'};
  })()`);
  win.destroy();
 }
 out.calls=calls;process.stdout.write('RESULT '+JSON.stringify(out)+'\n');app.exit(0);
});
