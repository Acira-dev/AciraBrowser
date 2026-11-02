'use strict';
// Proxy test button: local fake proxies only, never a public one.
const {test}=require('node:test'),assert=require('node:assert/strict'),net=require('node:net');
const {checkProxy}=require('../desktop/browser-services/proxy-check.cjs');
const listen=handler=>new Promise(resolve=>{const sockets=new Set(),server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});handler(socket);});server.listen(0,'127.0.0.1',()=>resolve({server,sockets,port:server.address().port}));});
const stop=({server,sockets})=>new Promise(resolve=>{for(const socket of sockets)socket.destroy();server.close(resolve);});
test('a SOCKS5 proxy without a sign-in passes; one that wants a password explains why Acira cannot use it',async()=>{
 const open=await listen(socket=>socket.once('data',data=>{assert.deepEqual([...data],[5,1,0],'no sign-in is asked for first, alone');socket.end(Buffer.from([5,0]));}));
 const result=await checkProxy({scheme:'socks5',host:'127.0.0.1',port:open.port});assert.equal(result.ok,true);assert.match(result.message,/SOCKS5 proxy and accepts/);await stop(open);
 // A proxy that really wants a login refuses "no sign-in" (255), then answers 2 when both are offered.
 const login=await listen(socket=>socket.once('data',data=>socket.end(Buffer.from([5,data.length===3?255:2]))));
 const wants=await checkProxy({scheme:'socks5',host:'127.0.0.1',port:login.port});assert.equal(wants.ok,false);assert.match(wants.message,/cannot send SOCKS5 sign-ins/);assert.match(wants.message,/HTTP proxy/);assert.match(wants.message,/Use my VPN app/);await stop(login);
});
test('an HTTP proxy passes whatever it answers to a CONNECT, including 407; a non-proxy and a wrong protocol do not',async()=>{
 let seen='';const http407=await listen(socket=>socket.once('data',data=>{seen=data.toString();socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');}));
 const need=await checkProxy({scheme:'http',host:'127.0.0.1',port:http407.port});assert.equal(need.ok,true);assert.match(need.message,/needs a sign-in/);assert.match(seen,/^CONNECT 127\.0\.0\.1:9 HTTP\/1\.1/,'only a CONNECT to a closed local port is sent');await stop(http407);
 const fine=await listen(socket=>socket.once('data',()=>socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n')));assert.equal((await checkProxy({scheme:'http',host:'127.0.0.1',port:fine.port})).ok,true);await stop(fine);
 const smtp=await listen(socket=>socket.write('220 mail.example ESMTP\r\n'));const wrong=await checkProxy({scheme:'http',host:'127.0.0.1',port:smtp.port});assert.equal(wrong.ok,false);assert.match(wrong.message,/not as an HTTP proxy/);await stop(smtp);
 const asSocks=await listen(socket=>socket.once('data',()=>socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')));const notSocks=await checkProxy({scheme:'socks5',host:'127.0.0.1',port:asSocks.port});assert.equal(notSocks.ok,false);await stop(asSocks);
});
test('closed ports, silent servers, bad addresses and credentials give plain messages',async()=>{
 const closed=await listen(()=>{});const port=closed.port;await stop(closed);
 const refused=await checkProxy({scheme:'http',host:'127.0.0.1',port});assert.equal(refused.ok,false);assert.match(refused.message,/Nothing is listening at 127\.0\.0\.1:/);
 const silent=await listen(()=>{});const slow=await checkProxy({scheme:'http',host:'127.0.0.1',port:silent.port},{timeoutMs:300});assert.equal(slow.ok,false);assert.match(slow.message,/No answer from/);await stop(silent);
 const hung=await listen(socket=>socket.once('data',()=>socket.end()));const gone=await checkProxy({scheme:'http',host:'127.0.0.1',port:hung.port});assert.equal(gone.ok,false);assert.match(gone.message,/closed the connection/);await stop(hung);
 for(const bad of [{scheme:'http',host:'user:pass@proxy.example',port:8080},{scheme:'http',host:'proxy.example/path',port:8080},{scheme:'ftp',host:'proxy.example',port:21},{scheme:'http',host:'proxy.example',port:0},{scheme:'http',host:'',port:80},null]){const result=await checkProxy(bad);assert.equal(result.ok,false,JSON.stringify(bad));assert.ok(result.message);}
});
test('a SOCKS5 proxy that prefers a username but accepts none (Tor\'s own SocksPort) is not reported as needing a login',async()=>{
 // Found by qa/r4-proxy-e2e.mjs against a real Tor client: offered [none, user/pass] it answers 2 and still accepts [none].
 const seen=[],tor=await listen(socket=>socket.on('data',data=>{seen.push([...data]);socket.end(Buffer.from([5,data.includes(2)?2:0]));}));
 const result=await checkProxy({scheme:'socks5',host:'127.0.0.1',port:tor.port});
 assert.equal(result.ok,true);assert.match(result.message,/accepts connections without a sign-in/);assert.deepEqual(seen,[[5,1,0]],'one probe was enough');
 assert.equal('refusedNoAuth' in result,false,'the internal flag never reaches the screen');await stop(tor);
});
test('a SOCKS5 proxy that refuses every method says so plainly',async()=>{
 const none=await listen(socket=>socket.once('data',()=>socket.end(Buffer.from([5,255]))));
 const result=await checkProxy({scheme:'socks5',host:'127.0.0.1',port:none.port});assert.equal(result.ok,false);assert.doesNotMatch(result.message,/username and password/);await stop(none);
});
