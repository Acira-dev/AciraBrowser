'use strict';
// "Is a VPN already running?": local adapter and process names only; only matches are reported; failures find nothing; the provider links are plain https.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {detectVpn,matchVpn,PROVIDERS}=require('../desktop/browser-services/vpn-detect.cjs');

test('known VPN apps and adapters are named once each, apps first',()=>{
 assert.deepEqual(matchVpn(['Ethernet','Wi-Fi'],['explorer.exe','chrome.exe']),[],'nothing VPN-like, nothing reported');
 assert.deepEqual(matchVpn(['Wi-Fi'],['Mullvad VPN.exe','ProtonVPN.exe']),[{name:'Mullvad VPN',how:'app running'},{name:'Proton VPN',how:'app running'}]);
 assert.deepEqual(matchVpn(['Mullvad','wg0','TAP-Windows Adapter V9'],['mullvad-daemon.exe']),[{name:'Mullvad VPN',how:'app running'},{name:'WireGuard',how:'network adapter'},{name:'OpenVPN or a similar VPN',how:'network adapter'}],'the same product is not listed twice');
 assert.deepEqual(matchVpn(['Local Area Connection'],['NORDVPN.EXE']),[{name:'NordVPN',how:'app running'}],'names compare case-insensitively');
 assert.deepEqual(matchVpn(['Tailscale'],[]),[{name:'Tailscale',how:'network adapter'}]);
 assert.deepEqual(matchVpn(['Company VPN'],[]),[{name:'a VPN',how:'network adapter'}]);
});
test('detectVpn ignores internal adapters, survives failing sources, and reports matches only',async()=>{
 const interfaces=()=>({lo:[{internal:true,address:'127.0.0.1'}],'ProtonVPN':[{internal:false,address:'10.2.0.2'}],'wintun-ghost':[{internal:true,address:'10.0.0.1'}],Ethernet:[{internal:false,address:'192.168.1.5'}]});
 const result=await detectVpn({interfaces,processes:async()=>['svchost.exe','ivpn client.exe','discord.exe']});
 assert.deepEqual(result,{detected:[{name:'IVPN',how:'app running'},{name:'Proton VPN',how:'network adapter'}]});
 assert.doesNotMatch(JSON.stringify(result),/svchost|discord|Ethernet|192\.168|10\.2\.0/,'no process, adapter name or address leaks out');
 assert.deepEqual(await detectVpn({interfaces:()=>{throw new Error('boom');},processes:async()=>{throw new Error('boom');}}),{detected:[]});
 assert.deepEqual(await detectVpn({interfaces:()=>null,processes:async()=>[]}),{detected:[]});
});
test('the real call on this computer returns a well-formed answer without throwing',async()=>{
 const result=await detectVpn();assert.ok(Array.isArray(result.detected));for(const item of result.detected){assert.equal(typeof item.name,'string');assert.ok(['app running','network adapter'].includes(item.how));}
});
test('provider links are plain https sites with no tracking parameters and an honest one-line note',()=>{
 assert.deepEqual(PROVIDERS.map(item=>item.id),['mullvad','proton','ivpn']);
 for(const provider of PROVIDERS){const url=new URL(provider.url);assert.equal(url.protocol,'https:');assert.equal(url.search,'');assert.equal(url.hash,'');assert.ok(provider.note.length>10&&provider.note.length<100,provider.id);assert.match(provider.note,/audit/i,provider.id+' says why it is listed');}
});
