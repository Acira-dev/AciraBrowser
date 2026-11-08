// Sizes like Surfshark's popup: a fixed-width column that is short at first and grows once the page has "loaded its data".
// The mode is read from this extension's localStorage so a rig can switch it between two openings:
//   grow (default)  360 wide; 300 px of rows first, 300 ms later 580 px in all           (the case from the Surfshark report)
//   late            as grow, but the growth comes 1800 ms after the load
//   tall            360 wide, 960 px of rows: taller than the 600 px a popup may be, so a scrollbar is expected
//   wide            900 wide, 300 px tall: wider than the 800 px a popup may be
//   viewport        360 wide, height set from the viewport (100vh) with a 580 px minimum
// "+classic" after the mode (grow+classic) gives the page 15 px scrollbars that take room, as on Windows (a Mac's overlay scrollbars take none).
const [mode, flag] = (() => { try { return (localStorage.getItem('mode') || 'grow').split('+'); } catch { return ['grow']; } })();
if (flag === 'classic') { const style = document.createElement('style'); style.textContent = '::-webkit-scrollbar { width: 15px; height: 15px; background: #e6e6e6 } ::-webkit-scrollbar-thumb { background: #999 }'; document.head.appendChild(style); }
document.getElementById('mode').textContent = mode + (flag ? '+' + flag : '');
if (mode === 'wide') document.body.classList.add('wide');
if (mode === 'tall') document.body.classList.add('tall');
const rows = document.getElementById('rows');
const addRows = count => { while (rows.children.length < count) { const row = document.createElement('div'); row.className = 'row'; row.textContent = 'Row ' + (rows.children.length + 1); rows.appendChild(row); } };
const total = {grow: 580, late: 580, tall: 960, wide: 300, viewport: 580}[mode];
const initial = {grow: 300, late: 300, tall: 960, wide: 300, viewport: 580}[mode];
// 56 header + 48 footer + 4 marker = 108 px of chrome; the rows fill the rest (44 px each, 60 px in tall)
const rowsFor = height => Math.floor((height - 108) / (mode === 'tall' ? 60 : 44));
addRows(rowsFor(initial));
if (mode === 'viewport') { document.documentElement.style.height = '100%'; document.body.style.height = '100%'; document.body.style.minHeight = '580px'; document.getElementById('app').style.minHeight = '100vh'; }
if (mode === 'grow') setTimeout(() => addRows(rowsFor(total)), 300);
if (mode === 'late') setTimeout(() => addRows(rowsFor(total)), 1800);
const report = () => { document.getElementById('size').textContent = innerWidth + 'x' + innerHeight; };
report(); addEventListener('resize', report);
