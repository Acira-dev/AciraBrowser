'use strict';
// Local weak/reused check. Nothing here stores or sends a password. Reuse is found by comparing HMACs keyed with a random,
// in-memory, per-check secret, so the grouping never exists as a reusable fingerprint.
const crypto=require('node:crypto');
const COMMON=new Set(('password,password1,password12,password123,passw0rd,p@ssw0rd,qwerty,qwerty123,qwertyuiop,asdfgh,asdfghjkl,zxcvbnm,'+
 '123456,1234567,12345678,123456789,1234567890,111111,000000,123123,654321,666666,121212,696969,abc123,abcd1234,iloveyou,admin,admin123,'+
 'welcome,welcome1,login,letmein,monkey,dragon,master,sunshine,princess,football,baseball,superman,batman,trustno1,shadow,michael,jennifer,'+
 'hunter2,changeme,default,secret,test,test123,guest,user,root,toor,1q2w3e4r,1qaz2wsx,zaq12wsx,qazwsx,mustang,starwars,whatever,freedom,'+
 'hello,hello123,computer,internet,flower,cheese,cookie,summer,winter,spring,autumn,google,facebook,samsung,pokemon,naruto,charlie,jordan').split(','));
const ROWS=['qwertyuiop','asdfghjkl','zxcvbnm','1234567890','abcdefghijklmnopqrstuvwxyz'];
function hasSequence(value,run=4){
 const lower=value.toLowerCase();
 for(const row of ROWS)for(let i=0;i+run<=row.length;i++){const seq=row.slice(i,i+run);if(lower.includes(seq)||lower.includes([...seq].reverse().join('')))return true;}
 return false;
}
function poolSize(password){let pool=0;if(/[a-z]/.test(password))pool+=26;if(/[A-Z]/.test(password))pool+=26;if(/\d/.test(password))pool+=10;if(/[^A-Za-z0-9]/.test(password))pool+=32;return pool||1;}
/** {label:'weak'|'fair'|'strong', bits, reasons:[...]} */
function assess({password,username='',origin=''}){
 const reasons=[];const value=typeof password==='string'?password:'';
 if(!value)return {label:'weak',bits:0,reasons:['empty']};
 const lower=value.toLowerCase();
 let bits=value.length*Math.log2(poolSize(value));
 const unique=new Set(value).size;
 if(unique<=Math.ceil(value.length/3)){reasons.push('repeats');bits=Math.min(bits,unique*Math.log2(poolSize(value)));}
 if(COMMON.has(lower)||COMMON.has(lower.replace(/[0-9!@#$%^&*]+$/,''))){reasons.push('common');bits=Math.min(bits,14);}
 if(hasSequence(value)){reasons.push('sequence');bits-=Math.min(bits*.4,20);}
 const name=String(username).split('@')[0].toLowerCase();
 if(name.length>=4&&lower.includes(name)){reasons.push('contains-username');bits-=16;}
 try{const host=new URL(origin).hostname.replace(/^www\./,'').split('.').filter(label=>label.length>=4)[0];if(host&&lower.includes(host)){reasons.push('contains-site');bits-=12;}}catch{}
 if(value.length<8)reasons.push('short');
 bits=Math.max(0,Math.round(bits));
 // A password built from the username, or a common one, is weak however long it is; echoing the site or a keyboard run caps it at fair.
 let label=reasons.includes('common')||reasons.includes('short')||reasons.includes('contains-username')||bits<36?'weak':bits<60?'fair':'strong';
 if(label==='strong'&&(reasons.includes('contains-site')||reasons.includes('sequence')||reasons.includes('repeats')))label='fair';
 return {label,bits,reasons};
}
/** Finds groups of entries sharing a password. entries: [{id,password}] -> Map(id -> number of other entries with the same password). */
function reuseCounts(entries,key=crypto.randomBytes(32)){
 const groups=new Map();
 for(const entry of entries){if(!entry.password)continue;const tag=crypto.createHmac('sha256',key).update(entry.password).digest('hex');(groups.get(tag)||groups.set(tag,[]).get(tag)).push(entry.id);}
 const counts=new Map();
 for(const ids of groups.values())if(ids.length>1)for(const id of ids)counts.set(id,ids.length-1);
 return counts;
}
module.exports={assess,reuseCounts,COMMON};
