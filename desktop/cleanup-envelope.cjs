const {cleanupChoice}=require('./browser-services/exit-cleanup.cjs');
const GENERAL_LIMIT=20000;
// Native accepts100strings of2048UTF-16 units. JSON escaping can use6characters
// per unit; the bounded exception belongs only to this exact cleanup envelope.
const CLEANUP_LIMIT=100*2048*6+4096;
function validServiceEnvelope(request){
 try{
  if(!request||typeof request!=='object'||Array.isArray(request))return false;
  if(request.type!=='cleanup.set')return JSON.stringify(request).length<=GENERAL_LIMIT;
  if(Object.keys(request).sort().join(',')!=='choice,type')return false;
  const value=request.choice;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='categories,enabled,keepOrigins'||!Array.isArray(value.categories)||value.categories.length>4||!Array.isArray(value.keepOrigins)||value.keepOrigins.length>100||value.keepOrigins.some(origin=>typeof origin!=='string'||origin.length>2048))return false;
  cleanupChoice(value);
  return JSON.stringify(request).length<=CLEANUP_LIMIT;
 }catch{return false;}
}
module.exports={validServiceEnvelope,GENERAL_LIMIT,CLEANUP_LIMIT};
