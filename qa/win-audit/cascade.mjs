// A window opened over another cascades (+24/+24), wraps inside the work area, never lands exactly on another window or off-screen.
import {launch, sleep, poll} from './lib.mjs';
const app = await launch({name: 'cs', settings: {onboardingComplete: true, reducedMotion: true}, width: 1100, height: 650});
try {
  await sleep(600);
  const area = await app.main(({screen}) => screen.getPrimaryDisplay().workArea);
  for (let i = 0; i < 9; i++) { await app.ui.evaluate(() => window.acira.openWindow('normal')); await sleep(900); }
  const wins = await app.main(({BaseWindow}) => BaseWindow.getAllWindows().map(w => w.getBounds()));
  console.log('work area', JSON.stringify(area)); let bad = 0;
  const seen = new Set();
  for (const b of wins) { const out = b.x < area.x || b.y < area.y || b.x + b.width > area.x + area.width + 1 || b.y + b.height > area.y + area.height + 1, key = b.x + ',' + b.y; if (out || seen.has(key)) { bad++; console.log('PROBLEM', JSON.stringify(b), out ? 'outside work area' : 'duplicate position'); } seen.add(key); }
  console.log('windows', wins.length, 'positions', [...seen].join(' '), 'problems', bad);
} finally { await app.close(); }
