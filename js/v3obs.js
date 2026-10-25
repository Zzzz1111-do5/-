'use strict';
// 观察者模式（3D 地图里，O 键或右上角「观察」按钮）：像第一人称一样在战场上自由飞行观看——
//   鼠标锁定在画面中间（准星），移动鼠标转视角；W / S 前后、A / D 左右平移、空格 / E 上升、C / Q 下降、Shift 加速；Esc 或再按 O 退出。
//   离地越高移动越快；不会钻到地面以下、不会飞出地图。观察时点击不下命令（准星只用来看），推演照常进行
// 镜头：view3d.js v3Camera 在观察时改调 v3oCamera（位置 + 偏航 + 俯仰，竖直向上为上方）
const V3O = { on: false, x: 0, y: 0, z: 0, yaw: 0, pitch: -.3, keys: new Set(), last: 0, drag: null };
const V3O_KEYS = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, KeyQ: 1, KeyE: 1, KeyC: 1, Space: 1, ShiftLeft: 1, ShiftRight: 1 };

function v3oToggle(on = !V3O.on) {
  if (on) {
    if (typeof v3Toggle === 'function' && !V3.on) v3Toggle(true);
    if (!V3.on) return;
    // 从当前的环绕镜头位置接着看：朝向画面中心
    const C = V3.cam || v3Camera(), T = [CAM.x, -CAM.y, v3Ht(CAM.x, CAM.y)], d = [T[0] - C.E[0], T[1] - C.E[1], T[2] - C.E[2]];
    Object.assign(V3O, { on: true, x: C.E[0], y: -C.E[1], z: C.E[2], yaw: Math.atan2(-d[1], d[0]), pitch: clamp(Math.atan2(d[2], Math.hypot(d[0], d[1])), -1.45, .6), last: performance.now() });
    V3O.keys.clear();
    v3oLock();
    if (typeof log === 'function') log('观察者模式：鼠标转视角 · W A S D 移动 · 空格 / C 升降 · Shift 加速 · Esc 退出', 'info', 'v3o', 1);
  } else {
    V3O.on = false; V3O.keys.clear(); V3O.drag = null;
    if (typeof document !== 'undefined' && document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  }
  const b = typeof document !== 'undefined' && document.getElementById('btnObs');
  if (b) { b.classList.toggle('on', V3O.on); b.setAttribute('aria-pressed', V3O.on ? 'true' : 'false'); }
}
// 指针锁定（浏览器不支持或被拒绝时改为按住左键拖动转视角）
function v3oLock() {
  const cv = typeof R === 'object' && R.cv;
  if (cv && cv.requestPointerLock) { try { const p = cv.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* 拖动代替 */ } }
}
const v3oLocked = () => typeof document !== 'undefined' && !!document.pointerLockElement;

// 镜头：位置 (x, y, z)（世界坐标，z 为高度），偏航 yaw（世界坐标角：0 朝东、π/2 朝南），俯仰 pitch（向上为正）
function v3oCamera() {
  const cp = Math.cos(V3O.pitch), f = [cp * Math.cos(V3O.yaw), -cp * Math.sin(V3O.yaw), Math.sin(V3O.pitch)];   // 视线方向（GL 坐标）
  const E = [V3O.x, -V3O.y, V3O.z], z = [-f[0], -f[1], -f[2]];
  const x = v3Norm(v3Cross([0, 0, 1], z)), y = v3Cross(z, x);
  const view = new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -v3Dot(x, E), -v3Dot(y, E), -v3Dot(z, E), 1]);
  const alt = V3O.z - v3Ht(V3O.x, V3O.y), D = clamp(alt * 5, 420, 2400);   // D：雾与贴图范围的尺度（高处看得远）
  const asp = CAM.vw / Math.max(1, CAM.vh), fo = 1 / Math.tan(V3_FOV / 2), n = 1.2, fa = D * 9, nf = 1 / (n - fa);
  const proj = new Float32Array([fo / asp, 0, 0, 0, 0, fo, 0, 0, 0, 0, (fa + n) * nf, -1, 0, 0, 2 * fa * n * nf, 0]);
  return (V3.cam = { E, x, y, z, D, asp, M: v3Mul(proj, view) });
}
// 每帧（view3d.js v3Draw 开头）：按住的键移动，画面中心跟着观察点（贴图、细节档都按它）
function v3oStep(now) {
  const dt = clamp((now - (V3O.last || now)) / 1000, 0, .1);
  V3O.last = now;
  const K = V3O.keys, g = v3Ht(clamp(V3O.x, 0, W - 1), clamp(V3O.y, 0, H - 1)), alt = Math.max(1, V3O.z - g);
  const sp = (K.has('ShiftLeft') || K.has('ShiftRight') ? 3.2 : 1) * clamp(alt * 1.4, 60, 700) * dt;
  const fx = Math.cos(V3O.yaw), fy = Math.sin(V3O.yaw), rx = -fy, ry = fx;
  let mx = 0, my = 0, mz = 0;
  if (K.has('KeyW')) { mx += fx; my += fy; }
  if (K.has('KeyS')) { mx -= fx; my -= fy; }
  if (K.has('KeyD')) { mx += rx; my += ry; }
  if (K.has('KeyA')) { mx -= rx; my -= ry; }
  if (K.has('Space') || K.has('KeyE')) mz += 1;
  if (K.has('KeyC') || K.has('KeyQ')) mz -= 1;
  const l = Math.hypot(mx, my) || 1;
  V3O.x = clamp(V3O.x + mx / l * sp, 0, W); V3O.y = clamp(V3O.y + my / l * sp, 0, H);
  V3O.z = clamp(V3O.z + mz * sp * .8, v3Ht(clamp(V3O.x, 0, W - 1), clamp(V3O.y, 0, H - 1)) + 6, 2600);
  // 画面中心：视线落在地面的点（看天时取前方一段），缩放按离地高度——近处的兵种模型、步兵照常显示
  const cp = Math.cos(V3O.pitch), down = -Math.sin(V3O.pitch), reach = down > .08 ? Math.min(1600, alt / down * cp) : 900;
  CAM.x = clamp(V3O.x + fx * reach, 0, W); CAM.y = clamp(V3O.y + fy * reach, 0, H);
  CAM.z = CAM.fit * clamp(1800 / Math.max(60, alt + reach * .35), 1.2, 9);
}

// 准星与提示（view3d.js v3Overlay 末尾调用，屏幕空间）
function v3oOverlay(ctx) {
  if (!V3O.on) return;
  const x = CAM.vw / 2, y = CAM.vh / 2, col = COL.g;
  ctx.save();
  ctx.strokeStyle = rgba(col, .9); ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (const [a, b] of [[-14, -5], [5, 14]]) { ctx.moveTo(x + a, y); ctx.lineTo(x + b, y); ctx.moveTo(x, y + a); ctx.lineTo(x, y + b); }
  ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, 9, 0, 6.283); ctx.strokeStyle = rgba(col, .45); ctx.stroke();
  ctx.fillStyle = rgba(col, .95); ctx.fillRect(x - 1, y - 1, 2, 2);
  // 准星下：离地高度、方位
  const alt = Math.round(V3O.z - v3Ht(clamp(V3O.x, 0, W - 1), clamp(V3O.y, 0, H - 1))), brg = Math.round(((V3O.yaw * 180 / Math.PI) + 90 + 360) % 360);
  ctx.font = '11px "IBM Plex Mono", "Noto Sans SC", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillStyle = rgba(col, .75); ctx.fillText(`高 ${alt}  方位 ${String(brg).padStart(3, '0')}°  ${typeof gridRef === 'function' ? gridRef(V3O.x, V3O.y) : ''}`, x, y + 18);
  ctx.textBaseline = 'bottom'; ctx.fillStyle = rgba(col, .6);
  ctx.fillText(v3oLocked() ? '观察者模式 · 鼠标转视角 · W A S D 移动 · 空格 / C 升降 · Shift 加速 · Esc 退出' : '观察者模式 · 点一下画面锁定鼠标（或按住左键拖动转视角）· W A S D 移动 · 空格 / C 升降 · Esc 退出', x, CAM.vh - 120);
  ctx.restore();
}

// —— 输入 ——
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('keydown', e => {
    if (!V3O.on || (e.target && e.target.closest && e.target.closest('input,textarea,select'))) return;
    if (V3O_KEYS[e.code]) { V3O.keys.add(e.code); e.preventDefault(); }
  }, true);
  window.addEventListener('keyup', e => V3O.keys.delete(e.code), true);
  window.addEventListener('blur', () => V3O.keys.clear());
  window.addEventListener('mousemove', e => {
    if (!V3O.on) return;
    let dx = 0, dy = 0;
    if (v3oLocked()) { dx = e.movementX || 0; dy = e.movementY || 0; }
    else if (V3O.drag) { dx = e.clientX - V3O.drag[0]; dy = e.clientY - V3O.drag[1]; V3O.drag = [e.clientX, e.clientY]; }
    if (!dx && !dy) return;
    V3O.yaw = Math.atan2(Math.sin(V3O.yaw + dx * .0024), Math.cos(V3O.yaw + dx * .0024));
    V3O.pitch = clamp(V3O.pitch - dy * .0024, -1.5, .75);
  });
  window.addEventListener('mouseup', () => { V3O.drag = null; });
  if (typeof document !== 'undefined') document.addEventListener('pointerlockchange', () => { if (V3O.on && !v3oLocked()) V3O.keys.clear(); });   // Esc 解锁：键全部松开（模式由 Esc 键处理退出）
}
// 游戏的快捷键（input.js runHook('key')）：观察时 W A S D Q E C 空格不触发原来的功能；O 开关；Esc 退出
HOOK.key.push(e => {
  const k = e.key;
  if ((k === 'o' || k === 'O') && !e.ctrlKey && !e.metaKey && !e.altKey && typeof v3Can === 'function' && v3Can()) { v3oToggle(); return true; }
  if (!V3O.on) return false;
  if (k === 'Escape') { v3oToggle(false); return true; }
  if (V3O_KEYS[e.code]) return true;
  return false;
});
// 鼠标：观察时点击不下命令；没锁定时点一下锁定，按住拖动也能转视角
HOOK.pointer.push((e, kind) => {
  if (!V3O.on) return false;
  if (kind === 'down') { if (!v3oLocked()) { v3oLock(); V3O.drag = [e.clientX, e.clientY]; } }
  if (kind === 'up') V3O.drag = null;
  return true;
});
// 退出 3D 地图时一起退出
HOOK.frame.push(() => { if (V3O.on && !V3.on) v3oToggle(false); });

// 右上角 3D 镜头按钮组里加「观察」
function v3oButton() {
  const c = typeof document !== 'undefined' && document.getElementById('v3ctl');
  if (!c) { setTimeout(v3oButton, 200); return; }
  if (document.getElementById('btnObs')) return;
  const b = document.createElement('button');
  b.id = 'btnObs'; b.type = 'button'; b.className = 'tb'; b.textContent = '观察'; b.title = '观察者模式（O）：鼠标转视角，W A S D 移动，空格 / C 升降，Esc 退出'; b.setAttribute('aria-pressed', 'false');
  b.style.minWidth = '48px'; b.style.fontSize = '13px';
  b.addEventListener('click', () => v3oToggle());
  c.appendChild(b);
  const st = document.createElement('style');
  st.textContent = '#btnObs.on { color: var(--bg); background: var(--g); border-color: var(--g); }';
  document.head.appendChild(st);
}
if (typeof document !== 'undefined' && document.addEventListener) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', v3oButton); else setTimeout(v3oButton, 0); }
