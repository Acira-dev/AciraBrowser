// Scratch: is isBeingCaptured() true under the Playwright harness (it blocks tab sleep with reason "capturing")?
import {launch, sleep} from './lib.mjs';
const app = await launch('ext-capture-probe');
try {
  await app.act({type: 'tab.new', url: 'https://example.com/'}); await sleep(4000);
  const read = () => app.main(({webContents}) => webContents.getAllWebContents().map(w => ({url: w.getURL().slice(0, 40), captured: w.isBeingCaptured && w.isBeingCaptured(), debugger: w.debugger.isAttached()})));
  console.log('before screenshot', JSON.stringify(await read()));
  const page = app.web('https://example.com/'); await page.bringToFront().catch(() => {}); await sleep(500);
  console.log('after bringToFront', JSON.stringify(await read()));
} finally { await app.close(); process.exit(0); }
