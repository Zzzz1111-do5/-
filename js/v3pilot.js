'use strict';
// 第一人称驾驶（3D 地图里，P 键或右上角「驾驶」按钮）：055 驱逐舰、歼-35、歼-16D 可以亲自开——
//   镜头放在舰桥 / 座舱，玩家直接操纵，这一个单位的 AI 让出指挥（别的照常推演）；再按 P 换下一个能开的，Esc 退出、交回 AI。
//   飞机（飞控物理引擎 flight.js：六自由度飞行力学 + 电传飞控）：A / D 压杆滚转（松杆保持坡度，小坡度自动改平），S 拉杆、W 推杆（过载指令，
//         电传限制迎角与过载），E / Q 加 / 减油门，按住 Shift 开加力，X 切换飞控正常律 / 直接律（直接律没有保护，会失速）；
//         空格对准星下的地面投弹——歼-35 投精确制导炸弹，防空压制型歼-35 与歼-16D 发反辐射导弹（打准星附近的防空）；起飞、着舰仍由飞行员（AI）完成
//   军舰：A / D 转舵，W / S 车钟加减一档（后退一 · 停车 · 前进一二三），空格主炮打准星下的点，F 垂发导弹（按目标自动选弹）
//   两种都是鼠标看四周（点一下画面锁定鼠标，或按住左键拖动），C 视线回正。手机：屏幕下方出现操纵按钮
// 推演：carrier.js flyPlane、support.js updateDD、units.js updateShips、sandbox.js sbxFireShips 见到 o.fp 就不再替它做主（飞机在 fpFly 里飞，舰在 fpSail 里开）
const V3FP = { on: false, k: null, o: null, keys: new Set(), look: [0, 0], thr: .8, tele: 3, rud: 0, cool: 0, last: 0, drag: null, touch: { x: 0, y: 0, ab: false }, lock: null, law: 'n', ap: false };
const V3FP_KEYS = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, KeyQ: 1, KeyE: 1, KeyC: 1, KeyF: 1, KeyX: 1, Space: 1, ShiftLeft: 1, ShiftRight: 1 };
const FP_TELE = [-.3, 0, .35, .7, 1], FP_TELE_NM = ['后退一', '停车', '前进一', '前进二', '前进三'];
const FP_HUD = '#7dffb0';   // 抬头显示的绿色（两种画面风格都一样，像真的平显）

// —— 能驾驶的单位 ——
// 这个单位正被玩家亲自开着吗（推演各处用它让出指挥；存档里留下的 fp 标记不算）
const fpDriving = o => V3FP.on && !!o && V3FP.o === o;
const fpJet = p => !!p && !p.dead && isFinite(p.x) && p.kind !== 'transport' && (p.v === 'ew' || airMdl(p.kind, p.v).sil === 'j35');
const fp055 = o => !!o && typeof vlsCls === 'function' && vlsCls(o) === '055';
function fpList() {
  const L = [];
  if (S.dd && S.dd.state !== 'sunk' && isFinite(S.dd.x) && S.dd.x > -999 && fp055(S.dd)) L.push({ k: 'ship', o: S.dd });
  for (const s of S.ships || []) if (s.kind === 'dd' && alive(s) && fp055(s)) L.push({ k: 'ship', o: s });
  for (const p of S.planes || []) if (fpJet(p)) L.push({ k: 'air', o: p });
  return L;
}
const fpName = (k, o) => k === 'air' ? airMdl(o.kind, o.v).name : o === S.dd ? `${S.dd.name || '055 型驱逐舰'}` : `${o.label || ''} ${(o.sbxCls && o.sbxCls.name) || '055 型驱逐舰'}`.trim();
const fpShipLen = o => 50 * (((typeof SH_DDC === 'object' && SH_DDC['055']) || {}).k || 1) * ((typeof SHIPV === 'object' && SHIPV.pose[o === S.dd ? 'DD' : o.id] || {}).k || 1);   // 画面里的舰长（与 v3units.js 一致）
const fpShipVmax = o => o === S.dd ? 18 : 22 * (o.spdK || 1);

// 进入 / 换下一个 / 退出
function fpToggle(on = !V3FP.on, next = false) {
  if (on) {
    if (typeof v3Toggle === 'function' && !V3.on) v3Toggle(true);
    if (!V3.on || !S) return;
    if (typeof V3O === 'object' && V3O.on) v3oToggle(false);
    const L = fpList();
    if (!L.length) { log('没有能驾驶的：055 驱逐舰不在海上，歼-35 / 歼-16D 也没有升空（先用 T 键派出攻击机）', 'warn', 'fp0', 3); return; }
    let i = 0;
    if (next && V3FP.on) i = (L.findIndex(e => e.o === V3FP.o) + 1) % L.length;
    else { let bd = Infinity; L.forEach((e, j) => { const d = dist(e.o.x, e.o.y, CAM.x, CAM.y); if (d < bd) { bd = d; i = j; } }); }   // 离画面中心最近的
    fpRelease();
    const E = L[i];
    Object.assign(V3FP, { on: true, k: E.k, o: E.o, look: [0, 0], cool: 0, last: performance.now(), lock: null });
    E.o.fp = true;
    if (E.k === 'ship') { V3FP.tele = 3; V3FP.rud = 0; E.o.fpV = E.o.fpV ?? 0; E.o.moving = false; if (E.o.state === 'move') E.o.state = 'idle'; }
    else { V3FP.thr = .8; V3FP.law = 'n'; E.o.fl = null; }
    V3FP.keys.clear();
    fpLock();
    log(E.k === 'air' ? `第一人称驾驶 ${fpName(E.k, E.o)}：A / D 压杆滚转 · S / W 拉杆 / 推杆 · E / Q 油门（Shift 加力）· X 飞控律 · 空格 投弹 · P 换下一个 · Esc 退出` :
      `第一人称驾驶 ${fpName(E.k, E.o)}：A / D 转舵 · W / S 车钟 · 空格 主炮 · F 垂发导弹 · P 换下一个 · Esc 退出`, 'info', 'fp1', 1);
  } else {
    if (V3FP.on && V3.fc && V3.cam) { const P = fpPose(); if (P) Object.assign(V3.fc, { x: P.x, y: P.y, z: Math.max(P.z, v3Ht(clamp(P.x, 0, W - 1), clamp(P.y, 0, H - 1)) + 20), yaw: P.yaw, yawT: P.yaw, pitch: -.35, pitchT: -.35, cx: null, cy: null }); }   // 退出：自由镜头接着从这里看
    fpRelease();
    Object.assign(V3FP, { on: false, k: null, o: null, drag: null, lock: null });
    V3FP.keys.clear();
    if (typeof document !== 'undefined' && document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  }
  fpUi();
}
// 交回 AI：飞机弹打光了就返航，否则接着原来的任务；舰停在原地待命
function fpRelease() {
  const o = V3FP.o;
  if (!o) return;
  o.fp = false;
  if (V3FP.k === 'air') { o.fl = null; o.pt3 = null; if (!o.dead) o.alt = clamp(o.alt, .3, 1); }   // 交回 AI：物理状态丢掉，按游戏里的简化飞行接着飞
  if (V3FP.k === 'air' && !o.dead && o.phase === 'out' && (o.gbN === 0 || o.dropped) && typeof airSet === 'function') airSet(o, 'rtb');
  if (V3FP.k === 'ship') { o.tx = o.x; o.ty = o.y; o.fpV = 0; }
  V3FP.o = null;
}
function fpLock() {
  const cv = typeof R === 'object' && R.cv;
  if (cv && cv.requestPointerLock && !(typeof V3 === 'object' && V3.coarse)) { try { const p = cv.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* 拖动代替 */ } }
}
const fpLocked = () => typeof document !== 'undefined' && !!document.pointerLockElement;

// —— 推演：飞机（carrier.js flyPlane 在甲板阶段之后调用；返回 true 就不走 AI）：飞控物理引擎（flight.js）——
function fpFly(p, dt) {
  if (!V3FP.on || V3FP.o !== p) { p.fp = false; p.fl = null; return false; }
  if (p.phase !== 'out' && p.phase !== 'loiter' && p.phase !== 'rtb') return false;   // 起飞爬升前、着舰进近：飞行员自己飞
  if (p.phase !== 'out') p.phase = 'out';   // 玩家接手：任务状态回到「出击中」（返航、待机都打断）
  const F = p.fl || flInit(p), K = V3FP.keys, T = V3FP.touch;
  // 杆：按键是开关量，杆量平滑地推过去（键盘也做得出柔和的动作）
  const tx = clamp((K.has('KeyD') ? 1 : 0) - (K.has('KeyA') ? 1 : 0) + T.x, -1, 1), ty = clamp((K.has('KeyS') ? 1 : 0) - (K.has('KeyW') ? 1 : 0) + T.y, -1, 1);
  F.sx += (tx - F.sx) * Math.min(1, dt * 5); F.sy += (ty - F.sy) * Math.min(1, dt * 4);
  if (K.has('KeyE')) V3FP.thr = Math.min(1, V3FP.thr + dt * .5);
  if (K.has('KeyQ')) V3FP.thr = Math.max(0, V3FP.thr - dt * .5);
  const ab = K.has('ShiftLeft') || K.has('ShiftRight') || T.ab;
  // 离开作战区域 400 以外：自动驾驶转回来（压坡度对准地图中心、带一点杆）
  let x = Math.abs(F.sx) < .03 ? 0 : F.sx, y = F.sy;
  V3FP.ap = p.x < -400 || p.x > W + 400 || p.y < -400 || p.y > H + 400;
  if (V3FP.ap) { const e = airAng(Math.atan2(H / 2 - p.y, W / 2 - p.x) - p.heading); x = clamp(Math.sign(e) * Math.min(1, Math.abs(e)) * 1.2 - clamp(p.bank, -1.2, 1.2) * .9, -1, 1); y = .45; }
  const hit = flStep(F, dt, { x, y, r: 0, thr: ab ? 1 : V3FP.thr, ab, law: V3FP.ap ? 'n' : V3FP.law });
  flToGame(p);
  if (hit) airLost(p, `${airMdl(p.kind, p.v).name}${hit === 'sea' ? '坠海' : '撞地坠毁'}`, hit === 'sea');
  return true;
}
// —— 推演：舰（HOOK.step）——
function fpSail(o, dt) {
  const K = V3FP.keys, T = V3FP.touch, ax = clamp((K.has('KeyD') ? 1 : 0) - (K.has('KeyA') ? 1 : 0) + T.x, -1, 1);
  V3FP.rud = ax ? clamp(V3FP.rud + ax * 1.4 * dt, -1, 1) : V3FP.rud - Math.sign(V3FP.rud) * Math.min(Math.abs(V3FP.rud), .9 * dt);
  const vmax = fpShipVmax(o), want = FP_TELE[V3FP.tele] * vmax;
  o.fpV = (o.fpV || 0) + clamp(want - (o.fpV || 0), -1.6 * dt, 1.2 * dt);   // 加减速都慢（几千吨的舰）
  const v = o.fpV, h0 = o.heading ?? -1.57;
  o.heading = airAng(h0 + V3FP.rud * .16 * clamp(Math.abs(v) / vmax * 1.5, .2, 1) * Math.sign(v || 1) * dt);
  const nx = o.x + Math.cos(o.heading) * v * dt, ny = o.y + Math.sin(o.heading) * v * dt;
  if (nx > 20 && nx < W - 20 && ny > 20 && ny < H - 20 && stepCost(ci(nx, ny), 'ship') < Infinity) { o.x = nx; o.y = ny; }
  else if (Math.abs(v) > .5) { o.fpV = 0; log('前方浅滩、礁石或海岸：舰停住了，转舵退出来', 'warn', 'fpgnd', 3); }
  o.tx = o.x; o.ty = o.y; o.wf = o.heading;
  if (o === S.dd) o.moving = false; else if (o.state === 'move') o.state = 'idle';
}
HOOK.step.push(dt => {
  if (!V3FP.on) return;
  const o = V3FP.o;
  V3FP.cool = Math.max(0, V3FP.cool - dt);
  if (!o || (V3FP.k === 'air' ? o.dead || !S.planes.includes(o) : o === S.dd ? S.dd.state === 'sunk' : !alive(o))) {
    log(V3FP.k === 'air' ? (o && o.dead ? '座机被击落，退出第一人称' : '飞机已着舰 / 返回机场，退出第一人称') : '军舰沉没，退出第一人称', 'bad', 'fpend', 2);
    fpToggle(false);
    return;
  }
  if (V3FP.k === 'ship') fpSail(o, dt);
});

// —— 开火 ——
// 准星下的点：锁定的目标（准星 60 像素内的敌人）优先，否则视线落在地面 / 海面的点
function fpAim() {
  const L = V3FP.lock;
  if (L && L.x != null) return { x: L.x, y: L.y, o: L.o };
  if (!V3.cam || typeof v3Pick !== 'function') return null;
  const P = v3Pick(CAM.vw / 2, CAM.vh / 2), o = V3FP.o;
  return P && isFinite(P.x) && dist(P.x, P.y, o.x, o.y) < 1600 ? P : null;
}
function fpFire(alt) {
  if (!V3FP.on || V3FP.cool > 0) return;
  const o = V3FP.o, A = fpAim();
  if (!A) { log('准星没有对着地面或目标', 'warn', 'fpaim', 2); return; }
  if (V3FP.k === 'air') {
    const M = airMdl(o.kind, o.v);
    if (o.gbN == null) o.gbN = M.gbN || 2;
    if (!(o.gbN > 0)) { log('弹舱已空：Esc 退出交回飞行员返航整备', 'warn', 'fpgb', 3); return; }
    const d = dist(o.x, o.y, A.x, A.y), R = Math.max((M.std || 170) * 3, 600);
    if (d > R) { log(`目标太远（${Math.round(d)}，射程 ${R}）`, 'warn', 'fprng', 2); return; }
    o.tx = A.x; o.ty = A.y;
    guidedDrop(o);
    V3FP.cool = 1.4;
    return;
  }
  if (S.phase !== 'battle') { log('开战后才能开火', 'warn', 'fpph', 2); return; }
  const d = dist(o.x, o.y, A.x, A.y);
  if (alt) {   // 垂发导弹：按目标自动选弹，只用这艘舰自己的
    const T = vlsTgtAt(A.x, A.y), pref = T.kind === 'eship' ? ['yj21', 'yj18', 'yj83', 'yj62'] : ['ascm', 'tel', 'typhon', 'airfield', 'coastal'].includes(T.kind) ? ['yj18', 'yj21', 'cj10'] : ['cj10', 'yj18', 'yj21'];
    const k = pref.find(w => vlsHas(o, w));
    if (!k) { log('这艘舰的对陆 / 反舰导弹打光了，等补给舰', 'warn', 'fpvls', 3); return; }
    if (T.kind !== 'eship' && !isLand(A.x, A.y) && !T.id) { log('垂发导弹只打陆上目标或敌舰', 'warn', 'fpvl2', 2); return; }
    vlsUse(o, k);
    msPgm(k, 'p', o.x, o.y, T, 'vls', .5);
    S.stats.shots++;
    log(`${fpName('ship', o)}垂发${VLS_NM[k]}，打 ${gridRef(A.x, A.y)}`, 'info', 'fpv' + k, 1, { x: A.x, y: A.y });
    V3FP.cool = 1.2;
    return;
  }
  if (d > 1000) { log(`超出舰炮射程（${Math.round(d)}，射程 1000）`, 'warn', 'fpgr', 2); return; }
  if (o === S.dd) { if (ddFire(A.x, A.y, false, false)) V3FP.cool = .5; return; }
  if ((o.fpGun || 0) > S.t) { log(`舰炮装填中（${Math.ceil(o.fpGun - S.t)}s）`, 'warn', 'fpgl', 2); return; }
  const sc = 10 + d / 50, n = (o.sbxCls && o.sbxCls.salvo) || 1;
  for (let i = 0; i < n; i++) fireShell(o.x, o.y, A.x + gauss() * sc, A.y + gauss() * sc, 'p', 'naval', 2.2, false, { t: -i * .2 });
  S.fx.push({ kind: 'flash', x: o.x, y: o.y, r: 14, life: 0, max: .5, side: 'p' });
  S.stats.shots++;
  o.fpGun = S.t + 5 / ((o.sbxCls && o.sbxCls.rof) || 1); V3FP.cool = .5;
}

// —— 镜头 ——
// 这一帧镜头在哪：飞机在座舱（机身中线上一点，自己的模型不画），舰在舰桥顶上；yaw 世界坐标角，pitch 向上为正，roll 右压坡度为正
function fpPose() {
  const o = V3FP.o;
  if (!o) return null;
  if (V3FP.k === 'air') {
    if (!o.fl) return { x: o.x, y: o.y, z: v3AirZ(o) + .7, yaw: o.heading, pitch: 0, roll: o.bank || 0 };   // 还在起飞爬升（飞行员在飞）
    const F = o.fl, [phi, th, psi] = flEul(F.q);
    return { x: F.P[1], y: -F.P[0], z: -F.P[2], yaw: Math.atan2(-Math.cos(psi), Math.sin(psi)), pitch: th, roll: phi, F };
  }
  const L = fpShipLen(o), h = o.heading ?? -1.57, t = performance.now() / 1000;
  return { x: o.x + Math.cos(h) * L * .1, y: o.y + Math.sin(h) * L * .1, z: -2.6 + L * .17, yaw: h, pitch: -.03 + Math.sin(t * .7) * .006, roll: Math.sin(t * .5) * .012 };   // 舰随浪轻轻摇
}
// 绕单位轴 k 转 t（罗德里格斯公式）
const fpRot = (v, k, t) => { const c = Math.cos(t), s = Math.sin(t), d = v3Dot(k, v) * (1 - c), x = v3Cross(k, v); return [v[0] * c + x[0] * s + k[0] * d, v[1] * c + x[1] * s + k[1] * d, v[2] * c + x[2] * s + k[2] * d]; };
function v3fpCamera() {
  const P = fpPose() || { x: CAM.x, y: CAM.y, z: 200, yaw: 0, pitch: -.3, roll: 0 };
  let f, u, E = [P.x, -P.y, P.z];
  if (P.F) {   // 飞机：机体轴（物理引擎的四元数）——机头方向、座舱顶方向；镜头在座舱（机身中线前方三成机长、上方一米）
    const R = flRot(P.F.q), A = FL_AC[P.F.k];
    f = [R[3], R[0], -R[6]]; u = [-R[5], -R[2], R[8]];
    E = [E[0] + f[0] * A.L * .3 + u[0] * 1.1, E[1] + f[1] * A.L * .3 + u[1] * 1.1, E[2] + f[2] * A.L * .3 + u[2] * 1.1];
  } else {
    const cp = Math.cos(P.pitch), c0 = [cp * Math.cos(P.yaw), -cp * Math.sin(P.yaw), Math.sin(P.pitch)], r0 = v3Norm(v3Cross(c0, [0, 0, 1]));
    f = c0; u = fpRot(v3Cross(r0, c0), c0, P.roll);   // 舰：随浪轻轻滚转
  }
  // 头部转动（鼠标看四周）：先绕座舱顶方向转（左右看），再绕右侧方向转（抬头低头）
  f = fpRot(f, u, -V3FP.look[0]);
  const r1 = v3Norm(v3Cross(f, u));
  f = fpRot(f, r1, V3FP.look[1]); u = fpRot(u, r1, V3FP.look[1]);
  const z = [-f[0], -f[1], -f[2]], x = v3Norm(v3Cross(u, z)), y = v3Cross(z, x);
  const view = new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -v3Dot(x, E), -v3Dot(y, E), -v3Dot(z, E), 1]);
  const alt = P.z - v3Ht(clamp(P.x, 0, W - 1), clamp(P.y, 0, H - 1)), D = clamp(alt * 5, 520, 2600), rd = v3RD(), fog = [D * 1.3 * rd, D * 2.8 * rd];
  const asp = CAM.vw / Math.max(1, CAM.vh), fo = 1 / Math.tan(V3_FOV / 2), n = .4, fa = Math.max(D * 9, fog[1] * 1.5), nf = 1 / (n - fa);
  const proj = new Float32Array([fo / asp, 0, 0, 0, 0, fo, 0, 0, 0, 0, (fa + n) * nf, -1, 0, 0, 2 * fa * n * nf, 0]);
  return (V3.cam = { E, x, y, z, D, rd, fog, asp, M: v3Mul(proj, view) });
}
// 每帧（view3d.js v3Draw 开头）：画面中心跟着视线落点（贴图、细节档都按它）；准星锁定
function v3fpStep(now) {
  V3FP.last = now;
  const P = fpPose();
  if (!P) return;
  const yaw = P.yaw + V3FP.look[0], pitch = P.pitch + V3FP.look[1], g = v3Ht(clamp(P.x, 0, W - 1), clamp(P.y, 0, H - 1)), alt = Math.max(1, P.z - g);
  const cp = Math.cos(pitch), down = -Math.sin(pitch), reach = down > .08 ? Math.min(1600, alt / down * cp) : 900;
  CAM.x = clamp(P.x + Math.cos(yaw) * reach, 0, W); CAM.y = clamp(P.y + Math.sin(yaw) * reach, 0, H);
  CAM.z = CAM.fit * clamp(1800 / Math.max(60, alt + reach * .35), 1.2, 9);
  V3FP.lock = V3.cam ? fpLockTarget() : null;
}
// 准星附近（60 像素内）最近的已知敌人：工事、车辆、装甲车、敌舰
function fpLockTarget() {
  const cx = CAM.vw / 2, cy = CAM.vh / 2, spec = specAll(), o = V3FP.o;
  let best = null, bs = 60;
  const gz = (x, y) => v3Ht(clamp(x, 0, W - 1), clamp(y, 0, H - 1));
  const cand = (e, x, y, z, nm) => {
    if (dist(x, y, o.x, o.y) > 1600) return;
    const q = v3Proj(x, y, z);
    if (!q || q.f > .97) return;
    const d = Math.hypot(q.x - cx, q.y - cy);
    if (d < bs) { bs = d; best = { o: e, x, y, z, q, nm }; }
  };
  for (const e of S.enemies) if (!e.dead && e.kind !== 'airfield' && (spec || inVision(e.x, e.y) || e.kx != null)) cand(e, e.x, e.y, gz(e.x, e.y) + 2, (typeof KIND_NAME === 'object' && KIND_NAME[e.kind]) || '阵地');
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead && (spec || inVision(v.x, v.y))) cand(v, v.x, v.y, gz(v.x, v.y) + 2, '装甲车辆');
  for (const a of S.armor || []) if (!a.dead && (spec || inVision(a.x, a.y))) cand(a, a.x, a.y, gz(a.x, a.y) + 2, '装甲车');
  for (const e of S.eships || []) if (!e.dead && (spec || inVision(e.x, e.y) || S.t - (e.det ?? -99) < 4)) cand(e, e.x, e.y, 4, (typeof NV_CLS === 'object' && NV_CLS[e.cls] && NV_CLS[e.cls].name) || '敌舰');
  return best;
}

// —— 抬头显示（view3d.js v3Overlay 末尾调用，屏幕空间）——
function v3fpOverlay(ctx) {
  if (!V3FP.on || !V3FP.o) return;
  const o = V3FP.o, w = CAM.vw, h = CAM.vh, cx = w / 2, cy = h / 2, P = fpPose(), col = FP_HUD, f = h / 2 / Math.tan(V3_FOV / 2);
  ctx.save();
  ctx.lineWidth = 1.5; ctx.strokeStyle = rgba(col, .9); ctx.fillStyle = rgba(col, .95);
  ctx.font = '12px "IBM Plex Mono", "Noto Sans SC", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 3;
  const brg = d => Math.round(((d * 180 / Math.PI) + 90 + 720) % 360);
  // 航向带（顶部）
  const hd = P.yaw + V3FP.look[0], b0 = (hd * 180 / Math.PI + 90 + 720) % 360;
  ctx.beginPath(); ctx.moveTo(cx - 160, 34); ctx.lineTo(cx + 160, 34); ctx.stroke();
  for (let a = Math.ceil((b0 - 30) / 5) * 5; a <= b0 + 30; a += 5) {
    const x = cx + (a - b0) * 5.3, n = ((a % 360) + 360) % 360;
    ctx.beginPath(); ctx.moveTo(x, 34); ctx.lineTo(x, n % 10 ? 39 : 43); ctx.stroke();
    if (n % 30 === 0) ctx.fillText(n === 0 ? '北' : n === 90 ? '东' : n === 180 ? '南' : n === 270 ? '西' : String(n).padStart(3, '0'), x, 24);
  }
  ctx.beginPath(); ctx.moveTo(cx, 46); ctx.lineTo(cx - 5, 53); ctx.lineTo(cx + 5, 53); ctx.closePath(); ctx.fill();
  ctx.fillText(String(brg(hd)).padStart(3, '0') + '°', cx, 62);
  if (V3FP.k === 'air') {
    // 俯仰梯：每 5°一道，随坡度转（地平线那道长）
    const rl = P.roll, pc = P.pitch + V3FP.look[1];
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-rl);
    for (let a = -30; a <= 30; a += 5) {
      const y = (pc - a * Math.PI / 180) * f;
      if (Math.abs(y) > h * .38) continue;
      const L = a === 0 ? 150 : 46, g = a === 0 ? 0 : 26;
      ctx.beginPath();
      if (a < 0) ctx.setLineDash([6, 5]);
      ctx.moveTo(-g - L, y); ctx.lineTo(-g, y); ctx.moveTo(g, y); ctx.lineTo(g + L, y); ctx.stroke(); ctx.setLineDash([]);
      if (a) { ctx.fillText(String(a), -g - L - 14, y); ctx.fillText(String(a), g + L + 14, y); }
    }
    ctx.restore();
    // 飞机符号（准星）
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, 6.283); ctx.moveTo(cx - 22, cy); ctx.lineTo(cx - 6, cy); ctx.moveTo(cx + 6, cy); ctx.lineTo(cx + 22, cy); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy - 13); ctx.stroke();
    // 速度、马赫、过载、迎角、高度、油门、飞控、弹药；告警：失速、拉起、离开作战区域
    const M = airMdl(o.kind, o.v), F = P.F, gz = v3Ht(clamp(P.x, 0, W - 1), clamp(P.y, 0, H - 1)), agl = Math.round(P.z - Math.max(gz, -2.6));
    const kmh = Math.round((F ? F.Va : o.spd * airK(o)) * 3.6);
    ctx.textAlign = 'right'; ctx.fillText(`${kmh} km/h`, cx - 190, cy); ctx.strokeRect(cx - 262, cy - 12, 80, 24);
    ctx.textAlign = 'left'; ctx.fillText(`${agl} 米`, cx + 190, cy); ctx.strokeRect(cx + 182, cy - 12, 80, 24);
    if (F) {
      ctx.textAlign = 'right'; ctx.fillText(`M ${F.M.toFixed(2)}`, cx - 190, cy + 24); ctx.fillText(`G ${F.nz.toFixed(1)}`, cx - 190, cy + 42);
      ctx.textAlign = 'left'; ctx.fillText(`α ${(F.a * 57.3).toFixed(1)}°`, cx + 190, cy + 24);
      // 速度矢量（飞行轨迹）标记：相对机头偏迎角、侧滑那么多
      const fx = cx + F.b * f, fy = cy + F.a * f;   // 镜头跟机体一起滚转：屏幕的上下左右就是机体的上下左右
      ctx.beginPath(); ctx.arc(fx, fy, 5, 0, 6.283); ctx.moveTo(fx - 13, fy); ctx.lineTo(fx - 5, fy); ctx.moveTo(fx + 5, fy); ctx.lineTo(fx + 13, fy); ctx.moveTo(fx, fy - 5); ctx.lineTo(fx, fy - 10); ctx.stroke();
    }
    const gb = o.gbN ?? (M.gbN || 2), wn = M.sead ? '反辐射导弹' : '精确制导炸弹';
    ctx.textAlign = 'left';
    ctx.fillText(`油门 ${Math.round(V3FP.thr * 100)}%${F && F.ab ? '  加力' : ''}`, cx - 262, cy + 70);
    ctx.fillText(`飞控 ${V3FP.law === 'd' ? '直接律（无保护）' : '正常律'}`, cx - 262, cy + 88);
    ctx.fillText(`${wn} × ${gb}`, cx - 262, cy + 106);
    ctx.fillText(`${M.name}`, cx - 262, cy + 124);
    // 告警：拉起（照现在的下降率 4 秒内撞地）、失速、离开作战区域
    const blink = (performance.now() / 300 | 0) % 2, warn = [];
    if (F && F.V[2] > 1 && agl / F.V[2] < 4) warn.push('拉起  PULL UP');
    if (F && (F.stall > .15 || F.Va < 75)) warn.push('失速  STALL');
    if (V3FP.ap) warn.push('离开作战区域 · 自动返回');
    if (warn.length && blink) { ctx.save(); ctx.fillStyle = rgba(COL.enemy, .95); ctx.font = 'bold 18px "Noto Sans SC", sans-serif'; ctx.textAlign = 'center'; warn.forEach((t, i) => ctx.fillText(t, cx, cy + 90 + i * 24)); ctx.restore(); }
  } else {
    // 舰：准星、车钟、舵、航速、舰炮与垂发
    ctx.beginPath();
    for (const [a, b] of [[-18, -6], [6, 18]]) { ctx.moveTo(cx + a, cy); ctx.lineTo(cx + b, cy); ctx.moveTo(cx, cy + a); ctx.lineTo(cx, cy + b); }
    ctx.stroke();
    const kn = Math.round(Math.abs(o.fpV || 0) * 1.94), V = vlsOf(o) || {}, gunT = o === S.dd ? S.dd.cool : Math.max(0, (o.fpGun || 0) - S.t);
    ctx.textAlign = 'left';
    const rows = [`${fpName('ship', o)}`, `车钟 ${FP_TELE_NM[V3FP.tele]}  航速 ${kn} 节${(o.fpV || 0) < -.1 ? '（后退）' : ''}`, `舵 ${V3FP.rud > .05 ? '右' : V3FP.rud < -.05 ? '左' : '正'}舵 ${Math.round(Math.abs(V3FP.rud) * 35)}°`,
      `主炮 ${gunT > 0 ? '装填 ' + Math.ceil(gunT) + 's' : '就绪'}`, `垂发  长剑-10 ${V.cj10 ?? 0} · 鹰击-18A ${V.yj18 ?? 0} · 鹰击-21 ${V.yj21 ?? 0} · 红旗-9B ${V.sam ?? 0}`];
    rows.forEach((t, i) => ctx.fillText(t, 22, h - 120 + i * 18));
    // 舵角指示
    ctx.strokeRect(cx - 80, h - 40, 160, 8); ctx.fillRect(cx - 2 + V3FP.rud * 78, h - 44, 4, 16);
  }
  // 锁定的目标：四角框 + 名称、距离
  const Lk = V3FP.lock;
  if (Lk && Lk.q) {
    const q = Lk.q, r = 18, d = Math.round(dist(o.x, o.y, Lk.x, Lk.y));
    ctx.strokeStyle = rgba(COL.enemy, .95); ctx.fillStyle = rgba(COL.enemy, .95); ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(q.x + sx * r, q.y + sy * (r - 7)); ctx.lineTo(q.x + sx * r, q.y + sy * r); ctx.lineTo(q.x + sx * (r - 7), q.y + sy * r); }
    ctx.stroke(); ctx.textAlign = 'center'; ctx.fillText(`${Lk.nm}  ${d}`, q.x, q.y + r + 12);
  }
  ctx.textAlign = 'center'; ctx.fillStyle = rgba(col, .65); ctx.textBaseline = 'bottom';
  ctx.fillText(V3FP.k === 'air' ? 'A / D 滚转 · S / W 拉杆 / 推杆 · E / Q 油门 · Shift 加力 · X 飞控律 · 空格 投弹 · 鼠标看四周 · C 回正 · P 换下一个 · Esc 退出' :
    'A / D 转舵 · W / S 车钟 · 空格 主炮 · F 垂发导弹 · 鼠标看四周 · C 回正 · P 换下一个 · Esc 退出', cx, h - 8);
  ctx.restore();
}

// —— 输入 ——
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('keydown', e => {
    if (!V3FP.on || (e.target && e.target.closest && e.target.closest('input,textarea,select'))) return;
    if (!V3FP_KEYS[e.code]) return;
    e.preventDefault();
    if (e.repeat) return;
    V3FP.keys.add(e.code);
    if (V3FP.k === 'ship' && (e.code === 'KeyW' || e.code === 'KeyS')) V3FP.tele = clamp(V3FP.tele + (e.code === 'KeyW' ? 1 : -1), 0, FP_TELE.length - 1);   // 车钟：按一下一档
    if (e.code === 'Space') fpFire(false);
    if (e.code === 'KeyF' && V3FP.k === 'ship') fpFire(true);
    if (e.code === 'KeyC') V3FP.look = [0, 0];
    if (e.code === 'KeyX' && V3FP.k === 'air') { V3FP.law = V3FP.law === 'n' ? 'd' : 'n'; log(V3FP.law === 'd' ? '飞控：直接律——没有迎角、过载保护，小心失速' : '飞控：正常律（电传保护）', V3FP.law === 'd' ? 'warn' : 'info', 'fplaw', 1); }
  }, true);
  window.addEventListener('keyup', e => V3FP.keys.delete(e.code), true);
  window.addEventListener('blur', () => V3FP.keys.clear());
  window.addEventListener('mousemove', e => {
    if (!V3FP.on) return;
    let dx = 0, dy = 0;
    if (fpLocked()) { dx = e.movementX || 0; dy = e.movementY || 0; }
    else if (V3FP.drag) { dx = e.clientX - V3FP.drag[0]; dy = e.clientY - V3FP.drag[1]; V3FP.drag = [e.clientX, e.clientY]; }
    if (!dx && !dy) return;
    V3FP.look[0] = clamp(V3FP.look[0] + dx * .0024, -2.6, 2.6); V3FP.look[1] = clamp(V3FP.look[1] - dy * .0024, -1.2, .9);
  });
  window.addEventListener('mouseup', () => { V3FP.drag = null; });
  if (typeof document !== 'undefined') document.addEventListener('pointerlockchange', () => { if (V3FP.on && !fpLocked()) V3FP.keys.clear(); });
}
// 快捷键（input.js runHook('key')）：P 进入 / 换下一个；驾驶时 Esc 退出，W A S D Q E C F 空格不触发原来的功能
HOOK.key.push(e => {
  const k = e.key;
  if ((k === 'p' || k === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && typeof v3Can === 'function' && v3Can() && S && (S.phase === 'battle' || S.phase === 'deploy')) { fpToggle(true, V3FP.on); return true; }
  if (!V3FP.on) return false;
  if (k === 'Escape') { fpToggle(false); return true; }
  if (V3FP_KEYS[e.code]) return true;
  return false;
});
// 鼠标：驾驶时点击不下命令；没锁定时点一下锁定，按住拖动也能看四周
HOOK.pointer.push((e, kind) => {
  if (!V3FP.on) return false;
  if (kind === 'down' && !(e.target && e.target.closest && e.target.closest('#fpPad'))) { if (!fpLocked()) { fpLock(); V3FP.drag = [e.clientX, e.clientY]; } }
  if (kind === 'up') V3FP.drag = null;
  return true;
});
// 退出 3D、换局时一起退出
HOOK.frame.push(() => { if (V3FP.on && (!V3.on || !S || (V3FP.o && V3FP.k === 'air' && !S.planes.includes(V3FP.o) && !V3FP.o.dead))) fpToggle(false); });
HOOK.newGame.push(() => { if (V3FP.on) fpToggle(false); });

// —— 界面：3D 镜头按钮组里的「驾驶」、手机上的操纵按钮 ——
function fpUi() {
  if (typeof document === 'undefined') return;
  const b = document.getElementById('btnFp');
  if (b) { b.classList.toggle('on', V3FP.on); b.setAttribute('aria-pressed', V3FP.on ? 'true' : 'false'); }
  let pad = document.getElementById('fpPad');
  const show = V3FP.on && typeof V3 === 'object' && V3.coarse;
  if (!show) { if (pad) pad.hidden = true; return; }
  if (!pad) {
    pad = document.createElement('div'); pad.id = 'fpPad'; pad.className = 'ov';
    const st = document.createElement('style');
    st.textContent = '#fpPad { position: fixed; left: 0; right: 0; bottom: 64px; display: flex; justify-content: space-between; padding: 0 max(12px, env(safe-area-inset-left, 0px)); pointer-events: none; z-index: 30; }' +
      '#fpPad .g { display: grid; grid-template-columns: repeat(3, 58px); gap: 8px; pointer-events: auto; }' +
      '#fpPad button { height: 52px; border-radius: 10px; border: 1px solid rgba(125,255,176,.6); background: rgba(4,20,12,.55); color: #7dffb0; font: 600 15px "Noto Sans SC", sans-serif; touch-action: none; }' +
      '#fpPad button.on { background: rgba(125,255,176,.35); color: #021; }';
    document.head.appendChild(st);
    const mk = (g, t, down, up) => { const x = document.createElement('button'); x.type = 'button'; x.textContent = t; x.addEventListener('pointerdown', ev => { ev.preventDefault(); x.classList.add('on'); down(); }); for (const n of ['pointerup', 'pointercancel', 'pointerleave']) x.addEventListener(n, () => { x.classList.remove('on'); if (up) up(); }); g.appendChild(x); return x; };
    const L = document.createElement('div'), Rg = document.createElement('div'); L.className = Rg.className = 'g';
    const T = V3FP.touch;
    mk(L, '▲', () => { if (V3FP.k === 'ship') V3FP.tele = Math.min(FP_TELE.length - 1, V3FP.tele + 1); else T.y = -1; }, () => { T.y = 0; });   // 飞机：推杆
    mk(L, '◀', () => { T.x = -1; }, () => { T.x = 0; });
    mk(L, '▶', () => { T.x = 1; }, () => { T.x = 0; });
    mk(L, '▼', () => { if (V3FP.k === 'ship') V3FP.tele = Math.max(0, V3FP.tele - 1); else T.y = 1; }, () => { T.y = 0; });
    mk(L, '油门+', () => { V3FP.keys.add('KeyE'); }, () => { V3FP.keys.delete('KeyE'); });
    mk(L, '油门−', () => { V3FP.keys.add('KeyQ'); }, () => { V3FP.keys.delete('KeyQ'); });
    mk(Rg, '开火', () => fpFire(false));
    mk(Rg, '导弹', () => fpFire(true));
    mk(Rg, '加力', () => { T.ab = true; }, () => { T.ab = false; });
    mk(Rg, '回正', () => { V3FP.look = [0, 0]; });
    mk(Rg, '飞控', () => { if (V3FP.k === 'air') V3FP.law = V3FP.law === 'n' ? 'd' : 'n'; });
    mk(Rg, '换', () => fpToggle(true, true));
    mk(Rg, '退出', () => fpToggle(false));
    pad.append(L, Rg);
    document.body.appendChild(pad);
  }
  pad.hidden = false;
}
function fpButton() {
  const c = typeof document !== 'undefined' && document.getElementById('v3ctl');
  if (!c) { setTimeout(fpButton, 200); return; }
  if (document.getElementById('btnFp')) return;
  const b = document.createElement('button');
  b.id = 'btnFp'; b.type = 'button'; b.className = 'tb'; b.textContent = '驾驶'; b.title = '第一人称驾驶（P）：055 驱逐舰、歼-35、歼-16D；再按 P 换下一个，Esc 退出'; b.setAttribute('aria-pressed', 'false');
  b.style.minWidth = '48px'; b.style.fontSize = '13px';
  b.addEventListener('click', () => fpToggle(!V3FP.on));
  c.appendChild(b);
  const st = document.createElement('style');
  st.textContent = '#btnFp.on { color: var(--bg); background: var(--g); border-color: var(--g); }';
  document.head.appendChild(st);
}
if (typeof document !== 'undefined' && document.addEventListener) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fpButton); else setTimeout(fpButton, 0); }
