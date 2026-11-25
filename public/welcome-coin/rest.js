// Beta 14.2 (D127): the seal of a member whose number has no rendered still (above the range of public/seals/H_<rank>_NNNN.webp), drawn ONCE at the stills' own pose (the coin facing front: rotX 0, rotY 0, light 0) by the live coin (live.js: the same three.js
// coin and shader as "Look closer", the rim lettered with the member's own number by ink4.js's relabel hook), framed exactly as the stills (672 px renders of his renderer at supersampling 2: the coin is rendered at 1344 px
// under his camera and halved the way his renderCoin halves it) and sent to the interface as a PNG data URL. This page runs in a throw-away, same-origin, invisible iframe
// of the interface (src/features/feedback/sealRest.ts): the iframe's realm has its own module instances (so every number gets its own lettering: live.js and ink4.js keep one coin per rank) and removing
// the iframe frees the WebGL context, the 4096 px ink canvases and three.js at once. Query: rank (insider|founding), no (the number as the card prints it, "0101"), font (the legend font's URL).
const q = new URLSearchParams(location.search);
const rank = q.get('rank'), no = q.get('no'), font = q.get('font');
const DESIGN = { insider: 'founding', founding: 'insider' };
/** His rim legends as he wrote them (checked before anything is changed) and what they say for the rank: the same table as src/features/welcome/welcomeCoin.ts. */
const LEGEND = {
  insider: { was: ['ACIRA', 'FOUNDING CONTRIBUTOR', 'No. 0001', 'EST. 2026', 'AUTHENTIC'], words: (n) => ['ACIRA', 'INSIDER', n, 'EST. 2026', 'AUTHENTIC'] },
  founding: { was: ['ACIRA', 'INSIDER', 'CERTIFIED MEMBER', 'No. 0001', 'EST. 2026', 'AUTHENTIC'], words: (n) => ['ACIRA', 'FOUNDING', 'CERTIFIED MEMBER', n, 'EST. 2026', 'AUTHENTIC'] },
};
const FRAME = 672, RENDER = 1344;   // the stills: 672 px frame (the coin is 558 px of it), rendered at 2x
const send = (message) => { try { parent.postMessage({ type: 'acira-seal-rest', ...message }, '*'); } catch { /* the parent is gone */ } };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));   // the work is cut into pieces by a turn of this page's loop each, so no piece holds the page's thread for long
(async () => {
  try {
    if (!DESIGN[rank] || !/^\d{4,9}$/.test(no || '')) throw new Error('bad request');
    // the legend font comes only from the interface's own files (same scheme and host as this page, a .woff2): any other value is ignored, not fetched; the validated address is what is written into the style
    const fontUrl = (() => { try { const u = new URL(font || '', location.href); return font && u.protocol === location.protocol && u.host === location.host && /\.woff2$/.test(u.pathname) ? u.href : null; } catch { return null; } })();
    if (fontUrl) {
      const st = document.createElement('style');
      st.textContent = `@font-face{font-family:"Card Legend";src:url(${JSON.stringify(fontUrl)});font-weight:100 900;font-stretch:50% 200%;size-adjust:108%}`;
      document.head.appendChild(st);
      await document.fonts.load('600 40px "Card Legend"'); await document.fonts.load('500 40px "Card Legend"'); await document.fonts.ready;
    }
    await tick();
    const design = DESIGN[rank], rim = LEGEND[rank];
    const ink = await import('./ink4.js'); await tick();
    if (JSON.stringify(ink.LEGEND[design]) !== JSON.stringify(rim.was)) throw new Error('the legend is not the one this page letters');
    const now = rim.words(`No. ${no}`);
    ink.setRelabel((groups) => (JSON.stringify(groups) === JSON.stringify(rim.was) ? now : null));
    await import('./three.module.min.js'); await tick();   // three.js, the coin's scene and the live coin are evaluated one after another, each in a turn of its own (a module graph is evaluated in one go)
    await import('./seal4.js'); await tick();
    const module = await import('./live.js'); await tick();
    let coin;
    try { coin = module.liveSeal(design, design, RENDER); } finally { ink.setRelabel(null); }
    await tick();
    coin.draw(0.0001, 0, 0); coin.draw(0, 0, 0);   // the stills' pose: his rig renders them with rotX 0 / rotY 0 / light 0 (his renderCoin sets mesh.rotation to exactly that); the first call defeats the coin's pose cache
    // his renderCoin's own downscale (seal4.js): the 1344 px render is halved with the canvas' high-quality scaling, then copied to the 672 px frame. The coin is the same geometry under the same camera, so it
    // lands exactly where the stills' coin is (558 of 672 px, centred): nothing is measured or fitted here.
    const half = document.createElement('canvas'); half.width = half.height = FRAME;
    const hx = half.getContext('2d'); hx.imageSmoothingQuality = 'high'; hx.drawImage(coin.canvas, 0, 0, FRAME, FRAME);
    const out = document.createElement('canvas'); out.width = out.height = FRAME;
    const ox = out.getContext('2d', { willReadFrequently: true }); ox.imageSmoothingQuality = 'high'; ox.drawImage(half, 0, 0, FRAME, FRAME);
    if (ox.getImageData(FRAME / 2, FRAME / 2, 1, 1).data[3] < 255) throw new Error('nothing was drawn');
    try { coin.canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* the iframe's removal frees it anyway */ }
    // a data URL, not a blob URL: the interface's policy lets pictures come from its own files and data: URLs, not blob: ones (src/features/feedback/sealRest.ts shows it as an <img>)
    send({ ok: true, dataUrl: out.toDataURL('image/png') });
  } catch (error) { send({ ok: false, error: String(error && error.message || error) }); }
})();
