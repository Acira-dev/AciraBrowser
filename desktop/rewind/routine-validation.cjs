'use strict';
// Trusted validator for acira-routine v1 (docs/design/rewind-routines/routine.schema.json + ROUTINES_SPEC §7).
// Size and depth are checked before parsing work; prototype keys are refused; every object is additionalProperties:false;
// unknown commands or versions reject the whole recipe. Labels are data, never instructions or HTML.
const MAX_BYTES=65536,MAX_DEPTH=8;
const COLORS=['none','grey','blue','red','yellow','green','pink','purple','cyan','orange'];
const COMMANDS=['tabs.open','tabs.group','layout.split','layout.focus'];
const FORBIDDEN=new Set(['__proto__','constructor','prototype']);
function depthOf(text){let depth=0,max=0,inString=false,escaped=false;for(const ch of text){if(inString){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')inString=false;continue;}if(ch==='"')inString=true;else if(ch==='{'||ch==='['){depth++;if(depth>max)max=depth;}else if(ch==='}'||ch===']')depth--;}return max;}
function lineOf(text,error){const at=/position (\d+)/.exec(String(error?.message||''));if(!at)return null;return text.slice(0,Number(at[1])).split('\n').length;}
function validateRecipeText(text){
 if(typeof text!=='string')return {ok:false,errors:['This file isn’t valid JSON.']};
 if(Buffer.byteLength(text,'utf8')>MAX_BYTES)return {ok:false,errors:['This routine is larger than 64 KB.']};
 if(depthOf(text)>MAX_DEPTH)return {ok:false,errors:['This routine is nested too deeply.']};
 let doc,bad=false;
 try{doc=JSON.parse(text,(key,value)=>{if(FORBIDDEN.has(key))bad=true;return value;});}catch(error){const line=lineOf(text,error);return {ok:false,errors:[line?`This file isn’t valid JSON. Check line ${line}.`:'This file isn’t valid JSON.']};}
 if(bad)return {ok:false,errors:['This routine contains a field name Acira doesn’t accept.']};
 return validateRecipe(doc);
}
function validateRecipe(doc){
 const errors=[];
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
 function keys(x,allowed,path,required=allowed){if(!object(x)){errors.push(`${path} must be an object.`);return false;}for(const k of Object.keys(x))if(!allowed.includes(k))errors.push(`${path}: unsupported field “${String(k).slice(0,40)}”.`);for(const k of required)if(!Object.hasOwn(x,k))errors.push(`${path}: missing ${k}.`);return true;}
 function string(x,max,path,min=1){if(typeof x!=='string'||x.trim().length<min||x.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(x)){errors.push(`${path} has an invalid length or characters.`);return false;}return true;}
 function identifier(x,path){if(typeof x!=='string'||x.length<1||x.length>40||!/^[A-Za-z][A-Za-z0-9_-]*$/.test(x)){errors.push(`${path} must be a simple identifier.`);return false;}return true;}
 if(!keys(doc,['format','version','name','description','steps'],'Routine',['format','version','name','steps']))return {ok:false,errors};
 if(doc.format!=='acira-routine')errors.push('This isn’t an Acira routine file.');
 else if(doc.version!==1)errors.push('This routine needs a newer format version.');
 string(doc.name,80,'Name');if(Object.hasOwn(doc,'description'))string(doc.description,280,'Description',0);
 if(!Array.isArray(doc.steps)||doc.steps.length<1||doc.steps.length>12)return {ok:false,errors:[...errors,'Use between 1 and 12 steps.']};
 const steps=new Set(),refs=new Set(),domains=new Set();
 const knownRef=(ref,path)=>{if(identifier(ref,path)&&!refs.has(ref))errors.push(`${path} must refer to a tab opened by an earlier step.`);};
 for(const [i,step] of doc.steps.entries()){
  const path=`Step ${i+1}`;if(!keys(step,['id','command','args'],path))continue;
  identifier(step.id,`${path} ID`);if(steps.has(step.id))errors.push(`${path}: duplicate step ID.`);steps.add(step.id);
  if(!COMMANDS.includes(step.command)){errors.push(`This routine uses an action Acira doesn’t support: “${String(step.command).slice(0,60)}”.`);continue;}
  const a=step.args;
  if(step.command==='tabs.open'){
   if(!keys(a,['items','reuse'],path))continue;
   if(a.reuse!=='exact-url-in-workspace')errors.push(`${path}: unsupported reuse mode.`);
   if(!Array.isArray(a.items)||a.items.length<1||a.items.length>8){errors.push(`${path}: open 1 to 8 tabs.`);continue;}
   for(const item of a.items){
    if(!keys(item,['ref','url'],`${path} tab`))continue;if(identifier(item.ref,`${path} tab reference`)){if(refs.has(item.ref))errors.push(`Duplicate tab reference: ${item.ref}.`);refs.add(item.ref);}
    if(string(item.url,4096,`${path} address`)){try{const u=new URL(item.url);if(!/^https?:\/\//i.test(item.url)||!['http:','https:'].includes(u.protocol)||u.username||u.password||item.url!==item.url.trim())errors.push(`${path}: only http and https addresses without a user name or password.`);else domains.add(u.host);}catch{errors.push(`${path}: “${item.url.slice(0,80)}” isn’t a valid address.`);}}
   }
  }else if(step.command==='tabs.group'){
   if(!keys(a,['refs','name','color'],path))continue;string(a.name,80,`${path} group name`);
   if(!COLORS.includes(a.color))errors.push(`${path}: unknown group colour.`);
   if(!Array.isArray(a.refs)||a.refs.length<1||a.refs.length>20)errors.push(`${path}: choose 1 to 20 tabs.`);else{if(new Set(a.refs).size!==a.refs.length)errors.push(`${path}: a tab is listed twice.`);for(const r of a.refs)knownRef(r,`${path} tab`);}
  }else if(step.command==='layout.split'){
   if(!keys(a,['left','right','ratio'],path))continue;knownRef(a.left,`${path} left`);knownRef(a.right,`${path} right`);
   if(a.left===a.right)errors.push(`${path}: choose two different tabs.`);
   if(typeof a.ratio!=='number'||!Number.isFinite(a.ratio)||a.ratio<.2||a.ratio>.8)errors.push(`${path}: ratio must be between 0.2 and 0.8.`);
  }else if(step.command==='layout.focus'){
   if(keys(a,['enabled'],path)&&typeof a.enabled!=='boolean')errors.push(`${path}: on or off must be true or false.`);
  }
 }
 if(refs.size>20)errors.push('A routine may open at most 20 tabs.');
 return errors.length?{ok:false,errors:[...new Set(errors)].slice(0,20)}:{ok:true,errors:[],recipe:canonical(doc),domains:[...domains]};
}
/** A fresh plain copy with fields in schema order — what gets stored and exported. */
function canonical(doc){
 const out={format:'acira-routine',version:1,name:doc.name.trim(),...(doc.description?{description:doc.description}:{}),steps:doc.steps.map(step=>({id:step.id,command:step.command,args:step.command==='tabs.open'?{reuse:step.args.reuse,items:step.args.items.map(i=>({ref:i.ref,url:i.url}))}:step.command==='tabs.group'?{refs:[...step.args.refs],name:step.args.name,color:step.args.color}:step.command==='layout.split'?{left:step.args.left,right:step.args.right,ratio:step.args.ratio}:{enabled:step.args.enabled}}))};
 return out;
}
module.exports={validateRecipeText,validateRecipe,COMMANDS,COLORS,MAX_BYTES};
