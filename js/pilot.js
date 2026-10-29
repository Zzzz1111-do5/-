'use strict';
// 玩家驾驶歼-35（3D 地图里按 Shift + J 或右上角「驾驶」）：
//   接管：天上有我方歼-35 就接管离镜头最近的一架；都在甲板上就从福建舰派一架（飞行员登机、滑行、电磁弹射，离舰后交给你飞）
//   视角：座舱（v3ck.js：模型自带的座舱，「一平三下」——平显、三块下显、前上方控制板、两块辅助小屏）/ 机后跟随，V 切换；鼠标转头，按住右键或 Z 拉近
//   操纵：W / S（↑ ↓）推杆 / 拉杆，A / D（← →）压坡度，Q / E 方向舵，Shift / Ctrl（滚轮）油门，推满再按住 Shift 开加力，G 起落架，B 减速板
//   武器：1 霹雳-15E 中距弹、2 霹雳-10 近距格斗弹、3 飞腾-8 小直径制导炸弹；Tab 换目标，空格 / 左键发射，X 投干扰弹（红外诱饵 + 箔条）；
//   R 交给 AI 返航，Esc 退出（AI 接着飞）
//   世界尺度与 AI 飞机一致：空中地速是表速的一半（carrier.js AIR_K），过载、重力按真实值——转弯半径约为真实的四分之一，与地图的尺度相称；
//   表速、马赫数按地速的两倍显示（与机型表的速度一致），高度、距离按世界米
// 飞行模型（电传飞控，按过载指令）：拉杆给过载（最大 9 g、推杆 −3 g），低速时升力不够拉不到（失速速度 ~38 米/秒地速）；
//   滚转率最大 3.4 弧度/秒；推力（军用推力 / 加力）减废阻（∝ V²）与诱导阻力（∝ n² / V²）；速度矢量按法向加速度转，机体在速度上方抬一个迎角
const PCF = { g: 9.81, vs: 38, nmax: 9, nmin: -3, pmax: 3.4, rmax: .3, amil: 6.3, aab: 10.6, idle: .05, k0: 2.65e-4, ki: 3300, gearD: 3.4e-4, brkD: 7e-4, almax: .44, tn: .13, tp: .07, ceil: 1050, vmin: 8 };
// 武器（射程按世界米，与 AI 同一套：霹雳-15 560、AIM-120D 480）：off 离轴发射角上限（霹雳-10 有头盔瞄准）、spd 飞行速度、n 默认挂载
const PC_W = {
  pl15: { nm: '霹雳-15E', ab: 'PL-15E', k: 'aa', rmax: 560, rmin: 70, off: 1.05, spd: 640, pk: 1, n: 4 },
  pl10: { nm: '霹雳-10', ab: 'PL-10', k: 'aa', rmax: 230, rmin: 22, off: 1.4, spd: 700, pk: 1.05, ir: true, n: 2 },
  ft8: { nm: '飞腾-8', ab: 'FT-8', k: 'ag', rmax: 300, rmin: 30, off: 1.25, n: 2 }
};
const PC_RADAR = 620;   // 机载有源相控阵雷达：对非隐身目标的探测 / 锁定距离（世界米；隐身目标按 airwar.js 同一换算打折）
const PC_FUEL = 6200;   // 内油（公斤）
const PC = {
  on: false, p: null, wait: false, view: 'ck', keys: new Set(), look: [0, 0], lookT: [0, 0], zoom: 0, orbit: [0, -.18],
  sx: 0, sy: 0, sr: 0, thr: .8, ab: 0, abHold: 0, eng: .8, abL: 0, brk: 0, n: 1, pr: 0, yr: 0, V: 100, al: 0,
  P: [0, 0, 0], F: [1, 0, 0], L: [0, 1, 0], U: [0, 0, 1], gear: 0, fuel: PC_FUEL,
  wpn: 'pl15', ld: { pl15: 4, pl10: 2, ft8: 2 }, tgt: null, fireT: 0, mode: 'aa', radarOn: true,
  cm: { n: 40, t: -99 }, msg: '', msgT: -99, warn: '', dead: false, deadT: 0, spd0: 1, t0: 0, out: 0, touch: { on: false, x: 0, y: 0, id: null }, drag: null
};
const pcOn = () => PC.on && !!PC.p;
const pcFlying = () => PC.on && !!PC.p && !!PC.p.pc && !PC.dead;
const pcIsJ35 = p => !!p && typeof airSilKey === 'function' && airSilKey(p.kind, p.v) === 'j35';
// 消息：战报一条 + 平显 / 座舱里闪一下
function pcSay(t, kind = 'info', key, gap = 1.5) {
  PC.msg = t; PC.msgT = S ? S.t : 0;
  if (typeof log === 'function' && S) log(t, kind, key || 'pc:' + t, gap);
}

// —— 进入 / 退出 ——
function pcCan() { return !!S && S.phase === 'battle' && !S.over && (typeof v3Can !== 'function' || v3Can()); }
function pcStart() {
  if (PC.on) { pcStop('exit'); return; }
  if (!pcCan()) { if (typeof log === 'function' && S) log('开战后才能驾驶歼-35', 'warn', 'pc0', 2); return; }
  if (typeof v3Toggle === 'function' && !V3.on) v3Toggle(true);
  if (typeof V3 !== 'object' || !V3.on) return;
  if (typeof V3O === 'object' && V3O.on && typeof v3oToggle === 'function') v3oToggle(false);
  // 天上的歼-35：离镜头最近的一架
  const E = V3.cam ? V3.cam.E : [CAM.x, -CAM.y, 0];
  const air = (S.planes || []).filter(p => !p.dead && pcIsJ35(p) && ['out', 'loiter', 'rtb', 'hold'].includes(p.phase) && !p.afPh && isFinite(p.x));
  air.sort((a, b) => Math.hypot(a.x - E[0], -a.y - E[1]) - Math.hypot(b.x - E[0], -b.y - E[1]));
  if (air.length) { pcBegin(air[0], false); return; }
  // 都在甲板上：从航母派一架（执行原来的打击任务流程起飞，离舰后交给玩家）
  const c = S.cv, tx = c ? clamp(c.x, 60, W - 60) : W / 2, ty = c ? clamp(c.y - 1400, 60, H - 60) : H / 2;
  const n0 = (S.planes || []).length;
  if (typeof launchPlane === 'function' && launchPlane('strike', tx, ty)) {
    const p = S.planes.slice(n0).find(o => pcIsJ35(o)) || S.planes[S.planes.length - 1];
    if (p && pcIsJ35(p)) { pcBegin(p, true); return; }
  }
  if (typeof log === 'function') log('现在没有能驾驶的歼-35（都在出击、整备或已损失）', 'warn', 'pc1', 3);
}
function pcBegin(p, fresh) {
  Object.assign(PC, { on: true, p, wait: true, fresh: !!fresh, view: 'ck', dead: false, look: [0, 0], lookT: [0, 0], zoom: 0, orbit: [0, -.18], tgt: null, warn: '', out: 0, spd0: S.speed || 1, t0: S.t });
  PC.keys.clear();
  p.pcWant = true;
  // 挂载：新起飞的按制空挂（主弹舱 4 枚霹雳-15E + 2 枚飞腾-8，两侧弹舱各 1 枚霹雳-10）；半路接管的打击机照它舱里剩的飞腾-8
  const M = typeof airMdl === 'function' ? airMdl(p.kind, p.v) : {};
  PC.ld = fresh || p.gbN == null ? { pl15: PC_W.pl15.n, pl10: PC_W.pl10.n, ft8: PC_W.ft8.n } : { pl15: 0, pl10: PC_W.pl10.n, ft8: Math.max(0, p.gbN ?? M.gbN ?? 0) };
  PC.wpn = PC.ld.pl15 > 0 ? 'pl15' : PC.ld.pl10 > 0 ? 'pl10' : 'ft8'; PC.mode = PC_W[PC.wpn].k;
  PC.fuel = PC_FUEL; PC.cm.n = 40; PC.cm.t = -99;
  if (p.phase === 'cat' || p.phase === 'roll') pcSay('歼-35 在福建舰甲板上准备弹射，离舰后由你驾驶（F 快进）', 'info', 'pcw', 3);
  else pcTake(p);
  pcUi(true);
  if (typeof v3ckReset === 'function') v3ckReset();
}
// 接过飞行：从这架飞机此刻的位置、航向、速度、高度、姿态开始
function pcTake(p) {
  PC.wait = false; p.pc = true; delete p.pcWant; delete p.pcZr;
  if (PC.fresh) p.gbN = 0;   // 新起飞的这架按玩家的挂载，原来的打击任务不再自动投弹
  const h = p.heading || 0, z = typeof v3AirZ === 'function' ? v3AirZ(p) : 200, L = typeof v3dLaunch === 'function' ? v3dLaunch(p) : null;
  const k = typeof airK === 'function' ? airK(p) : .5, V = Math.max(60, (p.spd || 200) * k);
  const g = L ? clamp(L.pitch - .12, 0, .3) : 0;   // 刚离舰：带着爬升角
  PC.P = [p.x, -p.y, z + (L ? L.dz : 0)];
  PC.F = [Math.cos(g) * Math.cos(h), -Math.cos(g) * Math.sin(h), Math.sin(g)];
  PC.U = [-Math.sin(g) * Math.cos(h), Math.sin(g) * Math.sin(h), Math.cos(g)];
  pcOrtho();
  PC.V = V; PC.n = Math.cos(g); PC.pr = 0; PC.yr = 0; PC.sx = PC.sy = PC.sr = 0; PC.al = .08;
  PC.gear = L && L.gear ? 1 : (p.alt ?? 1) < .2 ? 1 : 0;
  delete p.lT;   // 离舰剖面（v3det.js v3dLaunch）是给 AI 飞的画面用的，玩家接手后按飞行模型
  PC.thr = L ? 1 : .82; PC.ab = L ? 1 : 0; PC.eng = PC.thr; PC.abL = PC.ab;
  S.speed = 1;   // 自己飞的时候游戏按真实时间走（退出时恢复进入前的速度）
  pcSync(p);
  pcSay(`你接管了${typeof airName === 'function' ? airName(p.kind, p.v) : '歼-35'}：W S 俯仰，A D 滚转，Shift / Ctrl 油门，Tab 选目标，空格发射，V 换视角，Esc 退出`, 'info', 'pct', 4);
}
// 退出：how = exit（交给 AI 返航）/ lost（被击落）/ bounds（飞出战区）
function pcStop(how = 'exit') {
  const p = PC.p;
  if (p) {
    delete p.pcWant;
    if (p.pc && !p.dead) {
      p.pc = false; p.pcZr = PC.P[2]; p.pcZt = S.t;   // 交还 AI：画面高度从玩家飞的高度平滑过渡到 AI 的巡航高度（view3d.js v3AirZ）
      p.alt = clamp(p.alt ?? 1, .3, 1); p.spd = Math.max(120, PC.V / (typeof AIR_K === 'number' ? AIR_K : .5)); p.hr = 0;
      p.tg = null; p.ar = false; p.dropped = true; p.egT = 0;
      if (typeof airSet === 'function') airSet(p, 'rtb');
      if (how !== 'lost' && typeof log === 'function') log(how === 'bounds' ? '飞出战区太远：自动驾驶接管，歼-35 返航' : '歼-35 交还自动驾驶，返航着舰', 'info', 'pcx', 2);
    }
    p.pc = false;
  }
  if (S && PC.on) S.speed = PC.spd0 || 1;
  // 镜头停在飞机后上方，看得见它（自由镜头接着用）
  if (p && typeof V3 === 'object' && V3.fc && isFinite(p.x)) {
    const h = p.heading || 0, z = typeof v3AirZ === 'function' ? v3AirZ(p) : 200;
    Object.assign(V3.fc, { x: p.x - Math.cos(h) * 120, y: p.y - Math.sin(h) * 120, z: z + 45, yaw: h, yawT: h, pitch: -.3, pitchT: -.3, cx: null, cy: null });
  }
  PC.on = false; PC.p = null; PC.wait = false; PC.keys.clear(); PC.drag = null; PC.touch.on = false;
  if (typeof document !== 'undefined' && document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  pcUi(false);
}
// carrier.js airLost 里调：自己驾驶的飞机被击落 / 坠毁——弹射跳伞，镜头拉到机外看残骸，4 秒后回到指挥视角
function pcLost(p) {
  if (!PC.on || PC.p !== p) return;
  PC.dead = true; PC.deadT = S.t; PC.view = 'ext';
  p.pc = false;
  pcSay('飞机被击中——弹射跳伞！', 'bad', 'pcl', 3);
}

// —— 每帧（main.js frame 在推演步之前调）——
function pcFrame(dt) {
  if (!PC.on) return;
  const p = PC.p;
  if (!p || !S || S.over || (typeof V3 === 'object' && !V3.on)) { pcStop('exit'); return; }
  if (PC.dead) { if (S.t - PC.deadT > 4) pcStop('lost'); return; }
  if (p.dead) { pcStop('lost'); return; }
  if (PC.wait) {   // 甲板上：等弹射离舰
    if (p.phase === 'out') pcTake(p);
    else if (!(p.phase === 'cat' || p.phase === 'roll')) { pcStop('exit'); return; }
    S.speed = PC.keys.has('KeyF') ? 4 : 1;
  }
  pcInput(dt);
  if (p.pc && S.phase === 'battle' && !S.paused && S.briefed) {
    let t = dt * (S.speed || 1);
    while (t > 1e-6) { const h = Math.min(t, 1 / 120); pcPhys(h); t -= h; }
    pcSync(p);
    pcChecks(p, dt * (S.speed || 1));
  }
  // 平滑转头、拉近
  for (let i = 0; i < 2; i++) PC.look[i] += (PC.lookT[i] - PC.look[i]) * Math.min(1, dt * 12);
  PC.zoom += ((PC.keys.has('KeyZ') || PC.zoomM ? 1 : 0) - PC.zoom) * Math.min(1, dt * 8);
}

// 输入 → 杆、舵、油门：键盘按住逐渐推到底、松开回中（像弹簧杆）；触屏摇杆、手柄直接给值
function pcInput(dt) {
  const K = PC.keys, has = c => K.has(c);
  let ty = (has('KeyS') || has('ArrowDown') ? 1 : 0) - (has('KeyW') || has('ArrowUp') ? 1 : 0);
  let tx = (has('KeyD') || has('ArrowRight') ? 1 : 0) - (has('KeyA') || has('ArrowLeft') ? 1 : 0);
  let tr = (has('KeyE') ? 1 : 0) - (has('KeyQ') ? 1 : 0);
  const G = pcPad();
  if (G) { tx = Math.abs(G.x) > .08 ? G.x : tx; ty = Math.abs(G.y) > .08 ? G.y : ty; tr = Math.abs(G.r) > .1 ? G.r : tr; if (G.t != null) { PC.thr = G.t; PC.ab = G.t > .98 && G.ab ? 1 : 0; } }
  if (PC.touch.on) { tx = PC.touch.x; ty = PC.touch.y; }
  const go = (v, t, up, back) => v + clamp(t - v, -(Math.abs(t) < Math.abs(v) ? back : up) * dt, (Math.abs(t) < Math.abs(v) ? back : up) * dt);
  const ana = G || PC.touch.on;
  PC.sx = ana ? tx : go(PC.sx, tx, 3.2, 7); PC.sy = ana ? ty : go(PC.sy, ty, 1.8, 6); PC.sr = go(PC.sr, tr, 3, 6);
  // 油门：Shift 加、Ctrl 减；推满后继续按住 Shift 0.25 秒开加力，Ctrl 先关加力
  if (!G || G.t == null) {
    if (has('ShiftLeft') || has('ShiftRight')) { if (PC.thr < 1) PC.thr = Math.min(1, PC.thr + dt * .55); else if ((PC.abHold += dt) > .25) PC.ab = 1; } else PC.abHold = 0;
    if (has('ControlLeft') || has('ControlRight')) { if (PC.ab) PC.ab = 0; else PC.thr = Math.max(0, PC.thr - dt * .55); }
  }
  PC.brk = has('KeyB') ? 1 : 0;
}
// 手柄（Gamepad API）：左摇杆杆量、右摇杆 x 方向舵、右扳机油门（按到底开加力）；A 发射、B 干扰弹、X 换目标、Y 换武器
function pcPad() {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
  const g = [...navigator.getGamepads()].find(q => q && q.connected && q.axes && q.axes.length >= 2);
  if (!g) return null;
  const b = i => !!(g.buttons[i] && g.buttons[i].pressed), edge = (i, f) => { const k = 'g' + i, on = b(i); if (on && !PC[k]) f(); PC[k] = on; };
  edge(0, pcFire); edge(1, pcFlare); edge(2, () => pcCycle(1)); edge(3, pcNextWpn); edge(9, () => pcStop('exit'));
  const rt = g.buttons[7] ? g.buttons[7].value : null;
  return { x: g.axes[0], y: g.axes[1], r: g.axes.length > 2 ? g.axes[2] : 0, t: rt != null && rt > .02 ? Math.min(1, rt * 1.05) : null, ab: rt > .97 };   // 扳机松开：油门留在原处（键盘照样能调）
}

// —— 飞行模型（GL 坐标：x 东、y 北、z 上；F 速度方向、L 左、U 上）——
function pcOrtho() {
  const F = PC.F, U = PC.U, l = Math.hypot(F[0], F[1], F[2]) || 1;
  F[0] /= l; F[1] /= l; F[2] /= l;
  const d = U[0] * F[0] + U[1] * F[1] + U[2] * F[2];
  U[0] -= d * F[0]; U[1] -= d * F[1]; U[2] -= d * F[2];
  const m = Math.hypot(U[0], U[1], U[2]) || 1; U[0] /= m; U[1] /= m; U[2] /= m;
  PC.L = [U[1] * F[2] - U[2] * F[1], U[2] * F[0] - U[0] * F[2], U[0] * F[1] - U[1] * F[0]];   // 上 × 前 = 左
}
function pcRot(v, w, dt) {   // 绕角速度 w 转 dt 秒（罗德里格斯公式）
  const wl = Math.hypot(w[0], w[1], w[2]), a = wl * dt;
  if (a < 1e-10) return;
  const k0 = w[0] / wl, k1 = w[1] / wl, k2 = w[2] / wl, c = Math.cos(a), s = Math.sin(a), kd = (k0 * v[0] + k1 * v[1] + k2 * v[2]) * (1 - c);
  const x = k1 * v[2] - k2 * v[1], y = k2 * v[0] - k0 * v[2], z = k0 * v[1] - k1 * v[0];
  v[0] = v[0] * c + x * s + k0 * kd; v[1] = v[1] * c + y * s + k1 * kd; v[2] = v[2] * c + z * s + k2 * kd;
}
// 升力能拉出的最大过载（速度的平方成正比）；高度越高空气越稀（只做个意思）
const pcNL = V => (V / PCF.vs) ** 2;
function pcThrust(z) {
  const thin = clamp(1 - (z - PCF.ceil) / 450, .08, 1), dry = PC.fuel <= 0 ? 0 : 1;
  return (PCF.idle + (1 - PCF.idle) * PC.eng) * PCF.amil * thin * dry + PC.abL * (PCF.aab - PCF.amil) * thin * dry;
}
function pcPhys(dt) {
  const K = PCF, F = PC.F, U = PC.U, V = PC.V, nL = pcNL(V);
  // 发动机：转速跟油门有滞后（推油门约 1.4 秒、收油门约 0.9 秒）；加力点火约 0.5 秒
  PC.eng += (PC.thr - PC.eng) * (1 - Math.exp(-dt / (PC.thr > PC.eng ? 1.4 : .9)));
  PC.abL += ((PC.ab && PC.eng > .9 ? 1 : 0) - PC.abL) * (1 - Math.exp(-dt / .5));
  // 电传：拉杆给过载指令，低速时受升力限制；滚转率随速度（太慢时舵效差）
  const nC = PC.sy >= 0 ? 1 + PC.sy * (K.nmax - 1) : 1 + PC.sy * (1 - K.nmin), nT = clamp(nC, Math.max(K.nmin, -nL * .6), Math.min(K.nmax, nL));
  PC.n += (nT - PC.n) * (1 - Math.exp(-dt / K.tn));
  PC.pr += (PC.sx * K.pmax * clamp(V / 70, .25, 1) - PC.pr) * (1 - Math.exp(-dt / K.tp));
  PC.yr += (-PC.sr * K.rmax * clamp(V / 60, .3, 1) - PC.yr) * (1 - Math.exp(-dt / .2));
  // 法向加速度（与速度垂直）：升力 n·g 沿机体上方 + 重力的法向分量
  const g = K.g, gf = -g * F[2], ax = PC.n * g * U[0] - gf * F[0], ay = PC.n * g * U[1] - gf * F[1], az = PC.n * g * U[2] - g - gf * F[2], iv = 1 / Math.max(V, 5);
  const w = [(F[1] * az - F[2] * ay) * iv + PC.pr * F[0] + PC.yr * U[0], (F[2] * ax - F[0] * az) * iv + PC.pr * F[1] + PC.yr * U[1], (F[0] * ay - F[1] * ax) * iv + PC.pr * F[2] + PC.yr * U[2]];
  pcRot(F, w, dt); pcRot(U, w, dt); pcOrtho();
  // 速度：推力 − 阻力 − 重力沿航迹的分量
  const D = K.k0 * V * V + K.ki * PC.n * PC.n / Math.max(V * V, 150) + (PC.gear ? K.gearD * V * V : 0) + (PC.brk ? K.brkD * V * V : 0);
  PC.V = Math.max(K.vmin, V + (pcThrust(PC.P[2]) - D - g * PC.F[2]) * dt);
  for (let i = 0; i < 3; i++) PC.P[i] += PC.F[i] * PC.V * dt;
  PC.al = clamp(K.almax * PC.n / Math.max(nL, .35), -.12, K.almax);   // 迎角：按升力系数的近似
  PC.fuel = Math.max(0, PC.fuel - dt * (.55 + 1.6 * PC.eng + 7.5 * PC.abL));   // 燃油：慢车约 0.6 公斤/秒，军用推力约 2.2，全加力约 9.5
}
// 机体系（速度系绕左轴抬一个迎角）：返回 { F, L, U } 及画模型用的航向、俯仰、滚转（与 v3units.js 实例着色器同一约定）
function pcBody() {
  const c = Math.cos(PC.al), s = Math.sin(PC.al), F = PC.F, U = PC.U, L = PC.L;
  const Fb = [F[0] * c + U[0] * s, F[1] * c + U[1] * s, F[2] * c + U[2] * s], Ub = [U[0] * c - F[0] * s, U[1] * c - F[1] * s, U[2] * c - F[2] * s];
  return { F: Fb, L, U: Ub, h: Math.atan2(-Fb[1], Fb[0]), pt: Math.asin(clamp(Fb[2], -1, 1)), rl: Math.atan2(L[2], Ub[2]) };
}
// 写回飞机：位置、航向、姿态、表速、离地高度（给推演里的防空、空战、导弹用）
function pcSync(p) {
  const B = pcBody(), gz = typeof v3Gnd === 'function' ? v3Gnd(PC.P[0], -PC.P[1]) : 0;
  p.x = PC.P[0]; p.y = -PC.P[1]; p.pcZ = PC.P[2]; p.heading = B.h; p.bank = B.rl;
  p.spd = PC.V / (typeof AIR_K === 'number' ? AIR_K : .5); p.alt = clamp((PC.P[2] - gz) / 230 + .05, .05, 6);
  const trim = typeof AERO === 'object' ? (AERO.d0 + AERO.d1 * PC.al * 180 / Math.PI) * Math.PI / 180 : 0;
  p.pcA = { p: B.pt, r: B.rl, de: clamp(trim - .32 * PC.sy, -.32, .16), da: clamp(.3 * PC.pr, -.2, .2), gear: PC.gear > 0 };
}
// 撞地、出界、油尽、起落架、告警
function pcChecks(p, dt) {
  const x = PC.P[0], y = -PC.P[1], gz = typeof v3Gnd === 'function' ? v3Gnd(clamp(x, 0, W - 1), clamp(y, 0, H - 1)) : -2.6, agl = PC.P[2] - gz;
  if (agl < 1.3) {   // 撞上地面 / 海面 / 航母
    S.fx.push({ kind: 'boom', x, y, r: 26, life: 0, max: 1.2, side: 'p' });
    if (typeof airLost === 'function') airLost(p, '你驾驶的歼-35 撞地坠毁', true);
    return;
  }
  if (PC.gear && agl > 40 && PC.V > 60 && S.t - PC.t0 > 2) { PC.gear = 0; }   // 离舰爬升过 40 米自动收起落架
  // 出界：地图外 600 米起提示，离开 1600 米或在外面待满 25 秒就交给自动驾驶
  const ox = Math.max(0, -x, x - W), oy = Math.max(0, -y, y - H), out = Math.hypot(ox, oy);
  PC.out = out > 600 ? PC.out + dt : 0;
  if (out > 1600 || PC.out > 25) { pcStop('bounds'); return; }
  // 告警（平显、辅助屏的告警灯）：拉起 / 失速 / 导弹来袭 / 被锁定 / 燃油低 / 出界
  const inc = pcThreats();
  const sink = PC.F[2] * PC.V;   // 下沉率（世界米 / 秒，负为下降）
  PC.warn = agl < 60 && sink < -6 && agl / -sink < 5 ? '拉起' : inc.msl.length ? '导弹来袭' : PC.V < PCF.vs * 1.15 && PC.n > pcNL(PC.V) * .8 ? '失速' : PC.fuel < 600 ? '燃油低' : out > 600 ? '返回战区' : inc.lock ? '被锁定' : '';
  // 中距弹的中段制导：发射后前 45% 的飞行时间要雷达一直照着目标，照丢了命中率打六折（数据链勉强接着引导）
  for (const m of S.missiles) if (m.pcw === 'pl15' && !m.done && !m.pcLost && m.t < m.dur * .45) {
    const T = pcAir().find(c => c.o.id === (m.tgt && m.tgt.id));
    if (!T || !T.radar) { m.pcLost = true; m.pk = (m.pk || .4) * .6; pcSay('雷达丢失目标——霹雳-15E 改由数据链中继', 'warn', 'pcpl', 3); }
  }
}

// —— 传感器 ——
// 空中目标：本机雷达（机头 ±60°、上下 ±40°，隐身目标的距离打折）、光电分布孔径（近距离全向）、数据链（预警机、友机、地面雷达看到的）
function pcAir() {
  const out = [], p = PC.p;
  if (!p || !S.eair || !Array.isArray(S.eair.fly)) return out;
  const B = pcBody(), F = B.F, L = B.L, U = B.U;
  for (const a of S.eair.fly) {
    if (a.dead || !isFinite(a.x) || a.ph === 'gnd' || a.ph === 'roll') continue;
    const z = typeof v3AirZ === 'function' ? v3AirZ(a) : 200, dx = a.x - PC.P[0], dy = -a.y - PC.P[1], dz = z - PC.P[2], d = Math.hypot(dx, dy, dz) || 1;
    const fx = (dx * F[0] + dy * F[1] + dz * F[2]) / d, lx = (dx * L[0] + dy * L[1] + dz * L[2]) / d, ux = (dx * U[0] + dy * U[1] + dz * U[2]) / d;
    const off = Math.acos(clamp(fx, -1, 1)), az = Math.atan2(-lx, fx), el = Math.asin(clamp(ux, -1, 1));
    const st = typeof eaStl === 'function' ? eaStl(a) : 1, rr = PC_RADAR * Math.min(1, st * 1.6);
    const radar = PC.radarOn && d < rr && Math.abs(az) < 1.05 && Math.abs(el) < .7;
    const ir = d < 280;
    const dl = (typeof awSeen === 'function' && awSeen('p', a.x, a.y, st)) || !!a.pv;
    if (!radar && !ir && !dl) continue;
    out.push({ k: 'eair', o: a, x: a.x, y: a.y, z, d, off, az, el, radar, ir, dl, st, type: a.type, ftr: typeof eaFtr === 'function' && eaFtr(a.type), nm: (EA_SPEC[a.type] || {}).name || '敌机' });
  }
  return out;
}
// 地面 / 海上目标（飞腾-8）：看得见或已经标定的敌工事、车辆、装甲、敌舰
function pcGnd() {
  const out = [], p = PC.p;
  if (!p) return out;
  const B = pcBody(), F = B.F, vis = (x, y) => typeof inVision === 'function' ? inVision(x, y) : true;
  const add = (k, o, x, y, nm) => {
    const z = typeof v3Ht === 'function' ? Math.max(v3Ht(clamp(x, 0, W - 1), clamp(y, 0, H - 1)), -2.6) : 0;
    const dx = x - PC.P[0], dy = -y - PC.P[1], dz = z - PC.P[2], d = Math.hypot(dx, dy, dz) || 1, dh = Math.hypot(dx, dy);
    if (dh > 1400) return;
    const off = Math.acos(clamp((dx * F[0] + dy * F[1] + dz * F[2]) / d, -1, 1));
    out.push({ k, o, x, y, z, d, dh, off, nm });
  };
  for (const e of S.enemies || []) if (!e.dead && e.kind !== 'airfield') { const v = vis(e.x, e.y); if (v || e.kx != null) add('enemy', e, v ? e.x : e.kx, v ? e.y : e.ky, typeof msName === 'function' ? msName(e) : '敌工事'); }
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead) { const s = vis(v.x, v.y); if (s || v.kx != null) add('veh', v, s ? v.x : v.kx, s ? v.y : v.ky, typeof vehName === 'function' ? vehName(v) : '敌车辆'); }
  for (const a of S.armor || []) if (!a.dead && vis(a.x, a.y)) add('armor', a, a.x, a.y, '敌装甲车');
  for (const s of S.eships || []) if (!s.dead && (vis(s.x, s.y) || s.seen)) add('eship', s, s.x, s.y, s.name || '敌舰');
  return out;
}
const pcCands = () => (PC.mode === 'aa' ? pcAir() : pcGnd());
// 当前锁定的目标（带几何量）；没有或丢了返回 null
function pcTgt() {
  if (!PC.tgt) return null;
  return pcCands().find(c => c.k === PC.tgt.k && c.o.id === PC.tgt.id) || null;
}
// 换目标：按离机头的角度排，Tab 依次往后
function pcCycle(dir = 1) {
  const L = pcCands().filter(c => c.off < 1.6).sort((a, b) => a.off - b.off);
  if (!L.length) { PC.tgt = null; pcSay(PC.mode === 'aa' ? '前方没有发现敌机' : '前方没有已发现的地面目标', 'info', 'pcnt', 2); return; }
  const i = PC.tgt ? L.findIndex(c => c.k === PC.tgt.k && c.o.id === PC.tgt.id) : -1, c = L[((i + dir) % L.length + L.length) % L.length];
  PC.tgt = { k: c.k, id: c.o.id };
}
function pcNextWpn() {
  const order = ['pl15', 'pl10', 'ft8'], i = order.indexOf(PC.wpn);
  for (let k = 1; k <= 3; k++) { const w = order[(i + k) % 3]; if (PC.ld[w] > 0) { pcWpn(w); return; } }
}
function pcWpn(w) {
  if (!PC_W[w]) return;
  if (!(PC.ld[w] > 0)) { pcSay(`${PC_W[w].nm}已经打光`, 'warn', 'pcwe', 1.5); return; }
  const m = PC_W[w].k;
  if (m !== PC.mode) PC.tgt = null;
  PC.wpn = w; PC.mode = m;
}
// 命中率（与 AI 空战同一个基数 AW_PK，再按距离、离轴、目标机动修正）
function pcPk(T, W0) {
  const base = (typeof AW_PK === 'object' && AW_PK[T.type]) || .5, r = T.d / W0.rmax;
  let k = W0.pk * (r < .45 ? 1.25 : r < .8 ? 1.05 : .78) * (T.off > W0.off * .7 ? .85 : 1);
  if (!W0.ir && (T.st || 1) < .6) k *= .85;   // 隐身目标：雷达弹打八五折
  if (W0.ir && T.o.flares > 0) k *= .9;
  return clamp(base * k, .05, .92);
}
// 发射（空格 / 左键 / 手柄 A）
function pcFire() {
  if (!pcFlying()) return;
  const W0 = PC_W[PC.wpn], p = PC.p;
  if (!(PC.ld[PC.wpn] > 0)) { pcSay(`${W0.nm}已经打光`, 'warn', 'pcwe', 1.5); pcNextWpn(); return; }
  if (S.t < PC.fireT) return;
  let T = pcTgt();
  const ok = c => c && c.d <= W0.rmax && c.d >= W0.rmin && c.off <= W0.off && (W0.k !== 'aa' || W0.ir ? true : c.radar);
  if (!ok(T)) {   // 没锁定或锁定的打不了：自动找离机头最近、能打的
    const L = pcCands().filter(ok).sort((a, b) => a.off - b.off);
    if (L.length) { T = L[0]; PC.tgt = { k: T.k, id: T.o.id }; }
  }
  if (!T) { pcSay(PC.mode === 'aa' ? '没有能攻击的敌机（先 Tab 选目标）' : '没有能攻击的地面目标', 'warn', 'pcnt', 1.5); return; }
  if (T.d > W0.rmax) { pcSay(`目标在射程外：${Math.round(T.d)} 米（${W0.nm}最大 ${W0.rmax}）`, 'warn', 'pcrg', 1.2); return; }
  if (T.d < W0.rmin) { pcSay('太近了，导弹来不及解保', 'warn', 'pcrm', 1.2); return; }
  if (T.off > W0.off) { pcSay('目标离机头太偏，转过去再打', 'warn', 'pcof', 1.2); return; }
  if (W0.k === 'aa' && !W0.ir && !T.radar) { pcSay('雷达还没锁定（隐身目标要再靠近）', 'warn', 'pcrd', 1.2); return; }
  let m;
  if (W0.k === 'aa') {
    m = msLaunch('sam', 'p', p.x, p.y, { x: T.x, y: T.y }, { tgt: { k: 'eair', id: T.o.id }, src: 'aam', spd: W0.spd, dur: T.d / W0.spd + 1.6, pk: pcPk(T, W0) });
    if (typeof awStat === 'function') awStat('aamP');
  } else {
    m = typeof msPgm === 'function' ? msPgm('ft8', 'p', p.x, p.y, { x: T.x, y: T.y, k: T.k, id: T.o.id }, 'pc') : null;
  }
  if (!m) return;
  m.pcw = PC.wpn; m.pz0 = PC.P[2]; m.pd0 = Math.max(1, dist(p.x, p.y, T.x, T.y)); m.pzt = T.z;
  PC.ld[PC.wpn]--; PC.fireT = S.t + (W0.k === 'aa' ? .5 : .8);
  pcSay(`${W0.nm}发射——${T.nm}，${Math.round(T.d)} 米`, 'info', 'pcf' + m.id, 0);
  if (!(PC.ld[PC.wpn] > 0)) pcNextWpn();
}
// 干扰弹：一次一组（红外诱饵弹 + 箔条），2 秒内来袭导弹命中率大降
function pcFlare() {
  if (!pcFlying()) return;
  if (PC.cm.n <= 0) { pcSay('干扰弹打光了', 'warn', 'pccm', 2); return; }
  PC.cm.n -= 2; PC.cm.t = S.t;
  if (typeof MSV === 'object' && MSV.fl) MSV.fl.push({ x: PC.p.x, y: PC.p.y, t: S.t });
}
// 来袭导弹打自己时的命中修正（missile.js msSamHit 调）：刚投过干扰弹、正在大过载机动
function pcEvade(m) {
  let k = 1;
  if (S.t - PC.cm.t < 2.2) k *= m.src === 'manpads' || m.src === 'samv' ? .3 : .45;
  if (PC.n > 6) k *= .72; else if (PC.n > 4) k *= .86;
  return k;
}
// 威胁：打向自己的导弹、锁定自己的敌机
function pcThreats() {
  const p = PC.p, msl = [], lock = !!(p && S.eair && S.eair.fly.some(a => !a.dead && a.tg && a.tg.k === 'plane' && a.tg.id === p.id));
  if (p) for (const m of S.missiles) if (!m.done && m.t >= 0 && m.side === 'e' && m.tgt && m.tgt.k === 'plane' && m.tgt.id === p.id) msl.push(m);
  return { msl, lock };
}
// 3D 里导弹的高度（v3units.js / v3fx.js / airmdl.js 调）：自己打的从本机高度飞向目标的高度，打向自己的从发射处飞到本机的高度；其他导弹返回 null 照旧
function pcMslZ(m, z0) {
  if (!m || !PC.on) return null;
  if (m.pz0 != null) {
    const T = typeof msTgtObj === 'function' && m.kind === 'sam' ? msTgtObj(m.tgt) : null, zt = T ? (typeof v3AirZ === 'function' ? v3AirZ(T) : m.pzt) : m.pzt ?? z0;
    const u = clamp(1 - dist(m.x, m.y, m.tx, m.ty) / (m.pd0 || 1), 0, 1);
    return lerp(m.pz0, zt ?? z0, m.kind === 'pgm' ? u * u : sm01(u));
  }
  const p = PC.p;
  if (p && p.pc && m.side === 'e' && m.tgt && m.tgt.k === 'plane' && m.tgt.id === p.id) {
    if (m.pcz0 == null) { m.pcz0 = z0; m.pcd0 = Math.max(1, dist(m.x, m.y, p.x, p.y)); }
    const u = clamp(1 - dist(m.x, m.y, p.x, p.y) / m.pcd0, 0, 1);
    return lerp(m.pcz0, PC.P[2], sm01(u));
  }
  return null;
}

// —— 界面：右上角「驾驶」按钮、驾驶时的操作条（鼠标、触屏都能点）、触屏摇杆 ——
const PC_BTN = [['发射', '空格 / 左键', () => pcFire()], ['目标', 'Tab', () => pcCycle(1)], ['武器', '1 2 3', () => pcNextWpn()], ['干扰弹', 'X', () => pcFlare()],
  ['加力', '推满油门再按住 Shift', () => { PC.thr = 1; PC.ab = PC.ab ? 0 : 1; }], ['油门+', 'Shift', () => { PC.thr = Math.min(1, PC.thr + .15); }], ['油门−', 'Ctrl', () => { if (PC.ab) PC.ab = 0; else PC.thr = Math.max(0, PC.thr - .15); }],
  ['视角', 'V', () => pcView()], ['返航', 'R', () => pcStop('exit')]];
function pcView() { PC.view = PC.view === 'ck' ? 'ext' : 'ck'; }
function pcUi(on) {
  if (typeof document === 'undefined' || !document.body) return;
  document.body.classList.toggle('pc-on', !!on);
  let u = document.getElementById('pcUI');
  if (!u && on) {
    u = document.createElement('div'); u.id = 'pcUI';
    u.innerHTML = '<div id="pcBar"></div><div id="pcStick" aria-label="摇杆"><i></i></div>';
    const bar = u.querySelector('#pcBar');
    for (const [t, k, f] of PC_BTN) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'tb'; b.textContent = t; b.title = `${t}（${k}）`;
      b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); f(); });
      bar.appendChild(b);
    }
    const st = u.querySelector('#pcStick');
    const stick = e => { const r = st.getBoundingClientRect(), R = r.width / 2, x = clamp((e.clientX - r.left - R) / R, -1, 1), y = clamp((e.clientY - r.top - R) / R, -1, 1); PC.touch.x = x; PC.touch.y = y; st.firstChild.style.transform = `translate(${x * R * .6}px, ${y * R * .6}px)`; };
    st.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); PC.touch.on = true; PC.touch.id = e.pointerId; try { st.setPointerCapture(e.pointerId); } catch (er) { /* 拖动照样能用 */ } stick(e); });
    st.addEventListener('pointermove', e => { if (PC.touch.on && e.pointerId === PC.touch.id) stick(e); });
    const end = e => { if (e.pointerId !== PC.touch.id) return; PC.touch.on = false; PC.touch.x = PC.touch.y = 0; st.firstChild.style.transform = ''; };
    st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end);
    (document.getElementById('stage') || document.body).appendChild(u);
    const css = document.createElement('style');
    css.textContent = '#pcUI { position: absolute; inset: 0; pointer-events: none; z-index: 6; }' +
      '#pcBar { position: absolute; left: 50%; bottom: calc(10px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); display: flex; gap: 4px; pointer-events: auto; flex-wrap: wrap; justify-content: center; max-width: 96vw; }' +
      '#pcBar .tb { min-width: 52px; height: 30px; font-size: 13px; opacity: .78; } #pcBar .tb:hover { opacity: 1; }' +
      '#pcStick { position: absolute; left: max(18px, env(safe-area-inset-left, 0px)); bottom: calc(56px + env(safe-area-inset-bottom, 0px)); width: 132px; height: 132px; border-radius: 50%; border: 1px solid rgba(120,255,170,.45); background: rgba(0,20,10,.25); pointer-events: auto; display: none; touch-action: none; }' +
      '#pcStick i { position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; margin: -22px; border-radius: 50%; background: rgba(120,255,170,.35); border: 1px solid rgba(160,255,200,.7); }' +
      '@media (pointer: coarse) { #pcStick { display: block; } }' +
      'body.pc-on #bottom, body.pc-on #objs, body.pc-on #info, body.pc-on #deploy, body.pc-on #v3ctl { display: none !important; }';
    document.head.appendChild(css);
  }
  if (u) u.hidden = !on;
  const b = document.getElementById('btnPilot');
  if (b) { b.classList.toggle('on', !!on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
}
// 右上角 3D 镜头按钮组里加「驾驶」
function pcButton() {
  const c = typeof document !== 'undefined' && document.getElementById('v3ctl');
  if (!c) { setTimeout(pcButton, 250); return; }
  if (document.getElementById('btnPilot')) return;
  const b = document.createElement('button');
  b.id = 'btnPilot'; b.type = 'button'; b.className = 'tb'; b.textContent = '驾驶'; b.title = '驾驶歼-35（Shift + J）：第一人称座舱，W S 俯仰、A D 滚转、Shift / Ctrl 油门、Tab 选目标、空格发射、V 换视角、Esc 退出';
  b.setAttribute('aria-pressed', 'false'); b.style.minWidth = '48px'; b.style.fontSize = '13px';
  b.addEventListener('click', () => pcStart());
  c.appendChild(b);
  const st = document.createElement('style');
  st.textContent = '#btnPilot.on { color: var(--bg); background: var(--g); border-color: var(--g); }';
  document.head.appendChild(st);
}
if (typeof document !== 'undefined' && document.addEventListener) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pcButton); else setTimeout(pcButton, 0); }

// —— 键盘、鼠标 ——
const PC_HOLD = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyZ', 'KeyB', 'KeyF', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight']);
const pcLocked = () => typeof document !== 'undefined' && !!document.pointerLockElement;
function pcKey(e) {
  const c = e.code;
  if (c === 'Escape') { pcStop('exit'); return; }
  if (PC_HOLD.has(c)) { PC.keys.add(c); return; }
  if (e.repeat) return;
  if (c === 'Space') pcFire();
  else if (c === 'Tab') pcCycle(e.shiftKey ? -1 : 1);
  else if (c === 'Digit1') pcWpn('pl15');
  else if (c === 'Digit2') pcWpn('pl10');
  else if (c === 'Digit3') pcWpn('ft8');
  else if (c === 'KeyX') pcFlare();
  else if (c === 'KeyV') pcView();
  else if (c === 'KeyG') { if (pcFlying()) PC.gear = PC.gear ? 0 : 1; }
  else if (c === 'KeyR') pcStop('exit');
  else if (c === 'KeyC') { PC.lookT = [0, 0]; PC.orbit = [0, -.18]; }
  else if (c === 'KeyP' && typeof togglePause === 'function') togglePause();
  else if (c === 'KeyM') PC.radarOn = !PC.radarOn;
}
if (typeof window !== 'undefined' && window.addEventListener) {
  // 驾驶时键盘全归飞机（捕获阶段拦下，游戏的快捷键不触发）；功能键、带 Ctrl / ⌘ 的组合照旧
  window.addEventListener('keydown', e => {
    if (!PC.on || (e.target && e.target.closest && e.target.closest('input,textarea,select'))) return;
    if (/^F\d+$/.test(e.code) || ((e.ctrlKey || e.metaKey) && !/^Control/.test(e.code))) return;
    if (e.shiftKey && e.code === 'KeyJ') { e.preventDefault(); e.stopPropagation(); pcStart(); return; }
    e.preventDefault(); e.stopPropagation();
    pcKey(e);
  }, true);
  window.addEventListener('keyup', e => { if (PC.keys.delete(e.code) && PC.on) e.stopPropagation(); }, true);
  window.addEventListener('blur', () => PC.keys.clear());
  window.addEventListener('mousemove', e => {
    if (!PC.on) return;
    let dx = 0, dy = 0;
    if (pcLocked()) { dx = e.movementX || 0; dy = e.movementY || 0; }
    else if (PC.drag) { dx = e.clientX - PC.drag[0]; dy = e.clientY - PC.drag[1]; PC.drag = [e.clientX, e.clientY]; }
    if (!dx && !dy) return;
    const k = .0024 * (1 - .6 * PC.zoom);
    if (PC.view === 'ck') { PC.lookT[0] = clamp(PC.lookT[0] - dx * k, -2.6, 2.6); PC.lookT[1] = clamp(PC.lookT[1] - dy * k, -1.25, 1.35); }
    else { PC.orbit[0] -= dx * .004; PC.orbit[1] = clamp(PC.orbit[1] - dy * .004, -1.3, 1.2); }
  });
  window.addEventListener('mouseup', e => { PC.drag = null; if (e.button === 2) PC.zoomM = false; });
  window.addEventListener('wheel', e => {
    if (!PC.on || !(e.target && e.target.closest && e.target.closest('#cv'))) return;
    e.preventDefault(); e.stopPropagation();
    if (e.deltaY < 0) { if (PC.thr >= 1) PC.ab = 1; PC.thr = Math.min(1, PC.thr + .06); } else { if (PC.ab) PC.ab = 0; else PC.thr = Math.max(0, PC.thr - .06); }
  }, { capture: true, passive: false });
  window.addEventListener('contextmenu', e => { if (PC.on && e.target && e.target.closest && e.target.closest('#cv')) e.preventDefault(); }, true);
  if (typeof document !== 'undefined') document.addEventListener('pointerlockchange', () => { if (PC.on && !pcLocked()) { PC.keys.clear(); PC.zoomM = false; } });
}
// 游戏的快捷键入口：Shift + J 开关（驾驶时 keydown 已在捕获阶段处理）
HOOK.key.push(e => {
  if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'J' || e.key === 'j')) { pcStart(); return true; }
  return PC.on;
});
// 鼠标：驾驶时点画面不下命令——没锁定先锁定（或按住左键拖动转头），锁定后左键发射、右键按住拉近
HOOK.pointer.push((e, kind) => {
  if (!PC.on) return false;
  if (kind === 'down') {
    if (e.pointerType !== 'mouse') PC.drag = [e.clientX, e.clientY];   // 触屏：拖动转头（发射等用下面的按钮）
    else if (!pcLocked()) {
      const cv = typeof R === 'object' && R.cv;
      if (cv && cv.requestPointerLock) { try { const q = cv.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch (er) { /* 拖动代替 */ } }
      PC.drag = [e.clientX, e.clientY];
    } else if (e.button === 0) pcFire();
    if (e.button === 2) PC.zoomM = true;
  }
  if (kind === 'up') { PC.drag = null; if (e.button === 2) PC.zoomM = false; }
  return true;
});
HOOK.newGame.push(() => { if (PC.on) pcStop('exit'); });
