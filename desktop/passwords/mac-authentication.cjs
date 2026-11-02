'use strict';
const path=require('node:path');
function createMacAuthentication({load=()=>require(path.join(__dirname,'..','native','build','mac-material.node'))}={}){
 let native;
 return {async verify(reason){
  try{
   native??=load();
   if(native.authenticationAvailable()!==true)return {ok:false,code:'unavailable'};
   const result=await native.authenticate(reason);
   if(result?.ok===true&&result.code==='verified')return {ok:true,method:'device-owner'};
   return {ok:false,code:result?.ok===false&&['cancelled','failed','timeout','unavailable'].includes(result.code)?result.code:'failed'};
  }catch{return {ok:false,code:'unavailable'};}
 }};
}
module.exports={createMacAuthentication};
