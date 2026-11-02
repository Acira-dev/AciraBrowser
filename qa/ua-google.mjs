// Real-engine check of the Chrome identity: loads a header echo and Google Search in an isolated profile (.qa-profiles), reads what the page can see
// and whether Google shows its "Switch to Chrome" promo. One Electron, two tabs, closed in finally. No searches are automated.
//   node qa/ua-google.mjs
import './live-google-gate.mjs'; import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp } from './d-harness.mjs';

const stamp = Date.now(), out = path.resolve(`qa/artifacts/ua-google-${stamp}`);
await fs.mkdir(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const probe = () => (async () => {
  const d = navigator.userAgentData, high = d ? await d.getHighEntropyValues(['fullVersionList', 'platformVersion']) : null;
  return { ua: navigator.userAgent, languages: [...navigator.languages], brands: d?.brands, fullVersionList: high?.fullVersionList, webdriver: navigator.webdriver, title: document.title, url: location.href,
    promo: /chrome/i.test(document.body?.innerText || '') ? (document.body.innerText.match(/.{0,60}(switch to chrome|get chrome|use chrome|google recommends|chrome browser).{0,60}/i) || [null])[0] : null,
    robot: /unusual traffic|not a robot|captcha|recaptcha/i.test(document.body?.innerText || '') || !!document.querySelector('iframe[src*="recaptcha"],form#captcha-form,#recaptcha') };
})();
const app = await startApp({ root: `.qa-profiles/ua-google-${stamp}` });
const report = { stamp };
try {
  for (const [name, url] of [['httpbin', 'https://httpbin.org/headers'], ['google-home', 'https://www.google.com/ncr'], ['google', 'https://www.google.com/search?q=test']]) {
    await app.act({ type: 'tab.new', url });
    const page = await app.waitWeb(u => u.startsWith(url.slice(0, 22)), name);
    await page.waitForLoadState('domcontentloaded').catch(() => {}); await sleep(5000);
    report[name] = await page.evaluate(probe);
    if (name === 'httpbin') report.httpbinBody = await page.evaluate(() => document.body.innerText.slice(0, 1500));
    await page.screenshot({ path: path.join(out, name + '.png') }).catch(() => {});
  }
} catch (error) { report.error = String(error.stack || error); } finally { await app.close(); }
await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
