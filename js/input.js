'use strict';
// 事件：左键点选/框选，右键下令（拖拽 = 阵型宽度与朝向），中键或 Alt 拖动平移，滚轮缩放，触屏单指平移、双指缩放
// 编队指挥模式（thpanel.js thuActive：沙盒编辑以外的战役 / 推演）：不再点选、下令单个部队——左键点部队看型号卡并选中它所属的团，
//   左键拖动平移地图，右键只取消穿插选目标；WASD 与方向键移动视角（3D 按镜头朝向）；舰船、航母、编组的快捷键都不再有
//   ——驱逐舰、航母的支援火力改为点舰弹出选项（spui.js），另有 F 舰炮 · T 空袭 · V 对地支援 · R 侦察 · Y 垂发导弹 · I 战术导弹
const WASD = { KeyW: 'ArrowUp', KeyA: 'ArrowLeft', KeyS: 'ArrowDown', KeyD: 'ArrowRight' };
const thUI = () => typeof thuActive === 'function' && thuActive();
function bindInput() {
  const cv = R.cv;
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => { e.preventDefault(); const { sx, sy } = evPos(e); camZoomAt(sx, sy, Math.exp(-e.deltaY * .0015)); }, { passive: false });

  cv.addEventListener('pointerdown', e => {
    const { sx, sy } = evPos(e), p = toWorld(sx, sy);
    if (runHook('pointer', e, 'down', p)) return;
    U.mouse = p;
    cv.setPointerCapture(e.pointerId);
    if (e.pointerType === 'touch') {
      U.touches.set(e.pointerId, { sx, sy });
      if (U.touches.size === 2) {
        const [a, b] = [...U.touches.values()];
        U.pinch = { d: dist(a.sx, a.sy, b.sx, b.sy), mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2, an: Math.atan2(b.sy - a.sy, b.sx - a.sx) };
        U.down = null;
      } else U.down = { sx, sy, x: p.x, y: p.y, touch: true, moved: false };
      return;
    }
    if (e.button === 1 || (e.button === 0 && e.altKey)) { U.down = { sx, sy, pan: true }; return; }
    if (e.button === 2) { if (thUI()) { if (typeof thuCancel === 'function') thuCancel(); return; } U.fdrag = { sx, sy, x0: p.x, y0: p.y, x1: p.x, y1: p.y, on: false }; return; }
    if (e.button !== 0) return;
    if (thUI()) { U.down = { sx, sy, x: p.x, y: p.y, add: e.shiftKey || e.ctrlKey, th: true }; return; }
    if (U.tool) { applyTool(p); return; }
    U.down = { sx, sy, x: p.x, y: p.y, add: e.shiftKey || e.ctrlKey };
  });

  cv.addEventListener('pointermove', e => {
    const { sx, sy } = evPos(e);
    if (e.pointerType === 'touch' && U.touches.has(e.pointerId)) {
      U.touches.set(e.pointerId, { sx, sy });
      if (U.pinch && U.touches.size === 2) {
        const [a, b] = [...U.touches.values()], d = dist(a.sx, a.sy, b.sx, b.sy), mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
        camPan(mx - U.pinch.mx, my - U.pinch.my);
        camZoomAt(mx, my, d / U.pinch.d);
        const an = Math.atan2(b.sy - a.sy, b.sx - a.sx);
        if (typeof V3 === 'object' && V3.on && U.pinch.an != null) { const da = Math.atan2(Math.sin(an - U.pinch.an), Math.cos(an - U.pinch.an)); V3.yawT -= da; V3.yaw = V3.yawT; }   // 3D：双指旋转转向
        U.pinch = { d, mx, my, an };
        return;
      }
    }
    const p = toWorld(sx, sy);
    U.mouse = p;
    if (runHook('pointer', e, 'move', p)) return;
    const F = U.fdrag;
    if (F) { if (dist(sx, sy, F.sx, F.sy) > 10) F.on = true; F.x1 = p.x; F.y1 = p.y; return; }
    const D = U.down;
    if (!D) return;
    if (D.pan || ((D.touch || D.th) && (D.moved || dist(sx, sy, D.sx, D.sy) > (D.th ? 5 : 8)))) { if (D.touch || D.th) D.moved = true; camPan(sx - D.sx, sy - D.sy); D.sx = sx; D.sy = sy; return; }
    if (dist(sx, sy, D.sx, D.sy) > 6) U.box = { x0: Math.min(p.x, D.x), y0: Math.min(p.y, D.y), x1: Math.max(p.x, D.x), y1: Math.max(p.y, D.y) };
  });

  const up = e => {
    const { sx, sy } = evPos(e), p = toWorld(sx, sy), D = U.down, F = U.fdrag;
    if (runHook('pointer', e, 'up', p)) return;
    if (e.pointerType === 'touch') {
      U.touches.delete(e.pointerId);
      if (U.touches.size < 2) U.pinch = null;
      if (D && D.touch && !D.moved) { U.mouse = p; thUI() ? thuClick(p, false) : U.tool ? applyTool(p) : finishSelect(p, false); }
      U.down = null;
      return;
    }
    if (F && e.button === 2) {
      U.fdrag = null;
      const mode = U.tool === 'amove' || U.tool === 'charge' || U.tool === 'clear' ? U.tool : 'move';
      if (F.on) {
        const face = Math.atan2(-(F.x1 - F.x0), F.y1 - F.y0);
        issueOrder({ x: (F.x0 + F.x1) / 2, y: (F.y0 + F.y1) / 2 }, mode, face, dist(F.x0, F.y0, F.x1, F.y1));
      } else issueOrder(p, mode);
      if (U.tool === mode) U.tool = null;
      updateHud();
      return;
    }
    U.down = null;
    if (!D || D.pan) return;
    if (D.th) { if (!D.moved) thuClick(p, D.add); return; }
    finishSelect(p, D.add);
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', e => { U.touches.delete(e.pointerId); U.pinch = null; U.down = null; U.box = null; U.fdrag = null; });
  cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') U.mouse = null; });
  cv.addEventListener('dblclick', () => { if (thUI()) { const F = typeof thF === 'function' && THU.sel.size ? thF([...THU.sel][0]) : null; if (F) thuCenter(F); } else centerOnSel(); });

  window.addEventListener('keyup', e => { KEYS.delete(e.key); if (WASD[e.code]) KEYS.delete(WASD[e.code]); });
  window.addEventListener('blur', () => KEYS.clear());
  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input,textarea,select')) return;
    // 简报 / 结算浮层打开时游戏快捷键不穿透：简报上 Enter / Esc = 进入部署（或关闭帮助）；结算上只放行 Esc / F10（菜单）
    const bf = $('brief'), en = $('end');
    if (bf && !bf.hidden) { if ((e.key === 'Enter' && !(e.target.closest && e.target.closest('#diff'))) || e.key === 'Escape') { e.preventDefault(); $('btnBrief').click(); } return; }
    if (en && !en.hidden) { if (e.key === 'Escape' || e.key === 'F10') runHook('key', e); return; }
    if (e.key.startsWith('Arrow')) { KEYS.add(e.key); e.preventDefault(); return; }
    // WASD：前后左右移动视角（3D 观察者模式里 WASD 归观察者飞行）
    if (WASD[e.code] && !e.ctrlKey && !e.metaKey && !e.altKey && !(typeof V3O === 'object' && V3O.on) && !(e.target.closest && e.target.closest('#sbxPanel'))) { KEYS.add(WASD[e.code]); e.preventDefault(); return; }
    // 编队指挥模式：空降这些直接操控的快捷键不再有；垂发导弹（Y）、战术导弹（I）只在你指挥攻方时保留（舰艇支援见 spui.js）
    if (thUI() && ((/^Key[IY]$/.test(e.code) && S.ctl !== 'p') || (e.shiftKey && /^Key[KPO]$/.test(e.code)))) { e.preventDefault(); return; }
    if (runHook('key', e)) return;
    const k = e.key.toUpperCase();
    if (thUI()) {
      if (e.code === 'Space') { e.preventDefault(); togglePause(); }
      else if (k === 'ENTER') { e.preventDefault(); startBattle(); updateHud(); }
      else if (k === 'ESCAPE') { if (!(typeof thuCancel === 'function' && thuCancel())) { THU.sel.clear(); THU.key = ''; if (typeof thuRender === 'function') thuRender(true); } }
      else if (k === '=' || k === '+') camZoomAt(CAM.vw / 2, CAM.vh / 2, 1.25);
      else if (k === '-') camZoomAt(CAM.vw / 2, CAM.vh / 2, .8);
      else if (k === 'P') objsToggle();
      return;
    }
    if (e.code === 'Space') { e.preventDefault(); togglePause(); }
    else if (k === 'ENTER') { e.preventDefault(); startBattle(); updateHud(); }   // 阻止默认：不再顺带点击有焦点的 HUD 按钮
    else if (/^Digit[1-9]$/.test(e.code)) { e.preventDefault(); const n = e.code.slice(5); e.ctrlKey || e.metaKey || e.altKey ? assignGroup(n) : selectGroup(n); }
    else if (k === 'ESCAPE') { U.tool = null; S.sel = []; updateHud(); }
    else if (k === '=' || k === '+') camZoomAt(CAM.vw / 2, CAM.vh / 2, 1.25);
    else if (k === '-') camZoomAt(CAM.vw / 2, CAM.vh / 2, .8);
    else if (k === 'H') ordersNow('hold');
    else if (k === 'X') ordersNow('retreat');
    else if (k === 'D') { S.sel = S.dd.state !== 'sunk' ? ['DD'] : []; updateHud(); }
    else if (k === 'G') toggleAuto();
    else if (k === 'U') toggleAutoSel();
    else if (k === 'K') { S.sel = S.cv ? ['CV'] : []; updateHud(); }
    else if (k === 'J' && typeof toggleCvAuto === 'function') toggleCvAuto();
    else if (k === 'Z') formNow('line');
    else if (k === 'C') formNow('wedge');
    else if (k === 'B') formNow('loose');
    else if (k === 'P') objsToggle();
    else {
      const tools = { M: 'move', A: 'amove', Q: 'charge', N: 'clear', F: 'fire', S: 'smoke', R: 'recon', T: 'strike', Y: 'bomber', V: 'cas', W: 'fighter', E: 'rline' };
      if (tools[k]) setTool(tools[k]);
    }
  });
}
