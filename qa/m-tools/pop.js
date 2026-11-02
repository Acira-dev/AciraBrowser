(() => {
  const p = [...document.querySelectorAll('.browser-popup')].pop();
  if (!p) return 'NO POPUP';
  const rows = [...p.querySelectorAll('button,[role=menuitem],[role=option],a,label,h1,h2,h3,p,span,div')].filter(e => e.children.length === 0 && e.textContent.trim());
  const seen = new Set(), out = [];
  for (const e of rows) {
    const t = e.textContent.replace(/\s+/g, ' ').trim();
    if (seen.has(t) || t.length > 150) continue;
    seen.add(t);
    const b = e.closest('button,[role=menuitem]');
    const lab = b && b.getAttribute('aria-label');
    out.push(t + (lab && lab !== t ? '  {aria=' + lab + '}' : '') + (b && b.title ? '  {title=' + b.title + '}' : ''));
  }
  return p.className.slice(22) + ' h=' + Math.round(p.getBoundingClientRect().height) + ' sh=' + p.scrollHeight + ' :: ' + out.join(' ¦ ');
})()
