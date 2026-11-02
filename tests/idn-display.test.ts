import test from 'node:test';import assert from 'node:assert/strict';import {domainToASCII} from 'node:url';
import {displayHostname,decodePunycode} from '../src/ui/idnDisplay';import {urlDisplay} from '../src/ui/urlDisplay';
// Every internationalised host read as punycode (münchen.de as xn--mnchen-3ya.de). As in Chrome, a name that is safe to read now shows
// in its own script, and one that mixes scripts or imitates another stays punycode.
const shown=(name:string)=>displayHostname(domainToASCII(name));
test('punycode decodes as RFC 3492 says',()=>{
 assert.equal(decodePunycode('mnchen-3ya'),'münchen');assert.equal(decodePunycode('e1afmkfd'),'пример');assert.equal(decodePunycode('r8jz45g'),'例え');assert.equal(decodePunycode('zz!'),null);
});
test('safe names read in their own script',()=>{
 for(const name of ['münchen.de','пример.рф','пример.com','例え.jp','한국.kr','中国.cn','ソニー.jp','मराठी.भारत','ελλάδα.gr','é.com','аррӏе.ru','þorsmork.is'])assert.equal(shown(name),name,name);
 assert.equal(displayHostname('example.com'),'example.com');
});
test('mixed scripts, whole-script lookalikes, deviation letters and Chrome\'s dangerous patterns stay punycode',()=>{
 for(const name of ['аррӏе.com','аpple.com','gοοgle.com','αικο.com','faß.de','þorsmork.com','ɡoogle.com','gıthub.com','i̇nstagram.com','abcノdef.com','sony-ー.com','a一b.com','ab̀.com'.replace('ab̀','あ̀')]){const ascii=domainToASCII(name);assert.ok(ascii,name);assert.equal(displayHostname(ascii),ascii,name);}
 assert.equal(displayHostname('xn--mnchen-3ya.xn--80ak6aa92e.com'),'xn--mnchen-3ya.xn--80ak6aa92e.com','one unsafe label keeps the whole name in punycode');
 assert.equal(displayHostname('xn--zz!.com'),'xn--zz!.com','not punycode at all');
});
test('the address at rest uses it; the security words still look at the real host',()=>{
 assert.deepEqual(urlDisplay('https://www.xn--mnchen-3ya.de/stadt?x=1'),{prefix:'',domain:'münchen.de',rest:'/stadt?x=1',insecure:false});
 assert.deepEqual(urlDisplay('http://shop.xn--80ak6aa92e.com:8080/'),{prefix:'shop.',domain:'xn--80ak6aa92e.com',rest:':8080',insecure:true});
});
