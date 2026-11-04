'use strict';
// Stock Electron (cookie encryption fuse off, as Acira's Windows builds were up to beta.9) writes one persistent cookie into an Acira profile's
// website session, the way beta.9 left sign-ins on disk: a plain row. qa/release-fused-cookies.mjs then reads it with the fused program.
const {app,session}=require('electron'),path=require('node:path');
const data=process.env.ACIRA_FUSED_COOKIE_DATA,partition=process.env.ACIRA_FUSED_COOKIE_PARTITION,url=process.env.ACIRA_FUSED_COOKIE_URL;
if(!data||!path.isAbsolute(data)||!partition||!url)process.exit(2);
app.setPath('userData',data);
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 let result;
 try{const ses=session.fromPartition(partition);await ses.cookies.set({url,name:'acira_stock',value:'set-by-stock-electron',expirationDate:Math.floor(Date.now()/1000)+3600});await ses.cookies.flushStore();result={ok:true,seen:(await ses.cookies.get({url})).map(cookie=>cookie.name)};}
 catch(error){result={ok:false,error:String(error&&error.message||error)};}
 process.stdout.write('STOCK '+JSON.stringify(result)+'\n');app.exit(0);
});
