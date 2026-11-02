import test from 'node:test';import assert from 'node:assert/strict';import {resolveNavigation} from '../src/runtime/navigation';
test('schemeless loopback and private endpoints retain port/path with intentional HTTP defaults',()=>{
 for(const host of ['localhost','localhost:3000','myapp.localhost:3000','nas.local:8080','127.0.0.1:5173','127.0.0.2','192.168.1.1','192.168.1.1:8080','10.2.3.4','172.16.1.2','172.31.9.8','169.254.1.2','[::1]:3000','[fd00::1]:8080','[fe80::1]']){const result=resolveNavigation(host+'/path?q=1#part');assert.equal(result.contentKind,'web');assert.equal(result.url,`http://${host}/path?q=1#part`);}
});
test('explicit protocols are preserved; public destinations stay HTTPS and unsafe schemes stay blocked',()=>{
 for(const value of ['https://192.168.1.1/path','https://localhost:3000/path','http://example.com/path'])assert.equal(resolveNavigation(value).url,value);
 for(const host of ['example.com','172.32.1.2','192.169.1.1','8.8.8.8'])assert.equal(resolveNavigation(host).url,`https://${host}/`);
 for(const value of ['javascript:alert(1)','file:///etc/passwd','ftp://localhost/file','https://user:pass@localhost/'])assert.equal(resolveNavigation(value).contentKind,'internal');
 assert.equal(resolveNavigation('where is localhost').query,'where is localhost');
});
