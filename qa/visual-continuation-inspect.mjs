// Read-only renderer inspection. Import into a leased native session; this module
// never launches an app, changes preferences, or opens a browser connection.
// Findings require pixel review: text ranges include font leading, and glass
// contrast cannot be established from computed colors alone.
export async function inspectDisclosureLayout(page) {
  return page.evaluate(() => {
    const round = n => Math.round(n * 100) / 100;
    const rect = r => ({x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height)});
    const visible = el => {
      if (el.closest('[aria-hidden="true"],[inert],.popup-vapor')) return false;
      if (!el.checkVisibility({contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true})) return false;
      const r = el.getBoundingClientRect();
      if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p), b = p.getBoundingClientRect();
        if (s.overflowY !== 'visible' && (r.bottom <= b.top || r.top >= b.bottom)) return false;
        if (s.overflowX !== 'visible' && (r.right <= b.left || r.left >= b.right)) return false;
      }
      return true;
    };
    const blocks = [];
    for (const body of document.querySelectorAll('details[open] > .acira-disclosure-body')) {
      if (!visible(body)) continue;
      const runs = [];
      for (const el of body.querySelectorAll('*')) {
        if (!visible(el)) continue;
        const s = getComputedStyle(el);
        for (const node of el.childNodes) {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const r of range.getClientRects()) {
            if (r.width && r.height) runs.push({el, r, text: node.textContent.trim().slice(0, 100), color: s.color});
          }
        }
      }
      const dividers = [];
      for (const el of [body, ...body.querySelectorAll('*')]) {
        if (!visible(el)) continue;
        const s = getComputedStyle(el), r = el.getBoundingClientRect();
        // The shared divider contract paints a 1px gradient at the top. Include
        // borderless nodes: those are precisely what broad overflow scans miss.
        if (s.backgroundImage !== 'none' && /(?:^|\s)1px(?:$|,)/.test(s.backgroundSize) && /^(?:0%|0px) (?:0%|0px)$/.test(s.backgroundPosition)) {
          dividers.push({element: el.className, y: r.top, left: r.left, right: r.right});
        }
      }
      const intersections = [], tightClearances = [];
      for (const line of dividers) for (const run of runs) {
        if (run.r.right > line.left && run.r.left < line.right && run.r.top <= line.y + 1 && run.r.bottom >= line.y) {
          intersections.push({text: run.text, divider: line.element, dividerY: round(line.y), textBounds: rect(run.r)});
        }
        const clearance = run.r.top - (line.y + 1);
        if (run.r.right > line.left && run.r.left < line.right && clearance >= 0 && clearance < 4) {
          tightClearances.push({text: run.text, divider: line.element, clearance: round(clearance), textBounds: rect(run.r)});
        }
      }
      const headings = [...body.querySelectorAll('h3')].filter(visible).map(el => {
        const s = getComputedStyle(el), p = getComputedStyle(el.parentElement);
        return {text: el.textContent.trim().slice(0, 100), color: s.color, parentColor: p.color, bounds: rect(el.getBoundingClientRect()), marginTop: s.marginTop};
      });
      blocks.push({title: body.previousElementSibling?.textContent.trim().slice(0, 100), bounds: rect(body.getBoundingClientRect()), dividers, intersections, tightClearances, headings});
    }
    return {viewport: [innerWidth, innerHeight], openDisclosures: blocks};
  });
}
