'use strict';
// Detached OpenPGP signature check for Tor Browser Developers releases (RSA, v4 signatures), with no gpg and no dependency.
// Trust anchor: the primary key EF6E286DDA85EA2A4BA7DE684E2C6E8793298290 (https://support.torproject.org/tbb/how-to-verify-signature/);
// the signing subkeys below were read from its published key on 2026-10-25 and are pinned by fingerprint. A release signed by any
// other key (a newer subkey, say) fails closed: the update is not applied until Acira ships the new subkey.
const crypto=require('node:crypto');
const PRIMARY='EF6E286DDA85EA2A4BA7DE684E2C6E8793298290';
const SIGNING_SUBKEYS={
 "022DA248432D2A0E0F54E65E316C1FACD62D07D9": {
  "n": "p7y8zLiEESNi-QNsWBBw5JgZbJGkgFTtEhEdeTVIYdy34N2bQNJ5pn4MhQTjUZFZNUHyXMZBRcU3K9tk5rNoLPUG-H3eGZJZuLuKg6vhX3YxCGYza-vfZHn5eFSth-naMsCAcfKLNLcBkZijCI1YCOWW-RGC7LEjXqcsImgQHWIYyAKx3fVl8Xw021sByGKXJSxYRmcOU3Gwu_yRmj6bbYsAcMW8ssxcqesAb-wdlEDjapPiLBUqneMNUH67E0rfSkMFx15v10hWLU2E_vTUgnHTYJQUynP5Tv4Nbnahm1nv0_D1hvAMbRyOuL3DCsA9GI-xLBo2EJmKr8dS83kE4KjCW3Gn5Vx8qVEjwb7e1P3R-Q5Pl210WBRj1p7RaKhWLmj_UM6LBwOxpm_g1Z6iTz_EoKqB_M_FHVjtTfLsLHI0drdZnlej8JBW0MliTFtZz6bfI6El-mWkda-8qw-QqmZEc_UtwkmihtLh7ykSL4_N13y3sMFnXE9Og9sFduZLYPa07d2WNPNoU9GkVXLWIpFhX3SXpDQvDE6Ztf4ybd4pQmeFx3PXpsJeWv1LEYPd8TQvH-G2gC9gnJaSBn0FpugnIH3KV7VmHbIrHB3ndJcB5qc8MVhgFsSgqKVHV_e5_SpbyJcN79bdytMQcwGtYuini3s-Oroi2O8VN5UpwBM",
  "e": "AQAB"
 },
 "CAAE408AEBE2288E96FC5D5E157432CF78A65729": {
  "n": "tdDO9thd-ZB31vacf5yNQ3X20knL04eK1C_dmdiaw0c4xDINW_B9lI9MyqCA2_UArD5UdfY-OLr5CNlaEGTyTBNtQlUGNaZrseyF1tRPmOeZ-4We7WTfYnxWw4ZN7a2dfYmy5OMn5CTeKbdiGksUKJQFDjdCqdDgyf0vgXP6aOkIFCQTSBcdPhQYUg_0QLxbkMB73CriqNUHFCtNyLvxA4Vl1AlQFfn0rzKvx67ZZllJ6IkLYLx4vaI6dqzIqHekuco_IB_BYNGxe8zEA5T4i-wwIGi9yayPyXc2_3mxiBiv6zA1MYCYtxlzBAsSXLABuDTI5jrmBgv4C5WERdiwUGsgbis0hufFVUk9f04WHjrrloGjJrvSsA0vgH5tvdHSQnMVt5rOmpQxZiGmfRgRcJogvGDULOH8Pxzs3-hMjVmJMu4g0c6H5CsumhjQs3kWuhMMQPadXs8gBWc5GZlkNqJhY4-N-TjWi88-xhj_wHm0H1L5mjNamj8fAnPc1qFnwavWoLx_psQiR7k4B_PcNoHPG3Ox5TPke5QwDLpGk18vWm101QK4-e6bWQiV0yoGaBDb9mf3xIfNPaIqTwd4uPiKkbBMfYEh92bIhEuD2XWlWGtj0h3QcKgzx6cc1QygQum6BtrGT77EbniYsSc8x1RfzO2ue74UlNDtnGemA9s",
  "e": "AQAB"
 }
};
const HASHES={8:'sha256',9:'sha384',10:'sha512',11:'sha224'};
function unarmor(text){const lines=text.split(/\r?\n/);const start=lines.findIndex(l=>l.startsWith('-----BEGIN PGP SIGNATURE'));if(start<0)return Buffer.from(text,'latin1');const body=[];for(const l of lines.slice(start+1)){if(l.startsWith('-----END'))break;if(!l||l.includes(':')||l.startsWith('='))continue;body.push(l);}return Buffer.from(body.join(''),'base64');}
function packets(bin){const out=[];let i=0;while(i<bin.length){const h=bin[i++];let tag,len;if(h&0x40){tag=h&0x3f;const l=bin[i++];if(l<192)len=l;else if(l<224)len=((l-192)<<8)+bin[i++]+192;else if(l===255){len=bin.readUInt32BE(i);i+=4;}else throw new Error('Partial packets are not supported.');}else{tag=(h>>2)&0xf;const t=h&3;if(t===0)len=bin[i++];else if(t===1){len=bin.readUInt16BE(i);i+=2;}else if(t===2){len=bin.readUInt32BE(i);i+=4;}else throw new Error('Indeterminate packets are not supported.');}out.push({tag,body:bin.subarray(i,i+len)});i+=len;}return out;}
function subpackets(buf){const out=[];let i=0;while(i<buf.length){const l=buf[i++];let len;if(l<192)len=l;else if(l<255)len=((l-192)<<8)+buf[i++]+192;else{len=buf.readUInt32BE(i);i+=4;}out.push({type:buf[i]&0x7f,body:buf.subarray(i+1,i+len)});i+=len;}return out;}
/** True only when `signature` (armored or binary) is a valid RSA signature over `data` by a pinned Tor signing subkey, issued by the pinned primary key. */
function verifyDetached(data,signature){
 try{
  const sig=packets(Buffer.isBuffer(signature)?(signature.subarray(0,10).toString('latin1').startsWith('-----')?unarmor(signature.toString('latin1')):signature):unarmor(String(signature))).find(p=>p.tag===2);if(!sig)return false;
  const b=sig.body;if(b[0]!==4||b[1]!==0x00||b[2]!==1)return false;const hash=HASHES[b[3]];if(!hash||hash==='sha224')return false;
  const hashedLen=b.readUInt16BE(4),hashed=b.subarray(6,6+hashedLen),unhashedLen=b.readUInt16BE(6+hashedLen),unhashed=b.subarray(8+hashedLen,8+hashedLen+unhashedLen);
  let p=8+hashedLen+unhashedLen+2;const mbits=b.readUInt16BE(p),signed=b.subarray(p+2,p+2+Math.ceil(mbits/8));
  const issuers=[...subpackets(hashed),...subpackets(unhashed)];
  const fpPacket=issuers.find(s=>s.type===33),idPacket=issuers.find(s=>s.type===16);
  const fingerprint=fpPacket?fpPacket.body.subarray(1).toString('hex').toUpperCase():Object.keys(SIGNING_SUBKEYS).find(fp=>idPacket&&fp.endsWith(idPacket.body.toString('hex').toUpperCase()));
  const key=SIGNING_SUBKEYS[fingerprint];if(!key)return false;
  const header=b.subarray(0,6+hashedLen),trailer=Buffer.concat([Buffer.from([4,0xff]),Buffer.alloc(4)]);trailer.writeUInt32BE(header.length,2);
  const pub=crypto.createPublicKey({key:{kty:'RSA',n:key.n,e:key.e},format:'jwk'}),size=(pub.asymmetricKeyDetails?.modulusLength||4096)/8;
  const padded=Buffer.concat([Buffer.alloc(Math.max(0,size-signed.length)),signed]);
  return crypto.verify(hash,Buffer.concat([data,header,trailer]),pub,padded);
 }catch{return false;}
}
module.exports={verifyDetached,PRIMARY,SIGNING_SUBKEYS};
