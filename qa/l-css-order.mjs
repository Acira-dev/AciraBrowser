// Stream L: the stylesheet cascade order is what it was before the language change (the App's own component styles first, then fonts/styles and the shared layers).
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';
const data = path.resolve('.qa-profiles/l-css-' + Date.now());
const app = await launchPreparedNative({
  executablePath: createRequire(import.meta.url)('electron'),
  args: [path.resolve('desktop/main.cjs')],
  env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.resolve('.qa-profiles/import-fixture'), ACIRA_BROWSER_TEST_HIDDEN: '1' },
});
try {
  let ui = null;
  for (let i = 0; i < 100 && !ui; i++) { ui = app.windows().find(p => p.url() === 'acira-browser-ui://ui/index.html'); if (!ui) await new Promise(r => setTimeout(r, 100)); }
  await new Promise(r => setTimeout(r, 2500));
  const order = await ui.evaluate(() => [...document.styleSheets].map(s => (s.href || 'inline').split('/').pop().replace(/-[\w-]{6,}\./, '.')));
  console.log(order.join(' > '));
  const app_ = order.findIndex(n => /^App\.css/.test(n)), index = order.findIndex(n => /^index\.css/.test(n));
  console.log(app_ >= 0 && index >= 0 && app_ < index ? 'PASS App styles come before the shared layers' : 'CHECK order above (App ' + app_ + ', shared ' + index + ')');
} finally { await app.close().catch(() => {}); }
