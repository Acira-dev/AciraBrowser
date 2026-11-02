// The services speak the chosen language in the real app: Settings > Languages = German, then the protection summary the Settings page reads comes back in German.
// One app, closed in finally. node qa/privacy-plus/i18n-services-app.mjs
import {startApp, sleep} from '../d-harness.mjs';
const checks = [];
const check = (name, ok, detail) => { checks.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(detail)); };
const app = await startApp({root: '.qa-profiles/j-i18n'});
try {
  const rows = async () => (await app.svc({type: 'protection.status'})).protection.rows;
  const title = async (id) => (await rows()).find(row => row.id === id)?.title;
  await app.act({type: 'settings.update', patch: {language: 'en'}}); await sleep(300);
  check('English', await title('ads-trackers') === 'Ads and trackers', await title('ads-trackers'));
  await app.act({type: 'settings.update', patch: {language: 'de'}}); await sleep(300);
  check('German follows the setting', await title('ads-trackers') === 'Werbung und Tracker' && await title('phishing-malware') === 'Warnungen vor Phishing und Schadsoftware', [await title('ads-trackers'), await title('phishing-malware')]);
  await app.act({type: 'settings.update', patch: {language: 'ja'}}); await sleep(300);
  check('Japanese follows the setting', await title('cookie-banners') === 'Cookie バナー', await title('cookie-banners'));
  await app.act({type: 'settings.update', patch: {language: 'system'}}); await sleep(300);
} finally { await app.close(); }
console.log(checks.every(Boolean) ? 'ALL PASS' : 'FAILED');
process.exit(checks.every(Boolean) ? 0 : 1);
