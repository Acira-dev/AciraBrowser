// Runs INSIDE the Electron main process (loaded as source by qa/l-drag-drop.mjs). Real input only, no synthetic DOM events:
//  pdrag(points)        webContents.sendInputEvent mouseDown, mouseMove(leftButtonDown) in small steps, mouseUp on the chrome view
//                       (the tab strip, sidebar and split drags are pointer drags).
//  html5(from, to)      a real mouse press and move inside one view; Chromium starts the drag itself, Input.setInterceptDrags hands us
//                       its drag data, and Input.dispatchDragEvent delivers dragenter/dragover/drop to the target view.
//  drop(target, point, data)  the same delivery for data that starts outside Acira (a link from another app, text, files).
// Targets are named: 'ui' = the browser view, 'overlay' = menus, or a substring of a page's URL.
({ webContents }) => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const find = part => part === 'ui' ? webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html')
    : webContents.getAllWebContents().find(w => w.getURL().includes(part));
  async function pdrag(points, { step = 16, hold = 120 } = {}) {
    const wc = find('ui'), [x0, y0] = points[0];
    wc.focus();
    wc.sendInputEvent({ type: 'mouseMove', x: x0, y: y0 }); await wait(30);
    wc.sendInputEvent({ type: 'mouseDown', x: x0, y: y0, button: 'left', clickCount: 1 }); await wait(hold);
    let [px, py] = [x0, y0];
    for (const [x, y] of points.slice(1)) {
      const n = Math.max(2, Math.ceil(Math.hypot(x - px, y - py) / 12));
      for (let i = 1; i <= n; i++) { wc.sendInputEvent({ type: 'mouseMove', x: Math.round(px + (x - px) * i / n), y: Math.round(py + (y - py) * i / n), modifiers: ['leftButtonDown'] }); await wait(step); }
      [px, py] = [x, y]; await wait(hold);
    }
    wc.sendInputEvent({ type: 'mouseUp', x: px, y: py, button: 'left', clickCount: 1 });
    await wait(450);
    return 'dragged';
  }
  async function deliver(wc, [x, y], data, over = 4) {
    const dbg = wc.debugger, attached = dbg.isAttached();
    if (!attached) dbg.attach('1.3');
    try {
      const payload = { items: data.items || [], files: data.files, dragOperationsMask: data.mask ?? 0xffff };
      await dbg.sendCommand('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data: payload });
      for (let i = 0; i < over; i++) { await wait(60); await dbg.sendCommand('Input.dispatchDragEvent', { type: 'dragOver', x: x + (i % 2), y, data: payload }); }
      await dbg.sendCommand('Input.dispatchDragEvent', { type: 'drop', x, y, data: payload });
    } finally { if (!attached) dbg.detach(); }
    await wait(500);
  }
  async function drop(target, point, data) {
    const wc = find(target); if (!wc) return 'no target';
    await deliver(wc, point, data); return 'dropped';
  }
  async function html5(source, [x0, y0], to, dropTarget) {
    const wc = find(source); if (!wc) return { error: 'no source' };
    const dbg = wc.debugger, attached = dbg.isAttached(); if (!attached) dbg.attach('1.3');
    let data = null; const onMessage = (_e, method, params) => { if (method === 'Input.dragIntercepted') data = params.data; };
    dbg.on('message', onMessage);
    const mouse = (type, x, y) => dbg.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
    try {
      await dbg.sendCommand('Input.setInterceptDrags', { enabled: true });
      await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0, button: 'none', buttons: 0 });
      await mouse('mousePressed', x0, y0); await wait(80);
      for (let i = 1; i <= 6 && !data; i++) { await mouse('mouseMoved', x0 + i * 4, y0 + i * 3); await wait(40); }
      if (!data) { await mouse('mouseReleased', x0 + 24, y0 + 18); return { error: 'no drag started' }; }
      await deliver(find(dropTarget || source), to, data, 4);
      await mouse('mouseReleased', to[0], to[1]).catch(() => {});
      return { types: data.items.map(i => i.mimeType) };
    } finally {
      dbg.removeListener('message', onMessage);
      await dbg.sendCommand('Input.setInterceptDrags', { enabled: false }).catch(() => {});
      if (!attached) dbg.detach();
    }
  }
  return { pdrag, drop, html5 };
}
