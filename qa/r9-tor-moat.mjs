// Moat over the real network (desktop/browser-services/tor-moat.cjs, the code the app runs): the pinned lyrebird as a managed meek_lite
// client, domain fronted through Tor Browser's CDN targets, TLS to bridges.torproject.org inside it. Proves: the fronted channel answers
// (circumvention/builtin returns current obfs4 lines), a CAPTCHA arrives (saved as a picture to look at), and a wrong answer is told
// apart from a failure (Moat's 419 → null). Solving the CAPTCHA needs a person, so a real bridge from `check` is not fetched here.
// No Electron, no tor, nothing of any profile. Output: .qa-profiles/r9-tor-moat-*/captcha.jpg
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {createTorMoat} = require('../desktop/browser-services/tor-moat.cjs');
const {transportDirectory, transportPins, parseBridgeLine} = require('../desktop/browser-services/tor-bridges.cjs');

const results = [];
const check = (ok, label) => { results.push([ok, label]); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };
const userData = path.resolve(`.qa-profiles/r9-tor-moat-${Date.now()}`); fs.mkdirSync(userData, {recursive: true});
const verify = async (file, sha) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === sha;
const moat = createTorMoat({userData, transports: () => transportDirectory(), pins: transportPins, verify, log: line => console.log('  ' + line)});
try {
  let started = Date.now();
  const builtin = await moat.builtin(['obfs4']);
  const lines = builtin?.obfs4 || [];
  check(lines.length > 0 && lines.every(line => parseBridgeLine(line).line), `Moat (domain fronted, ${Math.round((Date.now() - started) / 1000)}s): circumvention/builtin returned ${lines.length} obfs4 lines, all valid bridge lines`);
  started = Date.now();
  const captcha = await moat.fetch();
  console.log('  captcha:', JSON.stringify({transport: captcha.transport, challenge: captcha.challenge.length, image: captcha.image.length, head: captcha.image.slice(0, 24)}));
  fs.writeFileSync(path.join(userData, 'captcha.jpg'), Buffer.from(captcha.image, 'base64'));
  check(captcha.transport === 'obfs4' && captcha.challenge.length > 0 && captcha.image.startsWith('/9j/') && captcha.image.length > 1000, `Moat fetch: an obfs4 CAPTCHA arrived (${Math.round(captcha.image.length / 1024)} KB image, ${Math.round((Date.now() - started) / 1000)}s), saved to ${path.join(userData, 'captcha.jpg')}`);
  // A made-up answer: Moat either says it is wrong (419 → null) or, as rdsys did on 28 Oct 2026, hands out bridges anyway. Either
  // way the call must not fail, and any lines must be bridges Acira accepts. The lines themselves are never printed.
  const answer = await moat.check({transport: captcha.transport, challenge: captcha.challenge, solution: 'r9-made-up'}).catch(error => ({error: error.message, code: error.code}));
  const valid = Array.isArray(answer) && answer.every(line => parseBridgeLine(line).line);
  check(answer === null || valid, `Moat check: the answer round trip works (${answer === null ? 'answer refused as wrong' : valid ? `${answer.length} obfs4 bridges returned, all valid` : JSON.stringify(answer)})`);
} catch (error) {
  check(false, 'Moat: ' + (error.stack || error.message));
} finally { moat.stop(); }
const failed = results.filter(([ok]) => !ok).length;
console.log(failed ? `FAIL ${failed}/${results.length}` : `PASS ${results.length}/${results.length}`);
setTimeout(() => process.exit(failed ? 1 : 0), 500);
