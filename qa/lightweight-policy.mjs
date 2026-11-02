// Pure validation used by the native rig; importing this never launches a browser.
export const REAL_SITES = Object.freeze([
  'https://en.wikipedia.org/wiki/Web_browser', 'https://github.com/electron/electron',
  'https://news.ycombinator.com/', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
  'https://www.bbc.com/news', 'https://stackoverflow.com/questions', 'https://www.theverge.com/',
  'https://www.youtube.com/', 'https://www.apple.com/', 'https://www.nytimes.com/',
]);
export function cpuInterval(before, after) {
  const seconds = (after.cpuSnapshotEpochMs - before.cpuSnapshotEpochMs) / 1000;
  if (!before.pids || !after.pids || !Number.isFinite(seconds) || seconds <= 0 ||
      !Number.isFinite(before.cpuSeconds) || !Number.isFinite(after.cpuSeconds) || after.cpuSeconds < before.cpuSeconds)
    throw new Error('Invalid owned process CPU samples');
  return {seconds, percentOfOneCore: +((after.cpuSeconds - before.cpuSeconds) / seconds * 100).toFixed(2)};
}
export function pageFailure(page) {
  if (page.navigationError) return 'navigation: ' + page.navigationError;
  if (page.nativeError) return 'native: ' + page.nativeError;
  if (page.failedRequest) return 'request: ' + page.failedRequest;
  if (!/^https?:\/\//.test(page.url || '')) return 'not a website document';
  if (!['interactive', 'complete'].includes(page.readyState)) return 'document not ready';
  if (!Number.isFinite(page.status) || page.status < 200 || page.status >= 400) return 'HTTP status unavailable or unsuccessful';
  if (page.interstitial) return 'challenge, sign-in wall or browser error document';
  return null;
}
export function validatePages(pages, expected = 10) {
  if (pages.length !== expected || new Set(pages.map(p => p.targetId)).size !== expected)
    throw new Error(`Expected ${expected} distinct website targets`);
  const failures = pages.map(p => ({requested: p.requested, reason: pageFailure(p)})).filter(p => p.reason);
  if (failures.length) throw new Error('Invalid website content: ' + JSON.stringify(failures));
}
