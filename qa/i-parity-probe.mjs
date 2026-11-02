// Stream I parity probe: checks day-one features in the real app (isolated profile) and saves window captures.
// PDF viewer, Widevine availability, password-save prompt after a login form, translate UI on a German page,
// spellcheck state, Chrome Web Store page. Installs nothing, signs in nowhere.
// node qa/i-parity-probe.mjs   (needs .qa-profiles/first-run-seed + import-fixture, copied from stream F)
import { _electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd(), wait = (ms) => new Promise((r) => setTimeout(r, ms)), out = path.join(root, "qa/artifacts/i-parity");
await fs.mkdir(out, { recursive: true });
const data = path.join(root, ".qa-profiles/i-parity-" + Date.now());
await fs.cp(path.join(root, ".qa-profiles/first-run-seed"), data, { recursive: true, filter: (s) => !/lockfile$|Singleton/.test(s) });
const env = { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.join(root, ".qa-profiles/import-fixture") };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath: path.join(root, "node_modules/electron/dist/electron.exe"), args: [path.join(root, "desktop/main.cjs")], env, timeout: 30000 });
const shot = async (name) => {
  const b64 = await app.evaluate(async ({ BaseWindow, desktopCapturer, screen }) => {
    const win = BaseWindow.getAllWindows().filter((w) => w.isVisible()).sort((a, b) => b.getBounds().width - a.getBounds().width)[0];
    const bounds = win.getBounds(), scale = screen.getDisplayMatching(bounds).scaleFactor;
    const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: Math.round(bounds.width * scale), height: Math.round(bounds.height * scale) } });
    return sources.find((s) => s.id === win.getMediaSourceId())?.thumbnail.resize({ width: 720 }).toPNG().toString("base64") || "";
  });
  if (b64) await fs.writeFile(path.join(out, name + ".png"), Buffer.from(b64, "base64"));
};
// Run JS inside the web page whose URL contains `part`.
const inPage = (part, code) => app.evaluate(async ({ webContents }, [p, c]) => {
  const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(p) && !w.getURL().startsWith("acira-browser-ui://"));
  return wc ? wc.executeJavaScript(c, true).catch((e) => "error: " + e.message) : "no page for " + p;
}, [part, code]);
const result = {};
try {
  let page;
  for (let i = 0; i < 100 && !page; i++) { page = app.windows().find((p) => p.url() === "acira-browser-ui://ui/index.html"); if (!page) await wait(200); }
  await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setContentSize(1440, 900); w.center(); });
  await page.waitForSelector(".setup-dialog", { timeout: 20000 });
  await wait(1500);
  await page.getByRole("button", { name: "Skip setup" }).first().click();
  await wait(2000);
  const done = page.getByRole("button", { name: /^Done$/ });
  if (await done.count()) { await done.first().click(); await wait(600); }
  const open = (url) => page.evaluate((u) => window.acira.dispatch({ type: "tab.new", url: u }), url);

  if (process.argv.includes("--store")) {
    // Web Store only, with time for the page to finish: is the install button live, and which API does it see?
    await open("https://chromewebstore.google.com/detail/ublock-origin-lite/ddkjiahejlhfcafbddmgiahcphecmpfh");
    await wait(15000); await shot("06b-web-store-15s");
    result.store = await inPage("chromewebstore", `[...document.querySelectorAll('button')].filter(b=>/add to|remove from/i.test(b.textContent)).map(b=>b.textContent.trim()+' disabled='+b.disabled).join(' | ') || 'none'`);
    result.ua = await inPage("chromewebstore", "navigator.userAgent");
    result.webstorePrivate = await inPage("chromewebstore", "typeof chrome !== 'undefined' && chrome.webstorePrivate ? 'present' : 'absent'");
    throw new Error("store check done");
  }
  // 1. PDF viewer
  await open("https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf");
  await wait(5000); await shot("01-pdf");
  result.pdfTab = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()).filter((u) => u.includes("dummy.pdf") || u.startsWith("chrome-extension://")).join(" | "));

  // 2. Widevine / EME
  await open("https://example.com/");
  await wait(3000);
  result.widevine = await inPage("example.com", `navigator.requestMediaKeySystemAccess('com.widevine.alpha',[{initDataTypes:['cenc'],videoCapabilities:[{contentType:'video/mp4; codecs="avc1.42E01E"'}]}]).then(()=> 'available', e => 'unavailable: ' + e.name + ' ' + e.message)`);
  result.clearkey = await inPage("example.com", `navigator.requestMediaKeySystemAccess('org.w3.clearkey',[{initDataTypes:['cenc'],videoCapabilities:[{contentType:'video/mp4; codecs="avc1.42E01E"'}]}]).then(()=> 'available', e => 'unavailable: ' + e.name)`);

  // 3. Password save prompt: a local login form, filled and submitted.
  await inPage("example.com", `document.body.innerHTML = '<form id=f action="https://example.com/next" method=get><input name=u autocomplete=username value="tester"><input name=p type=password autocomplete=current-password value="not-a-real-password-123"><button>Sign in</button></form>'; setTimeout(()=>document.getElementById('f').requestSubmit(), 200); 'ok'`);
  await wait(3500); await shot("03-after-login-submit");
  result.uiAfterLogin = await page.evaluate(() => [...document.querySelectorAll("[role=dialog],[role=alertdialog],.toast,[data-toast]")].map((n) => (n.getAttribute("aria-label") || n.textContent || "").trim().slice(0, 80)).join(" | ") || "none");

  // 4. Translate UI on a German page
  await open("https://de.wikipedia.org/wiki/Typografie");
  await wait(5000); await shot("04-german-page");
  result.translateUi = await page.evaluate(() => [...document.querySelectorAll("button,[role=button]")].map((b) => b.getAttribute("aria-label") || b.textContent || "").filter((t) => /translat|übersetz/i.test(t)).join(" | ") || "none");

  // 5. Spellcheck state
  result.spellcheck = await app.evaluate(({ session }) => ({ enabled: session.defaultSession.isSpellCheckerEnabled(), languages: session.defaultSession.getSpellCheckerLanguages() }));

  // 6. Chrome Web Store page (no install)
  await open("https://chromewebstore.google.com/detail/ublock-origin-lite/ddkjiahejlhfcafbddmgiahcphecmpfh");
  await wait(6000); await shot("06-web-store");
  result.webStoreButton = await inPage("chromewebstore", `[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(t=>/add to|remove from|chrome|acira/i.test(t)).slice(0,4).join(' | ') || 'none'`);
} catch (error) {
  result.fatal = error.message.split("\n")[0];
} finally {
  console.log(JSON.stringify(result, null, 1));
  await app.close().catch(() => {});
  await fs.rm(data, { recursive: true, force: true }).catch(() => {});
}
