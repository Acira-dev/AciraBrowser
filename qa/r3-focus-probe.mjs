// R3-82 helper: in Focus, which element switches pointer events off for the toolbar, and which CSS rule or inline style does it.
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep} from './d-harness.mjs';

async function takeSlot(name) {
  const until = Date.now() + 20 * 60 * 1000;
  while (Date.now() < until) {
    for (const n of [1, 2, 3]) {
      const file = `C:/ae/slot-${n}.lock`;
      try { const handle = await fs.open(file, 'wx'); await handle.writeFile(`${name} ${new Date().toISOString()}`); await handle.close(); return file; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    await sleep(30000);
  }
  throw new Error('no native slot within 20 minutes');
}
let slot, app;
try {
  slot = await takeSlot('r3-fix-focus-probe');
  app = await startApp({root: path.resolve(`.qa-profiles/r3-focus-probe-${Date.now()}`), env: {ACIRA_BROWSER_TEST_HIDDEN: '0'}});
  await app.main(({BaseWindow}) => { const win = BaseWindow.getAllWindows()[0]; win.setBounds({x: 20, y: 20, width: 1280, height: 860}); win.show(); win.focus(); });
  await app.act({type: 'settings.update', patch: {language: 'en', onboardingComplete: true}});
  await app.act({type: 'ui.update', patch: {view: process.argv[2] || 'focus'}}); await sleep(1200);
  const info = await app.ui.evaluate(() => {
    const back = [...document.querySelectorAll('.acira-persistent-toolbar button')].find(b => /Back/.test(b.getAttribute('aria-label') || ''));
    const chain = []; for (let el = back; el && el !== document.documentElement; el = el.parentElement) { const cs = getComputedStyle(el); const parentPe = el.parentElement ? getComputedStyle(el.parentElement).pointerEvents : 'auto'; chain.push({el: el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 80) + (el.id ? '#' + el.id : ''), pe: cs.pointerEvents, inline: el.style.pointerEvents || '', source: cs.pointerEvents === 'none' && parentPe !== 'none' ? 'SETS none here' : '', attrs: [...el.attributes].filter(a => /inert|data-|hidden|aria-hidden/.test(a.name)).map(a => a.name + '=' + String(a.value).slice(0, 24)).join(' ') }); }
    const rules = [];
    const target = chain.find(c => c.source);
    const node = back && (() => { for (let el = back; el; el = el.parentElement) { const cs = getComputedStyle(el); const parentPe = el.parentElement ? getComputedStyle(el.parentElement).pointerEvents : 'auto'; if (cs.pointerEvents === 'none' && parentPe !== 'none') return el; } return null; })();
    if (node) for (const sheet of document.styleSheets) { let list; try { list = sheet.cssRules; } catch { continue; } const walk = rs => { for (const rule of rs) { if (rule.cssRules && !rule.selectorText) { walk(rule.cssRules); continue; } if (rule.style && /none/.test(rule.style.pointerEvents || '') && rule.selectorText) { try { if (node.matches(rule.selectorText)) rules.push((rule.parentRule && rule.parentRule.conditionText ? '@' + rule.parentRule.conditionText + ' ' : '') + rule.cssText.slice(0, 260)); } catch {} } } }; walk(list); }
    return {chain: chain.slice(0, 10), setter: target, rules, inertAncestors: [...document.querySelectorAll('[inert]')].map(e => e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 60))};
  });
  console.log(JSON.stringify(info, null, 1));
} finally {
  try { if (app) await app.close(); } catch {}
  if (slot) await fs.unlink(slot).catch(() => {});
}
