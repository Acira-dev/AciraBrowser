(() => {
  const L = window.__lag; L.stop();
  const T0 = __T0__;
  const f = L.frames.filter(t => t >= (L.appear || T0));
  const dts = f.slice(1).map((t, i) => t - f[i]);
  const first400 = []; for (let i = 0; i < f.length - 1; i++) if (f[i] - (L.appear || T0) <= 400) first400.push(f[i + 1] - f[i]);
  const sorted = [...first400].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] || 0;
  return JSON.stringify({ openMs: L.appear ? Math.round(L.appear - T0) : null, frames400: first400.length, medianMs: +med.toFixed(1), maxMs: +(Math.max(0, ...first400)).toFixed(1), over25: first400.filter(d => d > 25).length, over40: first400.filter(d => d > 40).length, worst: first400.map(d => Math.round(d)).sort((a, b) => b - a).slice(0, 4) });
})()
