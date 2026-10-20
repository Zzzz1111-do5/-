'use strict';
// 事件绑定：鼠标、触屏、键盘
function bindInput() {
  const cv = R.cv;
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => { e.preventDefault(); const { sx, sy } = evPos(e); camZoomAt(sx, sy, Math.exp(-e.deltaY * .0015)); }, { passive: false });

  cv.addEventListener('pointerdown', e => {
    const { sx, sy } = evPos(e), p = toWorld(sx, sy);
    U.mouse = p;
    cv.setPointerCapture(e.pointerId);
    if (e.pointerType === 'touch') {
      U.touches.set(e.pointerId, { sx, sy });
      if (U.touches.size === 2) {
        const [a, b] = [...U.touches.values()];
        U.pinch = { d: dist(a.sx, a.sy, b.sx, b.sy), mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2 };
        U.down = null;
      } else U.down = { sx, sy, x: p.x, y: p.y, touch: true, moved: false };
      return;
    }
    if (e.button === 1 || (e.button === 0 && e.altKey)) { U.down = { sx, sy, pan: true }; return; }
    if (e.button === 2) { U.tool === 'amove' || U.tool === 'clear' ? applyTool(p) : issueOrder(p, 'move'); updateHud(); return; }
    if (e.button !== 0) return;
    if (U.tool) { applyTool(p); return; }
    U.down = { sx, sy, x: p.x, y: p.y, add: e.shiftKey };
  });

  cv.addEventListener('pointermove', e => {
    const { sx, sy } = evPos(e);
    if (e.pointerType === 'touch' && U.touches.has(e.pointerId)) {
      U.touches.set(e.pointerId, { sx, sy });
      if (U.pinch && U.touches.size === 2) {
        const [a, b] = [...U.touches.values()], d = dist(a.sx, a.sy, b.sx, b.sy), mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
        camPan(mx - U.pinch.mx, my - U.pinch.my);
        camZoomAt(mx, my, d / U.pinch.d);
        U.pinch = { d, mx, my };
        return;
      }
    }
    const p = toWorld(sx, sy);
    U.mouse = p;
    const D = U.down;
    if (D) {
      if (D.pan || (D.touch && (D.moved || dist(sx, sy, D.sx, D.sy) > 8))) { if (D.touch) D.moved = true; camPan(sx - D.sx, sy - D.sy); D.sx = sx; D.sy = sy; return; }
      if (dist(sx, sy, D.sx, D.sy) > 6) U.box = { x0: Math.min(p.x, D.x), y0: Math.min(p.y, D.y), x1: Math.max(p.x, D.x), y1: Math.max(p.y, D.y) };
    }
    U.hoverText = e.pointerType === 'mouse' ? hoverAt(p) : U.hoverText;
  });

  const up = e => {
    const { sx, sy } = evPos(e), p = toWorld(sx, sy), D = U.down;
    if (e.pointerType === 'touch') {
      U.touches.delete(e.pointerId);
      if (U.touches.size < 2) U.pinch = null;
      if (D && D.touch && !D.moved) { U.mouse = p; U.tool ? applyTool(p) : finishSelect(p, false, true); }
      U.down = null;
      return;
    }
    U.down = null;
    if (!D || D.pan) return;
    finishSelect(p, D.add, false);
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', e => { U.touches.delete(e.pointerId); U.pinch = null; U.down = null; U.box = null; });
  cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { U.mouse = null; U.hoverText = ''; } });
  cv.addEventListener('dblclick', e => {
    const { sx, sy } = evPos(e), id = pickAt(toWorld(sx, sy));
    if (id != null && S.teams.some(q => q.id === id)) { S.sel = [id]; selectUnit(); }
  });

  window.addEventListener('keyup', e => KEYS.delete(e.key));
  window.addEventListener('blur', () => KEYS.clear());
  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input,textarea,select')) return;
    if (e.key.startsWith('Arrow')) { KEYS.add(e.key); e.preventDefault(); return; }
    const k = e.key.toUpperCase();
    if (e.code === 'Space') { e.preventDefault(); togglePause(); }
    else if (/^Digit[1-9]$/.test(e.code)) { e.preventDefault(); const n = e.code.slice(5); e.ctrlKey || e.metaKey || e.altKey ? assignGroup(n) : selectGroup(n); }
    else if (k === 'ESCAPE') { U.tool = null; S.sel = []; updateHud(); }
    else if (k === '=' || k === '+') camZoomAt(CAM.vw / 2, CAM.vh / 2, 1.25);
    else if (k === '-') camZoomAt(CAM.vw / 2, CAM.vh / 2, .8);
    else if (k === 'H') ordersNow('hold');
    else if (k === 'X') ordersNow('retreat');
    else if (k === 'D') { S.sel = S.dd.state !== 'sunk' ? ['DD'] : []; updateHud(); }
    else if (k === 'G') toggleAuto();
    else {
      const tools = { M: 'move', A: 'amove', C: 'clear', F: 'fire', V: 'smoke', R: 'recon', T: 'strike', E: 'rline' };
      if (tools[k]) setTool(tools[k]);
    }
  });
}
