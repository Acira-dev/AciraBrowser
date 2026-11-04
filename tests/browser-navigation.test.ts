import test from 'node:test';import assert from 'node:assert/strict';import {resolveNavigation} from '../src/runtime/navigation';
test('schemeless loopback and private endpoints retain port/path with intentional HTTP defaults',()=>{
 for(const host of ['localhost','localhost:3000','myapp.localhost:3000','nas.local:8080','127.0.0.1:5173','127.0.0.2','192.168.1.1','192.168.1.1:8080','10.2.3.4','172.16.1.2','172.31.9.8','169.254.1.2','[::1]:3000','[fd00::1]:8080','[fe80::1]']){const result=resolveNavigation(host+'/path?q=1#part');assert.equal(result.contentKind,'web');assert.equal(result.url,`http://${host}/path?q=1#part`);}
});
test('explicit protocols are preserved; public destinations stay HTTPS and unsafe schemes stay blocked',()=>{
 for(const value of ['https://192.168.1.1/path','https://localhost:3000/path','http://example.com/path'])assert.equal(resolveNavigation(value).url,value);
 assert.equal(resolveNavigation('example.com').url,'https://example.com/');
 // An IP address typed without a scheme opens over http, as in Chrome (HTTPS-Upgrades skip IP addresses): a public one too, not only private ranges.
 for(const host of ['172.32.1.2','192.169.1.1','8.8.8.8'])assert.equal(resolveNavigation(host).url,`http://${host}/`);
 for(const host of ['172.32.1.2','8.8.8.8'])assert.equal(resolveNavigation(`https://${host}`).url,`https://${host}/`,'typed https stays https');
 for(const value of ['javascript:alert(1)','file:///etc/passwd','ftp://localhost/file','https://user:pass@localhost/'])assert.equal(resolveNavigation(value).contentKind,'internal');
 assert.equal(resolveNavigation('where is localhost').query,'where is localhost');
});
test('typed operators, versions and code words search; a dotted word opens only with a real top-level suffix, a port, a path or an IP',()=>{
 for(const value of ['site:example.com','define:word','re:zero','time:12:30','std::vector','v1.2','node.js','next.js','Next.JS','3.14','192.168.1','abc.def.ghi','a.b?x']){const result=resolveNavigation(value);assert.equal(result.error,undefined,value);assert.equal(result.query,value,value);}
 // A port, an IP address or a local name (.test, .lan ...) opens over http without an https try, as in Chrome (src/runtime/navigation.ts).
 for(const [value,url] of [['nodejs.org','https://nodejs.org/'],['setup.py','https://setup.py/'],['bbc.co.uk','https://bbc.co.uk/'],['пример.рф','https://xn--e1afmkfd.xn--p1ai/'],['node.js/','https://node.js/'],['node.js:3000','http://node.js:3000/'],['foo.bar/baz','https://foo.bar/baz'],['1.2.3.4','http://1.2.3.4/'],['nas.local','http://nas.local/'],['myapp.test','http://myapp.test/'],['router.lan','http://router.lan/'],['abc.onion','https://abc.onion/']])assert.equal(resolveNavigation(value).url,url,value);
 for(const value of ['mailto:a@example.com','about:blank','zoommtg://zoom.us/join','chrome://settings'])assert.equal(resolveNavigation(value).error,'Acira opens only http and https addresses.',value);
});
