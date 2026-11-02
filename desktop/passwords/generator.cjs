'use strict';
// Strong password generator: uniform selection from a CSPRNG (crypto.randomInt, no modulo bias), every class present,
// no look-alike characters. 20 characters by default (~120 bits).
const crypto=require('node:crypto');
const LOWER='abcdefghijkmnopqrstuvwxyz',UPPER='ABCDEFGHJKLMNPQRSTUVWXYZ',DIGITS='23456789',SYMBOLS='!#$%&*+-=?@^_~';
function candidate(size,classes,pool,randomInt){
 const pick=set=>set[randomInt(set.length)];
 const chars=classes.map(pick);
 while(chars.length<size)chars.push(pick(pool));
 for(let i=chars.length-1;i>0;i--){const j=randomInt(i+1);[chars[i],chars[j]]=[chars[j],chars[i]];}
 return chars.join('');
}
function generate({length=20,symbols=true,randomInt=crypto.randomInt}={}){
 const size=Math.max(12,Math.min(64,Number.isInteger(length)?length:20));
 const classes=[LOWER,UPPER,DIGITS,...(symbols?[SYMBOLS]:[])],pool=classes.join('');
 // A random draw can contain a keyboard run ("asdf") or repeats by chance; the strength check would then call our own
 // suggestion "fair". Draw again (rarely more than once) so a generated password always reads strong.
 const {assess}=require('./strength.cjs');
 let value=candidate(size,classes,pool,randomInt);
 for(let tries=1;tries<8&&assess({password:value}).label!=='strong';tries++)value=candidate(size,classes,pool,randomInt);
 return value;
}
module.exports={generate,LOWER,UPPER,DIGITS,SYMBOLS};
