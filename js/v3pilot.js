'use strict';
// 亲自操纵（3D 地图里，P 键或右上角「驾驶」按钮）：055 驱逐舰，以及升空的战斗机（歼-20、歼-50、歼-36）、歼-35、歼-15T、歼-16D——
//   这一个单位的 AI 让出指挥（别的照常推演）；按 P 或「驾驶」弹出列表自己选要开的，Esc 退出、交回 AI。画面上不画别的标识，只有武器平显（fpwpn.js）
//   飞机：飞控物理引擎（flight.js 六自由度 + 电传飞控）真飞，操纵照《战争雷霆》——默认鼠标瞄准（鼠标指哪儿，教官压坡度、拉杆把机头带过去），
//         M 切换鼠标摇杆（鼠标移动的就是杆）；W / S 油门（推满后按住 W 开加力）、A / D 滚转、↑ / ↓ 推杆 / 拉杆、Q / E 方向舵（按住时这一轴归玩家）；
//         能连续横滚、筋斗、反筋斗；杆量有平滑、死区与指数响应曲线；受力回馈：手柄震动、大迎角抖振、过载黑视 / 红视、头部随过载晃动（G 开关）；
//         镜头是跟在机尾的追尾视角（按住 C 自由视角、滚轮拉远拉近），V 切换座舱视角（透明座舱盖）；手柄也能飞；
//         武器（fpwpn.js）：数字键选武器、F 开火，选中时打开弹舱门；平显上是导弹的大环，环里的目标锁稳了框变红才能打。起飞、着舰仍由飞行员（AI）完成
//   军舰：A / D 转舵，W / S 车钟加减一档（后退一 · 停车 · 前进一二三），空格主炮打视线中心的点，F 垂发导弹（按目标自动选弹）；鼠标看四周（点一下画面锁定鼠标，或按住左键拖动），C 视线回正
//   手机：屏幕下方出现操纵按钮
// 推演：carrier.js flyPlane、support.js updateDD、units.js updateShips、sandbox.js sbxFireShips 见到 o.fp 就不再替它做主（飞机在 fpFly 里飞，舰在 fpSail 里开）
const V3FP = { on: false, k: null, o: null, keys: new Set(), look: [0, 0], thr: .8, tele: 3, rud: 0, cool: 0, drag: null, touch: { x: 0, y: 0, ab: false }, lock: null, law: 'n', ap: false,
  vw: 'chase', orb: [0, 0], cd: 80, ws: -1, lk: {}, fwC: [], bay: { main: 0, side: 0, ext: 0 },
  ctl: 'aim', aim: [0, 0], ms: [0, 0], kx: { r: 0, p: 0, y: 0 }, ins: { x: 0, y: 0, r: 0 }, ab: false, abT: 0, ffb: true, gb: 0, rb: 0, buf: 0, imp: 0, free: false, gpB: [],
  mv: null, mo: [0, 0], mf: null, mp: null, mEnd: null, fq: null, msg: null };   // mv：导弹视角正跟着的弹；fq：按了开火、等舱门开好
const V3FP_KEYS = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, KeyQ: 1, KeyE: 1, KeyC: 1, KeyF: 1, KeyX: 1, KeyV: 1, KeyT: 1, KeyM: 1, KeyG: 1, Space: 1, ShiftLeft: 1, ShiftRight: 1, ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1, Digit1: 1, Digit2: 1, Digit3: 1, Digit4: 1, Digit5: 1, Digit6: 1 };
const FP_TELE = [-.3, 0, .35, .7, 1];   // 车钟：后退一 · 停车 · 前进一二三

// —— 能驾驶的单位 ——
// 这个单位正被玩家亲自开着吗（推演各处用它让出指挥；存档里留下的 fp 标记不算）
const fpDriving = o => V3FP.on && !!o && V3FP.o === o;
// 能亲自开的固定翼战机（飞控物理引擎 flight.js 里有参数的）：歼-35（含防空压制型）、歼-15T、歼-16D，战斗机歼-20、歼-50、歼-36
const fpJetType = p => !!p && p.kind !== 'transport' && typeof FL_KEY === 'object' && !!FL_KEY[airMdlKey(p.kind, p.v)];
// 现在能接手：已经升空（出航、待机、返航、等着舰）——甲板上、弹射滑跑、进近着舰、跑道上的不行（原来也列进来，镜头进了座舱却开不了，自己的模型还挡住视线）
const FP_UP = { out: 1, loiter: 1, rtb: 1, hold: 1 };
const fpJet = p => fpJetType(p) && !p.dead && isFinite(p.x) && !p.afPh && !!FP_UP[p.phase] && (p.alt ?? 1) > .15;
const fp055 = o => !!o && typeof vlsCls === 'function' && vlsCls(o) === '055';
function fpList() {
  const L = [];
  if (S.dd && S.dd.state !== 'sunk' && isFinite(S.dd.x) && S.dd.x > -999 && fp055(S.dd)) L.push({ k: 'ship', o: S.dd });
  for (const s of S.ships || []) if (s.kind === 'dd' && alive(s) && fp055(s)) L.push({ k: 'ship', o: s });
  for (const p of S.planes || []) if (fpJet(p)) L.push({ k: 'air', o: p });
  return L;
}
// 甲板上、还没弹射的（出动流程 'cat' 各步、正在弹射 'roll'）：可以坐进去，等弹射升空后接手
const fpOnDeck = p => !!p && !p.dead && fpJetType(p) && !p.land && (p.phase === 'cat' || p.phase === 'roll');
// 甲板 / 机库 / 战区机场上待命的在册飞机（S.air.wing，还没派出去）：能开的机型
const fpWingIdle = () => (S.air && S.air.wing || []).filter(w => w.state === 'deck' && typeof FL_KEY === 'object' && FL_KEY[airMdlKey(w.type, w.v)] && (airLandW(w) || (cvOf(cvHome(w)) || { hp: 0 }).hp > 0));
// 登机：把这一架派出去（目标先给最近的已知敌情，没有就地图中间），舰载机的飞行员就是你——坐进座舱看着牵引、弹射；陆基的从战区机场直接飞来
function fpBoard(w) {
  if (!w || w.state !== 'deck') { log('这架飞机已经不在待命了', 'warn', 'fp0', 2); return; }
  const c = airLandW(w) ? null : cvOf(cvHome(w)), x0 = c ? c.x : W / 2, y0 = c ? c.y : H;
  const e = (S.enemies || []).filter(e => !e.dead && e.kx != null).sort((a, b) => dist(a.kx, a.ky, x0, y0) - dist(b.kx, b.ky, x0, y0))[0];
  const tx = e ? e.kx : W / 2, ty = e ? e.ky : H / 2, n = S.planes.length;
  const ok = w.af && typeof abTakeoff === 'function' ? abTakeoff(w, w.type, tx, ty) : airLandW(w) ? launchLand(w, w.type, tx, ty) : withCV(c, () => launchFrom(w, w.type, AIR_SPEC[w.type], tx, ty));
  const p = ok && S.planes.length > n ? S.planes[S.planes.length - 1] : null;
  if (!p) { log('这架飞机现在起飞不了', 'warn', 'fp0', 2); return; }
  if (p.dk === 'brd') p.dkT = Math.max(p.dkT || 0, cvBrdT(p) - 5);   // 飞行员就是你：不用再从舰岛跑过来，坐进去、座舱盖合上
  fpTake({ k: 'air', o: p });
}
const FP_DK = { brd: '登机，座舱盖合上', lift: '升降机从机库升上甲板', eng: '启动发动机，等牵引车挂钩', taxi: '牵引车拖向弹射器', hold: '偏流板后等待（解除武器保险）', line: '滑上弹射器', hook: '挂弹射杆 · 偏流板升起 · 加力' };
const fpName = (k, o) => k === 'air' ? airMdl(o.kind, o.v).name : o === S.dd ? `${S.dd.name || '055 型驱逐舰'}` : `${o.label || ''} ${(o.sbxCls && o.sbxCls.name) || '055 型驱逐舰'}`.trim();
const fpShipLen = o => 50 * (((typeof SH_DDC === 'object' && SH_DDC['055']) || {}).k || 1) * ((typeof SHIPV === 'object' && SHIPV.pose[o === S.dd ? 'DD' : o.id] || {}).k || 1);   // 画面里的舰长（与 v3units.js 一致）
const fpShipVmax = o => o === S.dd ? 18 : 22 * (o.spdK || 1);

// —— 选择要操纵的单位：按 P 或「驾驶」弹出列表，自己点一个（甲板上、起降中的也列出来，灰着，升空后才能开）——
function fpMenu(show = true) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('fpMenu');
  if (!show) { if (el) el.hidden = true; return; }
  if (typeof v3Toggle === 'function' && !V3.on) v3Toggle(true);
  if (!V3.on || !S) return;
  if (!el) {
    el = document.createElement('div'); el.id = 'fpMenu'; el.className = 'ov box'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', '选择要操纵的单位');
    const st = document.createElement('style');
    st.textContent = '#fpMenu { left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(480px, calc(100vw - 32px)); max-height: min(72vh, 580px); overflow: auto; padding: 10px 12px; z-index: 40; }' +
      '#fpMenu h3 { margin: 0 0 4px; font-size: 14px; } #fpMenu .sec { margin: 10px 0 4px; color: var(--mute); font-size: 12px; }' +
      '#fpMenu button.it { display: block; width: 100%; text-align: left; padding: 7px 9px; margin: 3px 0; background: rgba(var(--g-rgb), .05); border: 1px solid var(--line); border-radius: 3px; }' +
      '#fpMenu button.it:hover:not(:disabled) { border-color: var(--line-hi); background: rgba(var(--g-rgb), .14); } #fpMenu button.it.cur { border-color: var(--g); }' +
      '#fpMenu .sub { color: var(--mute); font-size: 11px; margin-top: 2px; } #fpMenu .ft { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }';
    document.head.appendChild(st);
    (document.getElementById('stage') || document.body).appendChild(el);
  }
  el.hidden = false;
  fpMenuFill(el);
  const b = el.querySelector('button.it:not(:disabled)'); if (b) b.focus();
}
const fpMenuOpen = () => { const el = typeof document !== 'undefined' && document.getElementById('fpMenu'); return !!(el && !el.hidden); };
function fpMenuFill(el) {
  const L = fpList(), air = L.filter(e => e.k === 'air'), sh = L.filter(e => e.k === 'ship');
  const deck = (S.planes || []).filter(p => fpJetType(p) && !p.dead && isFinite(p.x) && !fpJet(p)), idle = fpWingIdle();
  const ph = { out: '出航', loiter: '待机', rtb: '返航', hold: '等着舰', cat: '甲板上 / 准备弹射', roll: '弹射滑跑', trap: '着舰', final: '进近着舰' };
  const wpn = o => typeof fwSum === 'function' ? fwSum(o) : '';   // 「霹雳-15 ×4 · 霹雳-10 ×2」（fpwpn.js）
  el.textContent = '';
  const add = (tag, cls, t) => { const d = document.createElement(tag); if (cls) d.className = cls; d.textContent = t; el.appendChild(d); return d; };
  add('h3', '', '选择要操纵的单位');
  const item = (E, title, sub, dis) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'it' + (V3FP.on && E && V3FP.o === E.o ? ' cur' : ''); b.disabled = !!dis;
    const t = document.createElement('div'); t.textContent = title; const u = document.createElement('div'); u.className = 'sub'; u.textContent = sub; b.append(t, u);
    if (!dis) b.addEventListener('click', () => { fpMenu(false); fpTake(E); });
    el.appendChild(b);
  };
  add('div', 'sec', `飞机 · 已升空 ${air.length} 架`);
  if (!air.length) add('div', 'sub', '还没有升空的战斗机或攻击机：先派出战斗机（制空）或攻击机');
  for (const E of air) { const o = E.o; item(E, `${airMdl(o.kind, o.v).name} · ${ph[o.phase] || o.phase}`, `${gridRef(o.x, o.y)} · 高度 ${Math.round(v3AirZ(o))} 米 · ${Math.round((o.spd || 0) * 3.6)} km/h · ${wpn(o)}`); }
  if (deck.length) { add('div', 'sec', '甲板上 / 起降中（准备弹射的可以坐进去，弹射升空后接手）'); for (const o of deck) item(fpOnDeck(o) ? { k: 'air', o } : null, `${airMdl(o.kind, o.v).name} · ${o.phase === 'cat' ? FP_DK[o.dk] || ph.cat : ph[o.phase] || o.phase}`, wpn(o), !fpOnDeck(o)); }
  if (idle.length) {
    add('div', 'sec', `待命 · ${idle.length} 架（点一下登机：舰载机由牵引车拖上弹射器弹射起飞，陆基的从战区机场起飞）`);
    for (const w of idle) {
      const M = airMdl(w.type, w.v), where = airLandW(w) ? '战区机场' : w.dk != null && w.dk >= 0 ? `航母甲板 ${w.dk + 1} 号机位` : '航母机库';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'it';
      const t = document.createElement('div'); t.textContent = `登机 · ${M.name}`; const u = document.createElement('div'); u.className = 'sub'; u.textContent = `${where} · ${wpn({ kind: w.type, v: w.v })}`; b.append(t, u);
      b.addEventListener('click', () => { fpMenu(false); fpBoard(w); });
      el.appendChild(b);
    }
  }
  if (sh.length) { add('div', 'sec', '军舰'); for (const E of sh) item(E, fpName('ship', E.o), `${gridRef(E.o.x, E.o.y)}${E.o.fpV ? ` · ${Math.round(Math.abs(E.o.fpV) * 1.94)} 节` : ''}`); }
  const ft = document.createElement('div'); ft.className = 'ft';
  const btn = (t, f) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'tb'; b.textContent = t; b.addEventListener('click', f); ft.appendChild(b); };
  if (V3FP.on) btn('退出操纵', () => { fpMenu(false); fpExit(); });
  btn('刷新', () => fpMenuFill(el));
  btn('关闭（Esc）', () => fpMenu(false));
  el.appendChild(ft);
}
// 列表打开时：Esc 关列表（不退出操纵，不弹游戏菜单）
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('keydown', e => { if (e.key === 'Escape' && fpMenuOpen()) { e.preventDefault(); e.stopPropagation(); fpMenu(false); } }, true);
// 退出操纵、交回 AI（Esc、列表里「退出操纵」、单位没了、退出 3D、换局）：自由镜头接着从这里看
function fpExit() {
  if (V3FP.on && V3.fc && V3.cam) { const P = fpPose(); if (P) Object.assign(V3.fc, { x: P.x, y: P.y, z: Math.max(P.z, v3Ht(clamp(P.x, 0, W - 1), clamp(P.y, 0, H - 1)) + 20), yaw: P.yaw, yawT: P.yaw, pitch: -.35, pitchT: -.35, cx: null, cy: null }); }
  fpRelease(); fpMslOff();
  Object.assign(V3FP, { on: false, k: null, o: null, drag: null, lock: null, nozV: 0, fq: null, msg: null });
  if (typeof V3G === 'object') V3G.glass = null;
  V3FP.keys.clear();
  if (typeof document !== 'undefined' && document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  fpUi();
}
// 接手一个单位（列表里点的）：这个单位的 AI 让出指挥
function fpTake(E) {
  const brd = E && E.o && E.k === 'air' && fpOnDeck(E.o);   // 甲板上等着弹射的：坐进座舱，牵引车拖上弹射器、弹射升空后接手
  if (!E || !E.o || (E.k === 'air' ? !fpJet(E.o) && !brd : E.o === S.dd ? S.dd.state === 'sunk' : !alive(E.o))) { log('这个单位现在开不了（刚落地、着舰或被击落）', 'warn', 'fp0', 2); return; }
  if (typeof v3Toggle === 'function' && !V3.on) v3Toggle(true);
  if (!V3.on) return;
  if (typeof V3O === 'object' && V3O.on) v3oToggle(false);
  if (V3FP.o !== E.o) fpRelease();
  {
    Object.assign(V3FP, { on: true, k: E.k, o: E.o, look: [0, 0], cool: 0, lock: null });
    E.o.fp = true;
    if (E.k === 'ship') { V3FP.tele = 3; V3FP.rud = 0; E.o.fpV = E.o.fpV ?? 0; E.o.moving = false; if (E.o.state === 'move') E.o.state = 'idle'; }
    else {   // 飞机：物理状态接手时按现在的位置、速度建；瞄准方向先对着机头；油门八成五
      E.o.fl = null;
      Object.assign(V3FP, { vw: 'chase', orb: [0, 0], cd: fpLen(E.o) * 3.2, cf: null, cu: null, camF: null, head: null,
        aim: [E.o.heading || 0, 0], ms: [0, 0], kx: { r: 0, p: 0, y: 0 }, ins: { x: 0, y: 0, r: 0 }, thr: .85, ab: false, abT: 0, gb: 0, rb: 0, buf: 0, imp: 0, free: false });
      if (typeof fwTake === 'function') fwTake(E.o);   // 武器：按推演里的余弹分到各型弹上，先不选（舱门关着）
      if (brd) { E.o.fpBrd = true; V3FP.vw = 'cock'; }   // cvdeck.js 见到 fpBrd：牵引车一路拖到偏流板后
    }
    V3FP.keys.clear();
    fpLock();   // 鼠标瞄准、鼠标摇杆都要锁定鼠标（移动不出窗口）；没锁上时点一下画面再锁
    log(brd ? `坐进 ${fpName('air', E.o)} 的座舱：牵引车把飞机拖上弹射器，弹射升空后由你驾驶` : `驾驶 ${fpName(E.k, E.o)}`, 'info', 'fp1', 1);
  }
  fpUi();
}
// 交回 AI：飞机弹打光了就返航，否则接着原来的任务；舰停在原地待命
function fpRelease() {
  const o = V3FP.o;
  if (!o) return;
  o.fp = false; o.fpBrd = false;
  if (V3FP.k === 'air' && typeof fwRelease === 'function') fwRelease();   // 舱门关上
  if (V3FP.k === 'air' && fpOnDeck(o)) { V3FP.o = null; return; }   // 还在甲板上：照常由甲板作业流程送上弹射器
  if (V3FP.k === 'air') { o.fl = null; o.pt3 = null; o.fpVz = 0; if (!o.dead) o.alt = clamp(o.alt, .3, 1); }   // 交回 AI：按游戏里的简化飞行接着飞
  if (V3FP.k === 'air' && !o.dead && o.phase === 'out' && typeof fwLeft === 'function' && fwLeft(o) === 0 && typeof airSet === 'function') airSet(o, 'rtb');
  if (V3FP.k === 'ship') { o.tx = o.x; o.ty = o.y; o.fpV = 0; }
  V3FP.o = null;
}
function fpLock() {
  const cv = typeof R === 'object' && R.cv;
  if (cv && cv.requestPointerLock && !(typeof V3 === 'object' && V3.coarse)) { try { const p = cv.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* 拖动代替 */ } }
}
const fpLocked = () => typeof document !== 'undefined' && !!document.pointerLockElement;

// —— 推演：飞机（carrier.js flyPlane 在甲板阶段之后调用；返回 true 就不走 AI）——
// 飞控物理引擎（flight.js：六自由度刚体 + 电传飞控）真飞。操纵照《战争雷霆》：
//   鼠标瞄准（默认）：鼠标指哪儿，「教官」就压坡度、拉杆把机头带过去——偏得多先滚到目标在座舱顶方向再拉，偏得少只压小坡度修航向；
//     A / D、↑ / ↓、Q / E（手柄摇杆）有输入时那一轴归玩家，松开交回教官：按住 A / D 连续横滚，按住 ↓ 拉筋斗，按住 ↑ 推反筋斗
//   鼠标摇杆（M 切换）：鼠标移动的就是杆，杆停在哪儿就保持（C 回中）
//   杆量：键盘按下约 0.3 秒推满、松开约 0.2 秒回中（不是开关量，不会一碰就抖）；模拟量（鼠标摇杆、手柄）去 3% 死区；
//     再过指数响应曲线（中间细腻、推到头才满量）；电传把杆量换成过载 / 滚转角速度指令
const FP_DZ = .03, FP_EXPO = .55;
const fpDz = v => Math.abs(v) < FP_DZ ? 0 : Math.sign(v) * (Math.abs(v) - FP_DZ) / (1 - FP_DZ);
const fpCurve = v => Math.sign(v) * ((1 - FP_EXPO) * Math.abs(v) + FP_EXPO * Math.abs(v) ** 3);
const fpRamp = (v, t, dt) => { const k = Math.abs(t) > Math.abs(v) && Math.sign(t) === Math.sign(v || t) ? 3.2 : 5; return v + clamp(t - v, -k * dt, k * dt); };   // 推满约 0.3 秒、回中约 0.2 秒
const fpAc = o => (typeof FL_AC === 'object' && typeof flKey === 'function' && FL_AC[flKey(o)]) || { nz: [-3, 8], Tm: 1.3e5, Ta: 2e5, L: 17, pmax: 3 };   // 飞控参数（flight.js：推力、过载限制、机长）
const fpLen = o => fpAc(o).L || 17;
// 画面用的位置、姿态：上一步与这一步之间按主循环里攒下、还没推演的时间插值（main.js 的 acc，每步 1/30 秒）
function fpRS(o) {
  const F = o.fl;
  if (!F) return null;
  const a = F.P0 && typeof acc === 'number' ? clamp(acc * 30, 0, 1) : 1, P0 = F.P0 || F.P, q0 = F.q0 || F.q;
  const P = [lerp(P0[0], F.P[0], a), lerp(P0[1], F.P[1], a), lerp(P0[2], F.P[2], a)];
  const dq = q0[0] * F.q[0] + q0[1] * F.q[1] + q0[2] * F.q[2] + q0[3] * F.q[3], sg = dq < 0 ? -1 : 1;   // 四元数取同一半球再插
  const q = [0, 1, 2, 3].map(i => lerp(q0[i] * sg, F.q[i], a)), ql = Math.hypot(...q) || 1;
  for (let i = 0; i < 4; i++) q[i] /= ql;
  const [phi, th, psi] = flEul(q);
  return { x: P[1], y: -P[0], z: -P[2], heading: Math.atan2(-Math.cos(psi), Math.sin(psi)), pitch: th, roll: phi, q };
}
// 瞄准方向（鼠标瞄准）：方位 aim[0]（游戏坐标角，0 朝东）、俯仰 aim[1]（可以超过 90°——拉筋斗时顺着翻过去）；GL 坐标（y 朝北）
const fpAimDir = () => { const [y, p] = V3FP.aim, c = Math.cos(p); return [c * Math.cos(y), -c * Math.sin(y), Math.sin(p)]; };
const fpAimUp = () => { const [y, p] = V3FP.aim, s = Math.sin(p); return [-s * Math.cos(y), s * Math.sin(y), Math.cos(p)]; };
// 机体轴（GL 坐标）：机头 f、座舱顶 u、右翼 r（物理引擎的四元数；还没接手时按游戏里的航向、坡度）
function fpBody(o) {
  const F = o && o.fl;
  if (!F) { const P = fpPose(); return fpAxes(P); }
  const R = flRot(fpRS(o).q);
  return { f: [R[3], R[0], -R[6]], u: [-R[5], -R[2], R[8]], r: [R[4], R[1], -R[7]], R };
}
// 教官：把机头带到瞄准方向（返回杆量 x 压杆、y 拉杆、r 蹬舵）
function fpInstr(F) {
  const R = flRot(F.q), A = fpAimDir(), b = flMtv(R, [A[1], A[0], -A[2]]);   // 瞄准方向换到机体系（前右下）
  const off = Math.acos(clamp(b[0], -1, 1)), phiE = Math.atan2(b[1], -b[2]), eL = Math.atan2(-b[2], b[0]), eY = Math.atan2(b[1], b[0]);
  // 准星在机头附近（20° 以内）：只按左右偏差压坡度（最多约 55°）、按上下偏差拉杆——目标在机头附近时「滚到目标在头顶」的方位来回跳，会左右乱压杆；
  //   偏得多（35° 以上）：滚到目标在座舱顶方向，滚到位了再拉；中间平滑过渡。滚转加角速度阻尼，压杆不过头
  const phi = flEul(F.q)[0], pm = (FL_AC[F.k] || {}).pmax || 3, w = smooth(.35, .6, off);
  const phD = clamp(eY * 4, -.95, .95), rollE = lerp(airAng(phD - phi), phiE, w);
  const yS = clamp(eL * 6, -.3, .7), yB = clamp(off * 3, 0, .7) * Math.max(0, Math.cos(phiE)) ** 2;   // 教官最多拉到约 6.6 g（玩家自己拉杆能到 9 g）
  return { x: clamp((rollE * 2.6 - F.w[0] * .32) / pm, -1, 1), y: lerp(yS, yB, w), r: clamp(eY * 3, -1, 1) * (1 - w) * .5 };
}
// 手柄（标准布局）：左摇杆杆、扳机油门、肩键方向舵、右摇杆自由视角；A 开火、B 视角、X 加力、Y 换武器
function fpGamepad() {
  const g = typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].find(x => x && x.connected && x.axes.length >= 2) : null;
  if (!g) return null;
  const ax = i => fpDz(g.axes[i] || 0), bt = i => !!(g.buttons[i] && g.buttons[i].pressed), bv = i => (g.buttons[i] && g.buttons[i].value) || 0;
  const was = V3FP.gpB, now = g.buttons.map(x => !!x.pressed), hit = i => now[i] && !was[i];
  V3FP.gpB = now;
  if (hit(0)) fwFire();
  if (hit(1)) fpView();
  if (hit(2)) V3FP.ab = !V3FP.ab;
  if (hit(3)) fwNext();
  return { g, x: ax(0), y: ax(1), r: (bt(5) ? 1 : 0) - (bt(4) ? 1 : 0), thr: bv(7) - bv(6), lx: ax(2), ly: ax(3) };
}
// 受力回馈：手柄双马达震动（大迎角抖振、过载、加力、开火的冲击），每 0.1 秒刷新一次
function fpRumble(gp, F, ab) {
  if (!gp || !V3FP.ffb || !gp.g.vibrationActuator || !gp.g.vibrationActuator.playEffect) return;
  const now = performance.now();
  if (now - (V3FP.rmT || 0) < 100) return;
  V3FP.rmT = now;
  const hi = clamp(V3FP.buf * .9 + smooth(5.5, 9, F.nz) * .45 + V3FP.imp, 0, 1), lo = clamp(V3FP.buf * .5 + (ab ? .22 : 0) + smooth(.92, 1.02, F.M) * smooth(1.12, 1.02, F.M) * .35, 0, 1);
  if (hi + lo > .02) gp.g.vibrationActuator.playEffect('dual-rumble', { duration: 140, strongMagnitude: hi, weakMagnitude: lo }).catch(() => {});
}
function fpFly(p, dt) {
  if (!V3FP.on || V3FP.o !== p) { p.fp = false; p.fl = null; return false; }
  if (!FP_UP[p.phase]) return false;   // 起飞爬升前、着舰进近：飞行员自己飞
  if (p.phase !== 'out') p.phase = 'out';   // 玩家接手：任务状态回到「出击中」（返航、待机、等着舰都打断）
  if (p.fpBrd && !p.fl) { p.fpBrd = false; Object.assign(V3FP, { thr: 1, ab: true, aim: [p.heading || 0, .14] }); log('弹射离舰，飞机交给你了', 'info', 'fpcat', 1); }   // 刚弹射离舰：满油门加力
  const F = p.fl || flInit(p), K = V3FP.keys, T = V3FP.touch, kx = V3FP.kx, gp = fpGamepad(), A = FL_AC[F.k] || {};
  // 键盘轴：杆量按速率推过去
  const key = (a, b) => (K.has(a) ? 1 : 0) - (K.has(b) ? 1 : 0);
  kx.r = fpRamp(kx.r, clamp(key('KeyD', 'KeyA') + key('ArrowRight', 'ArrowLeft') + T.x, -1, 1), dt);
  kx.p = fpRamp(kx.p, clamp(key('ArrowDown', 'ArrowUp') + T.y, -1, 1), dt);
  kx.y = fpRamp(kx.y, clamp(key('KeyE', 'KeyQ'), -1, 1), dt);
  // 油门：W / S 连续加减；推满后再按住 W 0.4 秒开加力，S 关加力；按住 Shift 临时加力；手柄扳机
  const tu = K.has('KeyW') ? 1 : K.has('KeyS') ? -1 : 0, gt = gp ? gp.thr : 0;
  V3FP.thr = clamp(V3FP.thr + (tu + gt) * .6 * dt, 0, 1);
  if (tu > 0 && V3FP.thr >= 1) { V3FP.abT += dt; if (V3FP.abT > .4) V3FP.ab = true; } else V3FP.abT = 0;
  if (tu < 0 || gt < -.3) V3FP.ab = false;
  const ab = V3FP.ab || K.has('ShiftLeft') || K.has('ShiftRight') || T.ab;
  // 杆：玩家的（键盘 + 手柄 + 鼠标摇杆）过死区与响应曲线；鼠标瞄准时没输入的轴交给教官
  const mx = clamp(kx.r + (gp ? gp.x : 0), -1, 1), my = clamp(kx.p + (gp ? gp.y : 0), -1, 1), mr = clamp(kx.y + (gp ? gp.r : 0), -1, 1);
  let x, y, r;
  if (V3FP.ctl === 'stick') { x = fpCurve(clamp(mx + fpDz(V3FP.ms[0]), -1, 1)); y = fpCurve(clamp(my + fpDz(V3FP.ms[1]), -1, 1)); r = fpCurve(mr); }
  else {
    // 玩家压杆或拉杆时教官整个让出来（不然它还在按准星滚转，和玩家打架），准星跟着机头走——松手后接着往机头方向飞，不会猛地扳回去
    V3FP.man = Math.abs(mx) > .02 || Math.abs(my) > .02;
    const I = fpInstr(F), S0 = V3FP.ins, k = Math.min(1, dt / .08);   // 教官的杆量也滤一下（约 0.08 秒），不来回抖
    S0.x += (I.x - S0.x) * k; S0.y += (I.y - S0.y) * k; S0.r += (I.r - S0.r) * k;
    if (V3FP.man) {
      x = fpCurve(mx); y = fpCurve(my); r = fpCurve(mr); S0.x = x; S0.y = y; S0.r = r;
      const B = fpBody(p); V3FP.aim = [Math.atan2(-B.f[1], B.f[0]), Math.asin(clamp(B.f[2], -1, 1))];
    } else { x = S0.x; y = S0.y; r = Math.abs(mr) > .02 ? fpCurve(mr) : S0.r; }
  }
  // 离开作战区域（地图外 1.5 公里；海岛这种四周是无边海面的 5 公里）：自动驾驶转回来（压坡度对准地图中心、带一点杆），瞄准方向也跟着转过去
  const mg = V3.ocean ? 5000 : 1500;
  V3FP.ap = p.x < -mg || p.x > W + mg || p.y < -mg || p.y > H + mg;
  if (V3FP.ap) {   // 交给教官：准星对着地图中心、低了往上抬一点（原来直接压大坡度拉杆，掉头时升力不够，螺旋往下掉、撞了山）
    const agl = -F.P[2] - flGround(F.P[0], F.P[1]);
    V3FP.aim = [Math.atan2(H / 2 - p.y, W / 2 - p.x), clamp((900 - agl) / 1500, .08, .35)];   // 准星总在地平线以上：转弯带一点爬升（准星和地平线齐平时要压到 90° 坡度转，升力全在水平方向，一路往下掉）
    V3FP.thr = 1; if (F.Va < 170) V3FP.ab = true;
    const I = fpInstr(F); x = I.x; y = I.y; r = I.r;
  }
  F.P0 = F.P.slice(); F.q0 = F.q.slice();   // 上一步的位置、姿态：画面按这一步走了多少插值（推演每秒 30 步，画面 60 帧以上，不插值飞机一顿一顿地抖）
  const hit = flStep(F, dt, { x, y, r, thr: ab ? 1 : V3FP.thr, ab, law: V3FP.ap ? 'n' : V3FP.law });
  flToGame(p);
  // 受力回馈：过载黑视（持续 6 g 以上视野变暗收窄）、红视（−2 g 以下）、大迎角抖振、开火冲击
  V3FP.gb = clamp(V3FP.gb + (F.nz > 7 ? (F.nz - 7) * .3 : -.5) * dt, 0, 1);   // 有抗荷服：7 g 以上才开始，9 g 撑 1.6 秒左右视野收窄到最小
  V3FP.rb = clamp(V3FP.rb + (F.nz < -2 ? (-2 - F.nz) * .5 : -.5) * dt, 0, 1);
  V3FP.buf = clamp(smooth((A.alim || .43) * .72, (A.alim || .43) * 1.05, Math.abs(F.a)) + (F.stall || 0), 0, 1);
  V3FP.imp = Math.max(0, V3FP.imp - dt * 3);
  fpRumble(gp, F, ab);
  if (gp && (Math.abs(gp.lx) > .05 || Math.abs(gp.ly) > .05)) { V3FP.orb[0] = airAng(V3FP.orb[0] + gp.lx * 2.2 * dt); V3FP.orb[1] = clamp(V3FP.orb[1] - gp.ly * 1.6 * dt, -1.4, 1.4); V3FP.gpLook = true; } else V3FP.gpLook = false;
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
    fpExit();
    return;
  }
  if (V3FP.k === 'ship') fpSail(o, dt);
});

// —— 舰的开火（飞机的武器在 fpwpn.js）——
// 视线中心的点：锁定的目标（画面中心 60 像素内的敌人）优先，否则视线落在地面 / 海面的点
function fpAim() {
  const L = V3FP.lock;
  if (L && L.x != null) return { x: L.x, y: L.y, o: L.o, nm: L.nm };
  if (!V3.cam || typeof v3Pick !== 'function') return null;
  const P = v3Pick(CAM.vw / 2, CAM.vh / 2), o = V3FP.o;
  return P && isFinite(P.x) && dist(P.x, P.y, o.x, o.y) < 1600 ? P : null;
}
// 看得见的敌方目标：{ o, k（air 空中 / gnd 地面 / sea 海上）, t（missile.js 的目标种类）, x, y, z（3D 高度）, nm }；air = 只要空中的
function fpFoes(air) {
  const out = [], spec = specAll(), gz = (x, y) => v3Ht(clamp(x, 0, W - 1), clamp(y, 0, H - 1));
  if (S.eair) for (const a of S.eair.fly) if (!a.dead && isFinite(a.x) && (a.alt ?? 1) > .05 && (spec || typeof awSeen !== 'function' || awSeen('p', a.x, a.y, typeof eaStl === 'function' ? eaStl(a) : 1)))
    out.push({ o: a, k: 'air', t: 'eair', x: a.x, y: a.y, z: v3AirZ(a), nm: (EA_SPEC[a.type] || {}).name || '敌机' });
  if (air) return out;
  for (const e of S.enemies) if (!e.dead && e.kind !== 'airfield' && (spec || inVision(e.x, e.y) || e.kx != null)) out.push({ o: e, k: 'gnd', t: 'enemy', x: e.x, y: e.y, z: gz(e.x, e.y) + 2, nm: (typeof KIND_NAME === 'object' && KIND_NAME[e.kind]) || '阵地' });
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead && (spec || inVision(v.x, v.y))) out.push({ o: v, k: 'gnd', t: 'veh', x: v.x, y: v.y, z: gz(v.x, v.y) + 2, nm: '装甲车辆' });
  for (const a of S.armor || []) if (!a.dead && (spec || inVision(a.x, a.y))) out.push({ o: a, k: 'gnd', t: 'armor', x: a.x, y: a.y, z: gz(a.x, a.y) + 2, nm: '装甲车' });
  for (const e of S.eships || []) if (!e.dead && (spec || inVision(e.x, e.y) || S.t - (e.det ?? -99) < 10)) out.push({ o: e, k: 'sea', t: 'eship', x: e.x, y: e.y, z: 4, nm: (typeof NV_CLS === 'object' && NV_CLS[e.cls] && NV_CLS[e.cls].name) || '敌舰' });
  return out;
}
// 空格主炮、F 垂发
function fpFire(alt) {
  if (!V3FP.on || V3FP.k !== 'ship' || V3FP.cool > 0) return;
  const o = V3FP.o, A = fpAim();
  if (!A) { log('准星没有对着地面或目标', 'warn', 'fpaim', 2); return; }
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
// 这一帧单位在哪、什么姿态：飞机按物理引擎的位置、姿态（推演两步之间插值）；舰在舰桥顶上随浪轻摇。yaw 世界坐标角，pitch 向上为正，roll 右压坡度为正
function fpPose() {
  const o = V3FP.o;
  if (!o) return null;
  if (V3FP.k === 'air') {
    const F = o.fl;
    if (!F) return { x: o.x, y: o.y, z: v3AirZ(o), yaw: o.heading || 0, pitch: 0, roll: o.bank || 0 };   // 刚接手、物理状态还没建
    const r = fpRS(o);
    return { x: r.x, y: r.y, z: r.z, yaw: r.heading, pitch: r.pitch, roll: r.roll, F };
  }
  const L = fpShipLen(o), h = o.heading ?? -1.57, t = performance.now() / 1000;
  return { x: o.x + Math.cos(h) * L * .1, y: o.y + Math.sin(h) * L * .1, z: -2.6 + L * .17, yaw: h, pitch: -.03 + Math.sin(t * .7) * .006, roll: Math.sin(t * .5) * .012 };   // 舰随浪轻轻摇
}
// 绕单位轴 k 转 t（罗德里格斯公式）
const fpRot = (v, k, t) => { const c = Math.cos(t), s = Math.sin(t), d = v3Dot(k, v) * (1 - c), x = v3Cross(k, v); return [v[0] * c + x[0] * s + k[0] * d, v[1] * c + x[1] * s + k[1] * d, v[2] * c + x[2] * s + k[2] * d]; };
// 机体轴（GL 坐标）：机头 f、座舱顶 u、右翼 r
function fpAxes(P) {
  const cp = Math.cos(P.pitch), f = [cp * Math.cos(P.yaw), -cp * Math.sin(P.yaw), Math.sin(P.pitch)], r0 = v3Norm(v3Cross(f, [0, 0, 1])), u = fpRot(v3Cross(r0, f), f, P.roll);
  return { f, u, r: v3Norm(v3Cross(f, u)) };
}
// 投影矩阵（近裁剪面 n、雾的尺度 D）
function fpProj(E, x, y, z, D, n) {
  const view = new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -v3Dot(x, E), -v3Dot(y, E), -v3Dot(z, E), 1]);
  const rd = v3RD(), fog = [D * 1.3 * rd, D * 2.8 * rd], asp = CAM.vw / Math.max(1, CAM.vh), fo = 1 / Math.tan(V3_FOV / 2), fa = Math.max(D * 9, fog[1] * 1.5), nf = 1 / (n - fa);
  const proj = new Float32Array([fo / asp, 0, 0, 0, 0, fo, 0, 0, 0, 0, (fa + n) * nf, -1, 0, 0, 2 * fa * n * nf, 0]);
  return (V3.cam = { E, x, y, z, D, rd, fog, asp, M: v3Mul(proj, view) });
}
// 受力回馈：镜头抖动（大迎角抖振最猛，过载、加力、开火冲击次之），返回 [右, 上] 两个小角度（弧度）
function fpShake() {
  if (!V3FP.ffb || V3FP.k !== 'air') return null;
  const a = V3FP.buf * .0045 + smooth(5, 9, (V3FP.o.fl || {}).nz || 1) * .0016 + (V3FP.ab ? .0005 : 0) + V3FP.imp * .006;
  if (a < 1e-5) return null;
  const t = performance.now() / 1000;
  return [a * (Math.sin(t * 61) + Math.sin(t * 37.3) * .6), a * (Math.sin(t * 53.7 + 1) + Math.sin(t * 29.1) * .6)];
}
// 飞机的追尾镜头：鼠标瞄准时镜头顺着瞄准方向看（飞机飞进准星），鼠标摇杆时跟着机体姿态（略带滞后）——筋斗、横滚时镜头跟着翻过去；
//   按住 C（或手柄右摇杆）自由视角绕着飞机转；滚轮改远近
function fpChaseCam(P) {
  const o = V3FP.o, L = fpLen(o), d = clamp(V3FP.cd, L * 1.3, 2000), now = performance.now(), dt = clamp((now - (V3FP.ct || now)) / 1000, 0, .1);
  V3FP.ct = now;
  const B = fpBody(o), k = 1 - Math.exp(-dt * 7);   // 机体轴带一点滞后
  const lerp3 = (a, b) => a ? v3Norm([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]) : b;
  V3FP.cf = lerp3(V3FP.cf, B.f); V3FP.cu = lerp3(V3FP.cu, B.u);
  // 鼠标瞄准：镜头顺着准星；手动压杆、拉杆时（以及鼠标摇杆）跟着机体姿态（筋斗、横滚时一起翻过去），两种之间约半秒平滑过渡
  const bw = V3FP.bw = clamp((V3FP.bw ?? 0) + (V3FP.ctl === 'aim' && o.fl && !V3FP.man ? -dt : dt) * 2.5, 0, 1);
  let f = V3FP.cf, c = V3FP.cu;
  if (bw < 1) { const a = fpAimDir(), au = fpAimUp(); f = v3Norm([a[0] + (f[0] - a[0]) * bw, a[1] + (f[1] - a[1]) * bw, a[2] + (f[2] - a[2]) * bw]); c = [au[0] + (c[0] - au[0]) * bw, au[1] + (c[1] - au[1]) * bw, au[2] + (c[2] - au[2]) * bw]; }
  // 镜头上方：平时取世界的「上」（横滚时地平线不跟着转，看得见飞机在滚）；机头接近竖直（拉筋斗）时世界的上方没法用，换成机体的上方，顺着翻过去
  const cl = [0, 0, 1], wv = smooth(.82, .97, Math.abs(f[2])), cm = [cl[0] + (c[0] - cl[0]) * wv, cl[1] + (c[1] - cl[1]) * wv, cl[2] + (c[2] - cl[2]) * wv], q0 = v3Dot(cm, f);
  let u = v3Norm([cm[0] - f[0] * q0, cm[1] - f[1] * q0, cm[2] - f[2] * q0]);
  // 自由视角：松开 C 后慢慢转回机尾后方
  if (!V3FP.free && !V3FP.gpLook) { const kb = 1 - Math.exp(-dt * 4); V3FP.orb[0] *= 1 - kb; V3FP.orb[1] *= 1 - kb; }
  if (Math.abs(V3FP.orb[0]) + Math.abs(V3FP.orb[1]) > 1e-4) { f = fpRot(f, u, -V3FP.orb[0]); const r = v3Norm(v3Cross(f, u)); f = fpRot(f, r, V3FP.orb[1]); u = fpRot(u, r, V3FP.orb[1]); }
  const sh = fpShake();
  if (sh) { const r = v3Norm(v3Cross(f, u)); f = v3Norm([f[0] + r[0] * sh[0] + u[0] * sh[1], f[1] + r[1] * sh[0] + u[1] * sh[1], f[2] + r[2] * sh[0] + u[2] * sh[1]]); }
  const T = [P.x, -P.y, P.z], E = [T[0] - f[0] * d + u[0] * d * .16, T[1] - f[1] * d + u[1] * d * .16, T[2] - f[2] * d + u[2] * d * .16];
  const g = typeof v3HtX === 'function' ? v3HtX(E[0], -E[1]) : v3Ht(clamp(E[0], 0, W - 1), clamp(-E[1], 0, H - 1));
  if (E[2] < g + 3) E[2] = g + 3;   // 不钻到地面以下
  const z = [-f[0], -f[1], -f[2]], x = v3Norm(v3Cross(u, z)), y = v3Cross(z, x), alt = Math.max(1, E[2] - Math.max(g, -2.6));
  V3FP.camF = f;
  return fpProj(E, x, y, z, clamp(Math.max(alt * 5, d * 6), 520, 2600), clamp(d * .015, .4, 8));
}
// —— 模型自带的座舱（v3g.js V3G_PIT：歼-31 / 歼-35、歼-20）：座舱视角就坐进模型里，看到的是模型自己的仪表板、座椅、平显，显示屏放实时画面 ——
const fpMdlKey = o => (typeof V3G_AIR === 'object' && typeof airSilKey === 'function' && V3G_AIR[airSilKey(o.kind, o.v)]) || 'j31';
const fpPitOn = o => { if (!o || typeof V3G_PIT !== 'object') return false; const k = fpMdlKey(o), M = typeof V3G === 'object' && V3G.M[k]; return !!(V3G_PIT[k] && M && M.ready); };
// 模型在世界里的变换（与 v3units.js plane() → v3g.js v3gPlane 同一套：按航迹的俯仰、坡度、刚离舰的下沉）；model 坐标（米）→ GL 坐标
function fpMdlXf(o) {
  const key = typeof airSilKey === 'function' ? airSilKey(o.kind, o.v) : 'j35', M = V3G.M[fpMdlKey(o)], sz = airMdl(o.kind, o.v).size || ((typeof AIR_SPEC === 'object' && AIR_SPEC[o.kind]) || {}).size || 15;
  // 甲板上（登机、牵引、弹射）：和航母画的一样，机轮贴着飞行甲板顶面（升降机上的跟着平台升降），机身不俯仰
  const k = sz / M.meta.len, zc = M.meta.zc, dk = fpOnDeck(o) && typeof CVG === 'object' ? -2.6 + CVG.zd - CVG.hang * (typeof cvDeckSink === 'function' ? cvDeckSink(o) : 0) : null, rs = o.fl && o.fp ? fpRS(o) : null;
  const Ln = dk == null && !rs && typeof v3dLaunch === 'function' ? v3dLaunch(o) : null, z = dk != null ? dk + zc * k : rs ? rs.z : v3AirZ(o) + (Ln ? Ln.dz : 0);
  const pt = dk != null ? 0 : rs ? rs.pitch : typeof V3G_HELI === 'object' && V3G_HELI[key] ? 0 : typeof v3dPitch === 'function' ? v3dPitch(o, 0, z, Ln, key) : 0, h = rs ? rs.heading : o.heading || 0, rl = dk != null ? 0 : rs ? rs.roll : o.bank || 0;   // 物理引擎在飞：机身姿态就是它的（插值后的）
  const ox = rs ? rs.x : o.x, oy = rs ? rs.y : o.y;
  const rot = v => v3dMv3(h, pt, rl, v);
  return { rot, pt: v => { const r = rot([v[0] * k, v[1] * k, (v[2] - zc) * k]); return [ox + r[0], -oy + r[1], z + r[2]]; } };
}
// 座舱里头的转动：鼠标瞄准时头转向准星（像《战争雷霆》的座舱瞄准），按住 C 自由看；抖振时加一点抖动
function fpHead(o, dt) {
  let want = V3FP.look;
  if (V3FP.ctl === 'aim' && o.fl && !V3FP.free) {
    const R = flRot(o.fl.q), A = fpAimDir(), b = flMtv(R, [A[1], A[0], -A[2]]);
    want = [clamp(Math.atan2(b[1], b[0]), -2.4, 2.4), clamp(Math.atan2(-b[2], Math.hypot(b[0], b[1])), -.7, 1.3)];
  }
  const h = V3FP.head || (V3FP.head = [0, 0]), k = 1 - Math.exp(-dt * 8);
  h[0] += (want[0] - h[0]) * k; h[1] += (want[1] - h[1]) * k;
  const sh = fpShake();
  return sh ? [h[0] + sh[0], h[1] + sh[1]] : h;
}
function fpPitCam() {
  const o = V3FP.o, cf = V3G_PIT[fpMdlKey(o)], X = fpMdlXf(o), now = performance.now(), dt = clamp((now - (V3FP.ht || now)) / 1000, 0, .1);
  V3FP.ht = now;
  let f = v3Norm(X.rot([1, 0, 0])), u = v3Norm(X.rot([0, 0, 1]));
  // 头随过载下沉 / 上浮（每 g 约 1.2 厘米，最多 9 厘米）：受力回馈
  const nz = V3FP.ffb && o.fl ? o.fl.nz : 1; V3FP.hdn = (V3FP.hdn || 0) + (clamp((nz - 1) * .012, -.05, .09) - (V3FP.hdn || 0)) * Math.min(1, dt * 6);
  const dn = V3FP.hdn, E0 = X.pt(cf.eye), E = [E0[0] - u[0] * dn, E0[1] - u[1] * dn, E0[2] - u[2] * dn];
  const hd = fpHead(o, dt);
  f = fpRot(f, u, -hd[0]);
  const r1 = v3Norm(v3Cross(f, u));
  f = fpRot(f, r1, hd[1]); u = fpRot(u, r1, hd[1]);
  const z = [-f[0], -f[1], -f[2]], x = v3Norm(v3Cross(u, z)), y = v3Cross(z, x), alt = E[2] - v3Ht(clamp(o.x, 0, W - 1), clamp(o.y, 0, H - 1));
  V3FP.camF = f;
  return fpProj(E, x, y, z, clamp(alt * 5, 520, 2600), .08);   // 近裁剪面 8 厘米：仪表板就在眼前七八十厘米
}
// 尾喷口开合（v3units.js 画飞机时传给 v3gPlane）：真实的收扩喷口——慢车张开、巡航中间、不开加力的最大推力收到最小、开加力张到最大；作动筒约一秒到位
const FP_NOZ = [.1, 0, -.13, .24];
const fpNoz = o => V3FP.on && V3FP.o === o ? V3FP.nozV || 0 : 0;
// —— 导弹视角：发射后镜头跟着刚打出去的那枚弹（弹后上方十几米，顺着弹的速度方向看；鼠标绕着弹转），弹炸了在原地停一秒半看爆炸，再回到飞机；V 提前回去。
//   这时飞机照原来的航向飞（鼠标不再带机头），键盘的杆、舵、油门照样管用 ——
function fpMslOn(m) { if (V3FP.k !== 'air' || !m) return; Object.assign(V3FP, { mv: m.id, mo: [0, 0], mf: null, mp: null, mEnd: null, mt: null }); }
function fpMslOff() { Object.assign(V3FP, { mv: null, mf: null, mp: null, mEnd: null }); }
function fpMslCam() {
  const now = performance.now(), dt = clamp((now - (V3FP.mt || now)) / 1000, 0, .1), m = S.missiles.find(q => q.id === V3FP.mv && q.fw);
  V3FP.mt = now;
  if (m && !m.done) {
    const v = m.fw.v, sp = Math.hypot(v[0], v[1], v[2]) || 1, f0 = [v[0] / sp, v[1] / sp, v[2] / sp], k = 1 - Math.exp(-dt * 5);
    V3FP.mf = V3FP.mf ? v3Norm([0, 1, 2].map(i => V3FP.mf[i] + (f0[i] - V3FP.mf[i]) * k)) : f0;
    V3FP.mp = [m.x, -m.y, m.z3];
  } else if (!V3FP.mp || (V3FP.mEnd = V3FP.mEnd || now, now - V3FP.mEnd > 1500)) { fpMslOff(); return null; }
  let f = V3FP.mf;
  const hz = Math.hypot(f[0], f[1]), r0 = hz > .05 ? v3Norm([f[1], -f[0], 0]) : v3Norm(v3Cross(f, fpBody(V3FP.o).u));   // 弹接近竖直时用飞机的上方定左右
  let u = v3Norm(v3Cross(r0, f));
  if (V3FP.mo[0] || V3FP.mo[1]) { f = fpRot(f, u, -V3FP.mo[0]); const r = v3Norm(v3Cross(f, u)); f = fpRot(f, r, V3FP.mo[1]); u = fpRot(u, r, V3FP.mo[1]); }
  const d = 16, T = V3FP.mp, E = [T[0] - f[0] * d + u[0] * d * .22, T[1] - f[1] * d + u[1] * d * .22, T[2] - f[2] * d + u[2] * d * .22];
  const g = typeof v3HtX === 'function' ? v3HtX(E[0], -E[1]) : v3Ht(clamp(E[0], 0, W - 1), clamp(-E[1], 0, H - 1));
  if (E[2] < Math.max(g, -2.6) + 2) E[2] = Math.max(g, -2.6) + 2;
  const z = [-f[0], -f[1], -f[2]], x = v3Norm(v3Cross(u, z)), y = v3Cross(z, x);
  V3FP.camF = f;
  return fpProj(E, x, y, z, 1600, .3);
}
function v3fpCamera() {
  const P = fpPose() || { x: CAM.x, y: CAM.y, z: 200, yaw: 0, pitch: -.3, roll: 0 };
  if (V3FP.k === 'air' && V3FP.mv != null) { const C = fpMslCam(); if (C) return C; }
  if (V3FP.k === 'air' && V3FP.vw !== 'cock') return fpChaseCam(P);
  if (V3FP.k === 'air' && fpPitOn(V3FP.o)) return fpPitCam();
  const B = V3FP.k === 'air' ? fpBody(V3FP.o) : fpAxes(P);
  let f = B.f, u = B.u, E = [P.x, -P.y, P.z];
  if (V3FP.k === 'air') { const L = fpLen(V3FP.o); E = [E[0] + f[0] * L * .3 + u[0] * 1.1, E[1] + f[1] * L * .3 + u[1] * 1.1, E[2] + f[2] * L * .3 + u[2] * 1.1]; }   // 座舱：机身中线前方三成机长、上方 1.1 米
  // 头部转动（鼠标看四周；飞机鼠标瞄准时转向准星）：先绕座舱顶方向转（左右看），再绕右侧方向转（抬头低头）
  const now = performance.now(), hd = V3FP.k === 'air' ? fpHead(V3FP.o, clamp((now - (V3FP.ht || now)) / 1000, 0, .1)) : V3FP.look;
  V3FP.ht = now;
  f = fpRot(f, u, -hd[0]);
  const r1 = v3Norm(v3Cross(f, u));
  f = fpRot(f, r1, hd[1]); u = fpRot(u, r1, hd[1]);
  const z = [-f[0], -f[1], -f[2]], x = v3Norm(v3Cross(u, z)), y = v3Cross(z, x);
  const alt = P.z - v3Ht(clamp(P.x, 0, W - 1), clamp(P.y, 0, H - 1));
  V3FP.camF = f;
  return fpProj(E, x, y, z, clamp(alt * 5, 520, 2600), .4);
}
// 每帧（view3d.js v3Draw 开头）：画面中心跟着视线落点（贴图、细节档都按它）；舰的主炮目标、尾喷口开合、座舱玻璃
function v3fpStep(now) {
  const P = fpPose(), o = V3FP.o;
  if (!P) return;
  const chase = V3FP.k === 'air' && V3FP.vw !== 'cock', cf = V3FP.k === 'air' && V3FP.camF;   // 飞机：按上一帧镜头的视线（追尾、座舱都是）
  const yaw = cf ? Math.atan2(-cf[1], cf[0]) : P.yaw + V3FP.look[0], pitch = cf ? Math.asin(clamp(cf[2], -1, 1)) : P.pitch + V3FP.look[1];
  const g = v3Ht(clamp(P.x, 0, W - 1), clamp(P.y, 0, H - 1)), alt = Math.max(1, P.z - g);
  const cp = Math.cos(pitch), down = -Math.sin(pitch), reach = chase ? clamp(V3FP.cd * 2 + 200, 250, 1400) : down > .08 ? Math.min(1600, alt / down * cp) : 900;
  CAM.x = clamp(P.x + Math.cos(yaw) * reach * (chase ? .5 : 1), 0, W); CAM.y = clamp(P.y + Math.sin(yaw) * reach * (chase ? .5 : 1), 0, H);
  CAM.z = CAM.fit * clamp(1800 / Math.max(60, alt + reach * .35), 1.2, 9);
  if (V3FP.mv != null && V3FP.mp) { const mx = V3FP.mp[0], my = -V3FP.mp[1], ma = Math.max(1, V3FP.mp[2] - v3Ht(clamp(mx, 0, W - 1), clamp(my, 0, H - 1))); CAM.x = clamp(mx, 0, W); CAM.y = clamp(my, 0, H); CAM.z = CAM.fit * clamp(1800 / Math.max(60, ma + 300), 1.2, 9); }   // 导弹视角：贴图、细节按弹附近
  V3FP.lock = V3.cam && V3FP.k === 'ship' ? fpLockTarget() : null;
  if (V3FP.k === 'air') {   // 尾喷口：按油门、加力（油尽熄火时张开）慢慢开合
    const dt = clamp((now - (V3FP.nozT || now)) / 1000, 0, .1), F = o.fl, want = (o.fuel ?? 1) > 0 ? (F && F.ab ? FP_NOZ[3] : V3FP.thr > .92 ? FP_NOZ[2] : V3FP.thr > .45 ? FP_NOZ[1] : FP_NOZ[0]) : .15;
    V3FP.nozT = now; V3FP.nozV = (V3FP.nozV || 0) + (want - (V3FP.nozV || 0)) * Math.min(1, dt * 1.6);
  }
  // 这型飞机的座舱盖玻璃：坐在座舱里几乎全透明（只留一点反光），跟随视角从外面也看得见座舱里面；平显玻璃（模型里是一整块不透明的亮绿色）换成透明的淡绿玻璃（v3g.js）
  if (typeof V3G === 'object') { const mk = V3FP.k === 'air' ? fpMdlKey(o) : null; V3G.glass = mk ? { key: mk, k: chase ? .6 : .2, hud: typeof V3G_PIT === 'object' && V3G_PIT[mk] ? V3G_PIT[mk].hud : null } : null; }
}
// 画面中心附近（60 像素内）最近的已知敌人：工事、车辆、装甲车、敌舰（舰的主炮、垂发打它）
function fpLockTarget() {
  const cx = CAM.vw / 2, cy = CAM.vh / 2, o = V3FP.o;
  let best = null, bs = 60;
  for (const c of fpFoes(false)) {
    if (c.k === 'air' || dist(c.x, c.y, o.x, o.y) > 1600) continue;
    const q = v3Proj(c.x, c.y, c.z);
    if (!q || q.f > .97) continue;
    const d = Math.hypot(q.x - cx, q.y - cy);
    if (d < bs) { bs = d; best = { ...c, q }; }
  }
  return best;
}

// 过载的生理效应：持续大过载视野四周变黑、收窄（黑视），负过载发红（红视）——受力回馈的一部分（G 键关掉）
function fpGfx(ctx, w, h) {
  if (!V3FP.ffb) return;
  for (const [v, c] of [[V3FP.gb, '0,0,0'], [V3FP.rb, '120,0,0']]) {
    if (v < .02) continue;
    // 四周先暗、视野往里收（最多收到画面高度的四成），中间一直看得见——游戏里不能真的晕过去
    const r0 = Math.hypot(w, h) * .5, r1 = Math.max(h * .2, r0 * (1 - v * .62)), g = ctx.createRadialGradient(w / 2, h / 2, r1 * .55, w / 2, h / 2, r1 + (r0 - r1) * .35);
    g.addColorStop(0, `rgba(${c},0)`); g.addColorStop(1, `rgba(${c},${Math.min(.92, .25 + v * .7)})`);
    ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); if (v > .85) { ctx.fillStyle = `rgba(${c},${(v - .85) * 1.6})`; ctx.fillRect(0, 0, w, h); } ctx.restore();
  }
}
// —— 画面（view3d.js v3Overlay 调用，屏幕空间）：只有武器平显（fpwpn.js）与过载的黑视 / 红视，别的标识都不画 ——
function v3fpOverlay(ctx) {
  if (!V3FP.on || !V3FP.o || V3FP.k !== 'air') return;
  if (typeof fwHud === 'function') fwHud(ctx);
  fpGfx(ctx, CAM.vw, CAM.vh);
}

// —— 输入 ——
function fpView(v = V3FP.vw === 'cock' ? 'chase' : 'cock') { V3FP.vw = v; V3FP.look = [0, 0]; }
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('keydown', e => {
    if (!V3FP.on || (e.target && e.target.closest && e.target.closest('input,textarea,select'))) return;
    if (!V3FP_KEYS[e.code]) return;
    e.preventDefault(); e.stopPropagation();   // 操纵时这些键只归这里（不然 V、T、F、R 还会选中支援菜单的工具，方向键会平移地图）
    if (e.repeat) return;
    V3FP.keys.add(e.code);
    if (V3FP.k === 'air') {   // 杆、舵、油门在 fpFly 里按住多久推多少；这里只处理按一下的
      if (e.code === 'KeyV') { if (V3FP.mv != null) fpMslOff(); else fpView(); }   // 导弹视角里按 V 回到飞机
      if (e.code === 'KeyF') fwFire();
      const dg = /^Digit([1-6])$/.exec(e.code);
      if (dg) fwSel(+dg[1] - 1);
      if (e.code === 'KeyC') { V3FP.free = true; if (V3FP.ctl === 'stick') V3FP.ms = [0, 0]; }   // 按住自由视角（鼠标摇杆时顺便杆回中）
      if (e.code === 'KeyM') { V3FP.ctl = V3FP.ctl === 'aim' ? 'stick' : 'aim'; V3FP.ms = [0, 0]; if (V3FP.ctl === 'aim' && V3FP.o) { const B = fpBody(V3FP.o); V3FP.aim = [Math.atan2(-B.f[1], B.f[0]), Math.asin(clamp(B.f[2], -1, 1))]; } log(V3FP.ctl === 'aim' ? '鼠标瞄准' : '鼠标摇杆', 'info', 'fpctl', 1); }
      if (e.code === 'KeyG') { V3FP.ffb = !V3FP.ffb; log(V3FP.ffb ? '受力回馈：开' : '受力回馈：关', 'info', 'fpffb', 1); }
      if (e.code === 'KeyX') { V3FP.law = V3FP.law === 'n' ? 'd' : 'n'; log(V3FP.law === 'd' ? '飞控：直接律' : '飞控：正常律', 'info', 'fplaw', 1); }
    } else {
      if (e.code === 'KeyW' || e.code === 'KeyS') V3FP.tele = clamp(V3FP.tele + (e.code === 'KeyW' ? 1 : -1), 0, FP_TELE.length - 1);   // 车钟：按一下一档
      if (e.code === 'KeyF') fpFire(true);
      if (e.code === 'Space') fpFire(false);
      if (e.code === 'KeyC') V3FP.look = [0, 0];
    }
  }, true);
  window.addEventListener('keyup', e => { V3FP.keys.delete(e.code); if (e.code === 'KeyC') V3FP.free = false; }, true);
  window.addEventListener('blur', () => V3FP.keys.clear());
  window.addEventListener('pointermove', e => {
    if (!V3FP.on) return;
    let dx = 0, dy = 0;
    if (fpLocked()) { dx = e.movementX || 0; dy = e.movementY || 0; }
    else if (V3FP.drag) { dx = e.clientX - V3FP.drag[0]; dy = e.clientY - V3FP.drag[1]; V3FP.drag = [e.clientX, e.clientY]; }
    if (!dx && !dy) return;
    if (V3FP.k === 'air') {
      if (V3FP.mv != null) { V3FP.mo[0] = airAng(V3FP.mo[0] + dx * .005); V3FP.mo[1] = clamp(V3FP.mo[1] - dy * .004, -1.3, 1.3); return; }   // 导弹视角：鼠标绕着弹看，不带机头
      if (V3FP.free || (V3FP.drag && V3FP.dbtn === 2)) {   // 自由视角（按住 C 或右键拖动）：追尾绕着飞机转、座舱里转头
        if (V3FP.vw === 'cock') { V3FP.look[0] = clamp(V3FP.look[0] + dx * .0024, -2.6, 2.6); V3FP.look[1] = clamp(V3FP.look[1] - dy * .0024, -1.2, .9); }
        else { V3FP.orb[0] = airAng(V3FP.orb[0] - dx * .005); V3FP.orb[1] = clamp(V3FP.orb[1] - dy * .004, -1.4, 1.4); }
        return;
      }
      if (V3FP.ctl === 'stick') { V3FP.ms[0] = clamp(V3FP.ms[0] + dx * .0035, -1, 1); V3FP.ms[1] = clamp(V3FP.ms[1] + dy * .0035, -1, 1); return; }   // 鼠标往下拉 = 拉杆
      // 鼠标瞄准：俯仰可以越过 90°（拉筋斗时顺着翻过去），倒飞时左右照屏幕方向
      const up = Math.cos(V3FP.aim[1]) >= 0 ? 1 : -1;
      V3FP.aim[0] = airAng(V3FP.aim[0] + dx * .0022 * up); V3FP.aim[1] = airAng(V3FP.aim[1] - dy * .0022);
      return;
    }
    V3FP.look[0] = clamp(V3FP.look[0] + dx * .0024, -2.6, 2.6); V3FP.look[1] = clamp(V3FP.look[1] - dy * .0024, -1.2, .9);
  });
  window.addEventListener('mouseup', () => { V3FP.drag = null; });
  // 滚轮：跟随视角拉远拉近（不交给 3D 自由镜头）
  window.addEventListener('wheel', e => {
    if (!V3FP.on || V3FP.k !== 'air' || V3FP.vw === 'cock' || typeof R !== 'object' || e.target !== R.cv) return;
    V3FP.cd = clamp(V3FP.cd * Math.exp(e.deltaY * .0012), fpLen(V3FP.o) * 1.3, 600);
    e.preventDefault(); e.stopPropagation();
  }, { passive: false, capture: true });
  if (typeof document !== 'undefined') document.addEventListener('pointerlockchange', () => { if (V3FP.on && !fpLocked()) V3FP.keys.clear(); });
}
// 快捷键（input.js runHook('key')）：P 弹出 / 收起选择列表；操纵时 Esc 退出，W A S D Q E C F V T 空格、方向键、数字键不触发原来的功能
HOOK.key.push(e => {
  const k = e.key;
  if ((k === 'p' || k === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && typeof v3Can === 'function' && v3Can() && S && (S.phase === 'battle' || S.phase === 'deploy' || S.phase === 'sandbox')) { fpMenu(!fpMenuOpen()); return true; }   // 弹出 / 收起选择列表
  if (!V3FP.on) return false;
  if (k === 'Escape') { fpExit(); return true; }
  if (V3FP_KEYS[e.code]) return true;
  return false;
});
// 鼠标：操纵时点击不下命令。飞机：锁定鼠标（移动 = 瞄准 / 杆），右键拖动自由视角；锁不上的设备拖动代替；舰：没锁定时点一下锁定，按住拖动也能看四周
HOOK.pointer.push((e, kind) => {
  if (!V3FP.on) return false;
  if (e.target && e.target.closest && e.target.closest('#fpPad')) return true;
  if (V3FP.k === 'air') {
    if (kind === 'down') { V3FP.dbtn = e.button; if (fpLocked()) { V3FP.drag = e.button === 2 ? [e.clientX, e.clientY] : null; if (e.button === 0) fwFire(); } else { V3FP.drag = [e.clientX, e.clientY]; if (!V3.coarse) fpLock(); } }   // 锁定鼠标后左键开火（头一下先锁定鼠标）
    if (kind === 'up') V3FP.drag = null;
    return true;
  }
  if (kind === 'down') { if (!fpLocked()) { fpLock(); V3FP.drag = [e.clientX, e.clientY]; } }
  if (kind === 'up') V3FP.drag = null;
  return true;
});
// 退出 3D、换局时一起退出
HOOK.frame.push(() => { if (V3FP.on && (!V3.on || !S || (V3FP.o && V3FP.k === 'air' && !S.planes.includes(V3FP.o) && !V3FP.o.dead))) fpExit(); });
HOOK.newGame.push(() => { if (V3FP.on) fpExit(); fpMenu(false); });

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
    const T = V3FP.touch, air = () => V3FP.k === 'air';
    // 飞机：▲ 推杆、▼ 拉杆、◀ ▶ 滚转（按住），油门 ± 按住，「武器」换下一种、「开火」打红框；舰：▲ ▼ 车钟、◀ ▶ 转舵，「开火」主炮、「武器」垂发
    mk(L, '▲', () => { if (air()) T.y = -1; else V3FP.tele = Math.min(FP_TELE.length - 1, V3FP.tele + 1); }, () => { T.y = 0; });
    mk(L, '◀', () => { T.x = -1; }, () => { T.x = 0; });
    mk(L, '▶', () => { T.x = 1; }, () => { T.x = 0; });
    mk(L, '▼', () => { if (air()) T.y = 1; else V3FP.tele = Math.max(0, V3FP.tele - 1); }, () => { T.y = 0; });
    mk(L, '油门+', () => { if (air()) V3FP.keys.add('KeyW'); else V3FP.tele = Math.min(FP_TELE.length - 1, V3FP.tele + 1); }, () => V3FP.keys.delete('KeyW'));
    mk(L, '油门−', () => { if (air()) V3FP.keys.add('KeyS'); else V3FP.tele = Math.max(0, V3FP.tele - 1); }, () => V3FP.keys.delete('KeyS'));
    mk(Rg, '开火', () => { if (air()) fwFire(); else fpFire(false); });
    mk(Rg, '武器', () => { if (air()) fwNext(); else fpFire(true); });
    mk(Rg, '加力', () => { if (air()) V3FP.ab = !V3FP.ab; });
    mk(Rg, '回正', () => { V3FP.look = [0, 0]; V3FP.orb = [0, 0]; V3FP.ms = [0, 0]; });
    mk(Rg, '视角', () => { if (air()) fpView(); });
    mk(Rg, '列表', () => fpMenu(true));
    mk(Rg, '退出', () => fpExit());
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
  b.id = 'btnFp'; b.type = 'button'; b.className = 'tb'; b.textContent = '驾驶'; b.title = '亲自操纵（P）：弹出列表选 055 驱逐舰或飞机；Esc 退出'; b.setAttribute('aria-pressed', 'false');
  b.style.minWidth = '48px'; b.style.fontSize = '13px';
  b.addEventListener('click', () => fpMenu(!fpMenuOpen()));   // 弹出选择列表，自己点要开的
  c.appendChild(b);
  const st = document.createElement('style');
  st.textContent = '#btnFp.on { color: var(--bg); background: var(--g); border-color: var(--g); }';
  document.head.appendChild(st);
}
if (typeof document !== 'undefined' && document.addEventListener) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fpButton); else setTimeout(fpButton, 0); }
