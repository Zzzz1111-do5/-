'use strict';
// 亲自操纵（3D 地图里，P 键或右上角「驾驶」按钮）：055 驱逐舰，以及升空的战斗机（歼-20、歼-50）、歼-35、歼-15T、歼-16D——
//   这一个单位的 AI 让出指挥（别的照常推演）；按 P 或「驾驶」弹出列表自己选要开的，Esc 退出、交回 AI。画面上不画别的标识，只有武器平显（fpwpn.js）
//   飞机：飞控物理引擎（flight.js 六自由度 + 电传飞控）真飞；操纵默认照《皇牌空战》——鼠标（右摇杆）移动准心、飞机朝准心飞（教官压坡度带杆），A / D（左摇杆左右）横滚、按住一直滚，↑ / ↓ 推杆 / 拉杆，机动性放大 FP_MK 倍；
//         M 依次切换《战争雷霆》式鼠标瞄准（鼠标指哪儿，教官压坡度、拉杆把机头带过去）、鼠标摇杆（鼠标移动的就是杆）；W / S 油门（推满后按住 W 开加力）、Q / E 方向舵（按住时这一轴归玩家）；
//         能连续横滚、筋斗、反筋斗；杆量有平滑、死区与指数响应曲线；受力回馈：手柄震动、大迎角抖振、过载黑视 / 红视、头部随过载晃动（G 开关）；
//         镜头绕着飞机：皇牌空战式操纵时顺着准心看（世界坐标里的方向，飞机翻滚时不跟着转；C 把准心转回机头方向，按住右键拖动看四周），
//         别的方式跟在机尾（按住 C 自由视角）；滚轮拉远拉近——座舱视角去掉了；手柄也能飞；
//         武器（fpwpn.js）：数字键选武器、F / 左键开火（要锁稳）、R / 右键单击换目标、空格航炮；发射后右上角小屏跟着导弹看，V 放大 / 缩回；
//         降落（自己飞）：G 起落架、L 襟翼、B 减速板（地上是刹车）、H 尾钩——航母斜角甲板上挂住拦阻索、夺取的机场跑道上停下来，就交给地勤整备；
//         弹射起飞仍由甲板作业流程完成（坐在里面看）；
//         电子战（ew.js）：歼-16D 按 J 开关干扰吊舱；所有机型右下角有雷达告警（照着你的敌雷达的方位、种类，被压制的、正用导弹打你的），导弹来袭报警
//   军舰：A / D 转舵，W / S 车钟加减一档（后退一 · 停车 · 前进一二三），空格主炮打视线中心的点，F 垂发导弹（按目标自动选弹）；鼠标看四周（点一下画面锁定鼠标，或按住左键拖动），C 视线回正
//   手机：屏幕下方出现操纵按钮
// 推演：carrier.js flyPlane、support.js updateDD、units.js updateShips、sandbox.js sbxFireShips 见到 o.fp 就不再替它做主（飞机在 fpFly 里飞，舰在 fpSail 里开）
const V3FP = { on: false, k: null, o: null, keys: new Set(), look: [0, 0], thr: .8, tele: 3, rud: 0, cool: 0, drag: null, touch: { x: 0, y: 0, ab: false }, lock: null, law: 'n', ap: false,
  vw: 'chase', orb: [0, 0], cd: 80, ws: -1, lk: {}, fwC: [], bay: { main: 0, side: 0, ext: 0 },
  ctl: 'ace', aim: [0, 0], ms: [0, 0], kx: { r: 0, p: 0, y: 0 }, ins: { x: 0, y: 0, r: 0 }, ab: false, abT: 0, ffb: true, gb: 0, rb: 0, buf: 0, imp: 0, free: false, gpB: [],
  mv: null, mo: [0, 0], mf: null, mp: null, mEnd: null, fq: null, msg: null, mBig: false, mlT: 0,
  gear: false, flapC: 0, hook: false, landed: null, bul: [], gunA: 0, tgK: null, lkT: 0, fwT: null };   // mv：导弹小屏正跟着的弹（mBig：放大成全屏）；fq：按了开火、等舱门开好 / 锁稳；gear / flapC / hook：起落架、襟翼、尾钩的手柄位置
const V3FP_KEYS = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, KeyQ: 1, KeyE: 1, KeyC: 1, KeyF: 1, KeyX: 1, KeyV: 1, KeyT: 1, KeyM: 1, KeyG: 1, KeyR: 1, KeyB: 1, KeyH: 1, KeyL: 1, KeyK: 1, KeyJ: 1, Space: 1, ShiftLeft: 1, ShiftRight: 1, ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1, Digit1: 1, Digit2: 1, Digit3: 1, Digit4: 1, Digit5: 1, Digit6: 1, KeyY: 1, KeyU: 1, KeyN: 1, KeyZ: 1, KeyI: 1 };   // Y 光电吊舱、U 吊舱变焦、N 红外极性、Z 热诱弹（fptgp.js）、I 机型与挂载参数（fpinfo.js）
const FP_TELE = [-.3, 0, .35, .7, 1];   // 车钟：后退一 · 停车 · 前进一二三

// —— 能驾驶的单位 ——
// 这个单位正被玩家亲自开着吗（推演各处用它让出指挥；存档里留下的 fp 标记不算）
const fpDriving = o => V3FP.on && !!o && V3FP.o === o;
// 能亲自开的固定翼战机（飞控物理引擎 flight.js 里有参数的）：歼-35（含防空压制型）、歼-15T、歼-16D，战斗机歼-20、歼-50
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
  const info = o => { const d = typeof fiDetails === 'function' ? fiDetails(o) : null; if (d) el.appendChild(d); };   // 可展开的机型与挂载参数（fpinfo.js）
  for (const E of air) { const o = E.o; item(E, `${airMdl(o.kind, o.v).name} · ${ph[o.phase] || o.phase}`, `${gridRef(o.x, o.y)} · 高度 ${Math.round(v3AirZ(o))} 米 · ${Math.round((o.spd || 0) * 3.6)} km/h · ${wpn(o)}`); info(o); }
  if (deck.length) { add('div', 'sec', '甲板上 / 起降中（准备弹射的可以坐进去，弹射升空后接手）'); for (const o of deck) { item(fpOnDeck(o) ? { k: 'air', o } : null, `${airMdl(o.kind, o.v).name} · ${o.phase === 'cat' ? FP_DK[o.dk] || ph.cat : ph[o.phase] || o.phase}`, wpn(o), !fpOnDeck(o)); info(o); } }
  if (idle.length) {
    add('div', 'sec', `待命 · ${idle.length} 架（点一下登机：舰载机由牵引车拖上弹射器弹射起飞，陆基的从战区机场起飞）`);
    for (const w of idle) {
      const M = airMdl(w.type, w.v), where = airLandW(w) ? '战区机场' : w.dk != null && w.dk >= 0 ? `航母甲板 ${w.dk + 1} 号机位` : '航母机库';
      const b = document.createElement('button'); b.type = 'button'; b.className = 'it';
      const t = document.createElement('div'); t.textContent = `登机 · ${M.name}`; const u = document.createElement('div'); u.className = 'sub'; u.textContent = `${where} · ${wpn({ kind: w.type, v: w.v })}`; b.append(t, u);
      b.addEventListener('click', () => { fpMenu(false); fpBoard(w); });
      el.appendChild(b); info({ kind: w.type, v: w.v });
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
  fpRelease(); fpMslOff(); fpAudio(null);
  Object.assign(V3FP, { on: false, k: null, o: null, drag: null, lock: null, nozV: 0, fq: null, msg: null, tg: null, gl: null, vw: V3FP.vw === 'tgp' ? 'chase' : V3FP.vw });
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
      Object.assign(V3FP, { vw: 'chase', orb: [0, 0], cy: null, cp: 0, rcT: 0, cd: fpLen(E.o) * 3.2, cf: null, cu: null, camF: null, head: null,
        aim: [E.o.heading || 0, 0], ms: [0, 0], kx: { r: 0, p: 0, y: 0 }, ins: { x: 0, y: 0, r: 0 }, thr: .85, ab: false, abT: 0, gb: 0, rb: 0, buf: 0, imp: 0, free: false });
      if (typeof fwTake === 'function') fwTake(E.o);   // 武器：按推演里的余弹分到各型弹上，先不选（舱门关着）
      Object.assign(V3FP, { gear: !!brd, flapC: 0, hook: false, landed: null, mBig: false });   // 空中接手的起落架是收着的；甲板上登机的弹射出去时还放着（自己按 G 收）
      if (brd) E.o.fpBrd = true;   // cvdeck.js 见到 fpBrd：牵引车一路拖到偏流板后
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
  o.fp = false; o.fpBrd = false; o.jam = undefined;   // 交回 AI：干扰吊舱照常开着（ew.js）
  if (V3FP.k === 'air' && typeof fwRelease === 'function') fwRelease();   // 舱门关上
  if (V3FP.k === 'air' && fpOnDeck(o)) { V3FP.o = null; return; }   // 还在甲板上：照常由甲板作业流程送上弹射器
  if (V3FP.k === 'air' && o.phase !== 'trap' && !o.afPh) { o.fl = null; o.pt3 = null; o.fpVz = 0; if (!o.dead) o.alt = clamp(o.alt, .3, 1); }   // 交回 AI：按游戏里的简化飞行接着飞（已经着舰、落地的照地勤流程走）
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
// 机动性放大（用户：飞机机动性有点低）：皇牌空战式操纵时升力、过载限制、滚转角速度都乘 FP_MK（flight.js inp.mk）——像机翼大三成、结构强三成，
//   转弯半径小三成、横滚快三成；飞行员的抗荷能力按同样比例算（黑视门槛跟着放大）。地图小（八公里宽），照真实的转弯半径一个掉头要飞出去两三公里，
//   推演里 AI 的空战机动本来就比真实快 6 倍（airperf.js AP_K）。战争雷霆式、鼠标摇杆照真实
//   1.3 倍还嫌不够（用户：飞机机动性还是不够）：升力、过载放大到 1.8 倍（低速一个掉头约 4 秒）；滚转单独 1.35 倍（再快就不好控了）
const FP_MK = 1.8, FP_MKP = 1.35;
const fpMk = () => V3FP.ctl === 'ace' ? FP_MK : 1;
const fpMkP = () => V3FP.ctl === 'ace' ? FP_MKP : 1;
const FP_GK = 1.2, FP_GN = [2.5, 4.5];   // 准心控制上下：航迹倾角差 → 倾角变化率的增益（1 / 秒）；为跟准心最多多推 / 多拉几 g（用真实飞控仿真调的：不过冲、不来回摆，最大约 5.5 g 不黑视）
const fpCurve = v => Math.sign(v) * ((1 - FP_EXPO) * Math.abs(v) + FP_EXPO * Math.abs(v) ** 3);
const fpRamp = (v, t, dt, up = 3.2) => { const k = Math.abs(t) > Math.abs(v) && Math.sign(t) === Math.sign(v || t) ? up : 7; return v + clamp(t - v, -k * dt, k * dt); };   // 推满约 0.3 秒（滚转 0.38 秒：轻点一下只压十度左右，细修航向）、回中约 0.14 秒
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
// 教官：把机头带到瞄准方向（返回杆量 x 压杆、y 拉杆、r 蹬舵）——升力矢量指向：
//   机头按偏差的 1.6 倍角速度转向准星（最多按 7.5 g 能转的那么快），算出要的横向加速度，再加上抵消重力的那一份，就是机翼该给的升力；
//   要的升力大：滚转让升力（座舱顶方向）对准它，按它在座舱顶方向上的分量要过载（滚到位之前不往别处拉）；
//   要的升力小（准星就在前方附近）：按水平方向要的那一份压坡度（倒飞时先滚回正飞），竖直方向靠拉杆 / 推杆——升力很小时它的方向极不稳定，照着滚会来回晃；
//   横向偏差几度以内：机头靠方向舵先蹬过去，坡度按「航迹」（速度方向）还差多少压，航迹约 0.7 秒跟上——机头、航迹一起对上，松舵不会偏回去；
//   正飞时准星在下方 20° 以内：保持正飞直接推杆；离地近时准星压得再低也只按安全的下滑角飞（像《战争雷霆》的教官不让飞机撞地）
//   原来偏差小时只按偏差压一点坡度、保持 1 g：转弯角速度跟偏差的平方一样小，偏 8° 要十几秒才对上，鼠标指哪儿飞机半天转不过去
function fpInstr(F, mk = 1) {   // mk：机动性放大（皇牌空战式 FP_MK，flight.js 同一个数）——教官能用的过载、滚转跟着放大
  const A0 = FL_AC[F.k] || {}, R = flRot(F.q), [phi, th, psi] = flEul(F.q), Va = Math.max(F.Va || 0, 60), pm = (A0.pmax || 3) * (mk > 1 ? FP_MKP : 1), nz0 = A0.nz || [-3, 8], nz = [nz0[0], nz0[1] * mk], gi = 7.5 * mk, M = V3FP.ins;   // gi：教官最多拉到「黑视门槛」，自己不让飞行员黑视
  // 避地：按离地高度（往前 2、4 秒的地面也算上）限制最陡的下滑角，6 秒内掉的高度不超过离地高度减 80 米
  let [ay0, ap0] = V3FP.aim;
  if (Math.abs(ap0) < 1.5 && typeof flGround === 'function') {
    let gz = -2.6; for (const k of [0, 2, 4]) gz = Math.max(gz, flGround(F.P[0] + F.V[0] * k, F.P[1] + F.V[1] * k));
    const gmin = -Math.asin(clamp((-F.P[2] - gz - 80) / (Va * 6), 0, .95));
    if (ap0 < gmin) ap0 = gmin;
  }
  const c0 = Math.cos(ap0), A = [c0 * Math.cos(ay0), -c0 * Math.sin(ay0), Math.sin(ap0)], b = flMtv(R, [A[1], A[0], -A[2]]);   // 瞄准方向换到机体系（前右下）
  const off = Math.acos(clamp(b[0], -1, 1)), eY = Math.atan2(b[1], b[0]), be = F.b || 0, fine = 1 - smooth(.045, .12, Math.abs(eY));
  const lo = 1 - smooth(4000, 16000, .5 * flRho(-F.P[2]) * Va * Va);   // 低速（动压小）：舵面推不动，滚转、横向的增益都放低、阻尼加大，不然压坡度过了头再压回来，左右摇（进近速度时为 1）   // 横向偏差 2.5° 以内全按航迹修、7° 以上全按机头的矢量；be 侧滑（航迹在机头右边为正）
  // 垂直于机头、朝着准星的方向（准星在正后方时先往座舱顶方向拉）；要的角速度 → 加速度
  const tl = Math.hypot(b[1], b[2]), back = b[0] < 0 && tl < .05, ty = back || tl < 1e-9 ? 0 : b[1] / tl, tz = back ? -1 : tl < 1e-9 ? 0 : b[2] / tl;
  //   转弯角速度要多少：偏差的 1.6 倍（约 0.6 秒对上）；低速时小偏差（10° 以内）放慢到 0.9 倍——低速几 g 就转得很快，
  //   压坡度还没压到位机头已经过去了，又反着压回来，左右来回摇（用户：飞机低速还是会摇摆）
  const om = Math.min(off * lerp(lerp(1.6, .9, lo), 1.6, smooth(.17, .52, off)), gi * FL_G / Va), gb = flMtv(R, [0, 0, FL_G]);   // 重力（机体系）
  const ay = lerp(ty * Va * om, clamp(Va * lerp(1.4, .8, lo) * (eY - be), -4 * FL_G, 4 * FL_G), fine), az = tz * Va * om;
  const fy = ay - gb[1], fz = az - gb[2], fl = Math.hypot(fy, fz) / FL_G;   // 机翼该给的升力（比力，机体系的右、下分量）
  // 推杆：正飞（坡度 60° 以内）、准星在下方 20° 以内（要往下的比重力还多）——保持正飞直接推；有滞回，不来回跳
  if (M.push) { if (fz < -.3 * FL_G || off > .45 || Math.abs(phi) > 1.2) M.push = false; }
  else if (fz > .2 * FL_G && off < .35 && Math.abs(phi) < 1) M.push = true;
  // 滚转（都是「还要再滚多少」）：full 让座舱顶对准要的升力；soft 按水平方向要的加速度算该有的坡度（世界水平为准，倒飞时滚回正飞）
  const dN = flMv(R, [0, ay, az]), ayW = -Math.sin(psi) * dN[0] + Math.cos(psi) * dN[1];   // 要的加速度在水平「右」方向上的分量
  //   升力矢量指向（wr）只用在大机动：要的升力大、而且准星偏得远（高速 6–14° 以上，低速 17–34° 以上）——准星就在前方附近时按水平方向要的加速度压坡度（最多 80°），
  //   低速不会为了几度偏差滚过 90° 再滚回来；高速照样拉满过载把最后二三十度转过去（只按水平压坡度时坡度 74° 封顶、横向只有 3.5 g，最后三十度要磨五秒）
  const soft = airAng(clamp(Math.atan2(ayW, FL_G), -1.4, 1.4) - phi), wr = M.push ? 0 : smooth(1.2, 2.5, fl) * smooth(lerp(.1, .3, lo), lerp(.25, .6, lo), off);
  let rollE = soft + airAng(Math.atan2(fy, -fz) - soft) * wr;
  if (Math.abs(rollE) > 2.6 && M.rs && Math.sign(rollE) !== M.rs) rollE += 2 * Math.PI * M.rs;   // 要滚将近半圈：接着往刚才那边滚，不在 ±180° 处来回换方向
  else if (Math.abs(F.w[0]) > 1.5 && Math.sign(F.w[0]) !== Math.sign(rollE) && Math.abs(rollE) > 1.9) rollE += 2 * Math.PI * Math.sign(F.w[0]);   // 玩家横滚到一半松手（还滚得很快）：顺着滚完这一圈，不刹住再倒滚回去
  M.rs = Math.sign(rollE) || M.rs || 1;
  // 过载：升力在现在的座舱顶方向上的分量（滚到位之前少拉）；推杆时可以到负过载下限。换成电传的杆量（flight.js：松杆 = 保持航迹的过载 n0）
  const nc = clamp(-fz / FL_G, M.push ? nz[0] : -1, gi), cf = Math.cos(phi), n0 = Math.cos(th) * (cf + smooth(1.05, .85, Math.abs(phi)) * (1 / Math.max(cf, .4) - cf));
  const y = nc >= n0 ? (nc - n0) / Math.max(.5, nz[1] - n0) : -(n0 - nc) / Math.max(.5, n0 - nz[0]);
  return { x: clamp((rollE * lerp(4, 2.2, lo) - F.w[0] * lerp(.35, .7, lo)) / pm, -1, 1), y: clamp(y, -1, 1), r: clamp(eY * 6, -.5, .5) * fine };   // 方向舵只细修几度（原来 3.6° 就蹬满舵，低速侧滑十来度，侧滑带着滚转来回摆）
}
// 手柄（标准布局）：左摇杆杆、扳机油门、肩键方向舵、右摇杆自由视角；A 开火、B 航炮、X 加力、Y 换武器、十字键起降与换目标；两个扳机一起按到底 = 高 G 急转
const bt7 = gp => gp.g && (gp.g.buttons[6] || {}).value > .8 && (gp.g.buttons[7] || {}).value > .8;
function fpGamepad() {
  const g = typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()].find(x => x && x.connected && x.axes.length >= 2) : null;
  if (!g) return null;
  const ax = i => fpDz(g.axes[i] || 0), bt = i => !!(g.buttons[i] && g.buttons[i].pressed), bv = i => (g.buttons[i] && g.buttons[i].value) || 0;
  const was = V3FP.gpB, now = g.buttons.map(x => !!x.pressed), hit = i => now[i] && !was[i];
  V3FP.gpB = now;
  if (hit(0)) fwFire();
  V3FP.gpGun = bt(1);   // B 按住：航炮
  if (hit(2)) V3FP.ab = !V3FP.ab;
  if (hit(3)) fwNext();
  if (hit(15)) fwCycle();   // 十字键：右换目标、上起落架、下尾钩、左襟翼
  if (hit(12)) fpGear();
  if (hit(13)) fpHook();
  if (hit(14)) fpFlap();
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
  const brd = p.fpBrd && !p.fl;
  if (brd) { p.fpBrd = false; Object.assign(V3FP, { thr: 1, ab: true, aim: [p.heading || 0, .14], gear: true }); log('弹射离舰，飞机交给你了（G 收起落架）', 'info', 'fpcat', 1); }   // 刚弹射离舰：满油门加力
  const F = p.fl || flInit(p), K = V3FP.keys, T = V3FP.touch, kx = V3FP.kx, gp = fpGamepad(), A = FL_AC[F.k] || {};
  if (brd) F.gear = 1;
  // 键盘轴：杆量按速率推过去
  const key = (a, b) => (K.has(a) ? 1 : 0) - (K.has(b) ? 1 : 0);
  kx.r = fpRamp(kx.r, clamp(key('KeyD', 'KeyA') + key('ArrowRight', 'ArrowLeft') + T.x, -1, 1), dt, 2.6);
  kx.p = fpRamp(kx.p, clamp(key('ArrowDown', 'ArrowUp') + T.y, -1, 1), dt);
  kx.y = fpRamp(kx.y, clamp(key('KeyE', 'KeyQ'), -1, 1), dt);
  // 油门：W / S 连续加减；推满后再按住 W 0.4 秒开加力，S 关加力；按住 Shift 临时加力；手柄扳机
  const hg = K.has('KeyW') && K.has('KeyS') || (gp && bt7(gp));   // 高 G 急转（皇牌空战那样同时按加速、减速）：油门不动，放开迎角限制拉到底
  const tu = hg ? 0 : K.has('KeyW') ? 1 : K.has('KeyS') ? -1 : 0, gt = gp && !hg ? gp.thr : 0;
  if (hg && !V3FP.hgOn) fwMsg('高 G 急转'); V3FP.hgOn = hg;
  V3FP.thr = clamp(V3FP.thr + (tu + gt) * .6 * dt, 0, 1);
  if (tu > 0 && V3FP.thr >= 1) { V3FP.abT += dt; if (V3FP.abT > .4) V3FP.ab = true; } else V3FP.abT = 0;
  if (tu < 0 || gt < -.3) V3FP.ab = false;
  const ab = V3FP.ab || K.has('ShiftLeft') || K.has('ShiftRight') || T.ab;
  // 杆：玩家的（键盘 + 手柄 + 鼠标摇杆）过死区与响应曲线；鼠标瞄准时没输入的轴交给教官
  const mx = clamp(kx.r + (gp ? gp.x : 0), -1, 1), my = clamp(kx.p + (gp ? gp.y : 0), -1, 1), mr = clamp(kx.y + (gp ? gp.r : 0), -1, 1);
  let x, y, r;
  if (V3FP.ctl === 'stick') { x = fpCurve(clamp(mx + fpDz(V3FP.ms[0]), -1, 1)); y = fpCurve(clamp(my + fpDz(V3FP.ms[1]), -1, 1)); r = fpCurve(mr); }
  else if (V3FP.ctl === 'ace') {   // 皇牌空战式：准心（鼠标）管飞去哪儿，A / D 横滚、↑ / ↓ 推拉杆随时接手；舵 = 微调机头。飞控、气动是真实的那一套，机动性按 FP_MK 放大
    const [phi, th] = flEul(F.q), A1 = FL_AC[F.k] || {}, nm = (A1.nz ? A1.nz[1] : 9) * FP_MK, nn = A1.nz ? A1.nz[0] : -3, ix = fpCurve(mx), iy = fpCurve(my);
    // 准心管方向（用户：飞机操作太难受——原来鼠标左右只转镜头、飞机不跟着转，得另按 A / D 压坡度，镜头和飞机各走各的）：
    //   没按 A / D、↑ / ↓ 时，准心（方位 V3FP.cy、高度角 V3FP.ael，鼠标 / 右摇杆移动）就是要飞去的方向，交给教官（fpInstr，同《战争雷霆》鼠标瞄准：
    //   压坡度 + 拉杆把机头带过去，偏得多转得急，最多拉到黑视门槛，不过冲）；镜头一直顺着准心看，飞机始终在画面中间朝准心飞。
    //   按着 A / D、↑ / ↓ 时是手动：准心方位紧跟航迹（松手接着往现在飞的方向飞，不扳回去；原来按 3 / 秒慢慢追，松手时准心落在身后，飞机左右来回摆）
    const hand = Math.abs(ix) > .02 || Math.abs(iy) > .02 || hg, Vh = Math.hypot(F.V[0], F.V[1]), Va = Math.max(F.Va || 0, 60), gam = Math.asin(clamp(-F.V[2] / Va, -1, 1));
    if (V3FP.ael == null || V3FP.aelO !== p.id) { V3FP.ael = gam; V3FP.aelO = p.id; }   // 换了一架飞机：准心高度角从它现在的航迹开始
    if (!hand && V3FP.cy != null) {
      V3FP.aim = [-V3FP.cy, V3FP.ael];   // fpInstr 的方位按推演坐标（y 朝南），镜头的按 GL 坐标（y 朝北）：取负
      const I = fpInstr(F, FP_MK), S0 = V3FP.ins, k = Math.min(1, dt / .08);   // 教官的杆量滤一下（约 0.08 秒），不来回抖
      S0.x += (I.x - S0.x) * k; S0.y += (I.y - S0.y) * k; S0.r += (I.r - S0.r) * k;
      x = S0.x; y = S0.y; r = Math.abs(mr) > .02 ? fpCurve(mr) : S0.r;
    } else {
    // 准心方位跟着航迹：航迹接近竖直（筋斗顶上）时不跟（水平分量太小、方位乱跳），出来后最快 3 rad / 秒转过去，不一下甩 180°
    if (V3FP.cy != null && Vh > .3 * Math.max(F.Va || 0, 1)) { const ps = Math.atan2(F.V[0], F.V[1]); V3FP.cy = airAng(V3FP.cy + clamp(airAng(ps - V3FP.cy), -3 * dt, 3 * dt)); }
    V3FP.ins.x = V3FP.ins.y = V3FP.ins.r = 0;
    // 滚转：A / D 就是滚转角速度（按住一直滚——横滚、滚筒都能做；原来压到 80° 就停住）
    x = ix;
    const cf = Math.cos(phi), n0 = Math.cos(th) * (cf + smooth(1.05, .85, Math.abs(phi)) * (1 / Math.max(cf, .4) - cf));   // n0：飞控松杆时自己按坡度补到的过载（与 flight.js 一致，约到 50°）
    // 上下：准心控制（V3FP.ael：准心在地平线上下多少度，鼠标上下移动它）——飞机按准心的高度角爬升 / 俯冲：按航迹倾角差要一个倾角变化率，
    //   换成竖直方向要的过载、再除以 cos 坡度（压坡度转弯时自动多拉，保持高度角；超出机体能力就边转边掉高度）→ 飞控的拉杆量。
    //   离地太近不让往下扎（6 秒内不低于离地 80 米，同鼠标瞄准的教官）；↑ / ↓ 照样直接推拉杆，按着的时候准心跟着航迹走，松手不扳回去
    //   滚过 70° 以后这份「保持高度角」的带杆渐渐退掉（86° 以上不带）：横滚滚到倒飞时还按 1 / cos 坡度拉，就是朝地面拉、边滚边往下钻；
    //   不带杆时电传自己保持航迹（flight.js n0），按住 A / D 滚一整圈机头还对着原来的方向
    if (Math.abs(iy) > .02 || hg) {
      const nr = Math.cos(th) / Math.max(cf, .2), ya = Math.abs(ix) > .02 && cf > 0 ? clamp((Math.min(nr, nm) - n0) / (nm - n0), 0, 1) : 0;
      y = clamp(iy >= 0 ? iy + ya * (1 - iy) : iy, -1, 1);
      if (hg && iy > -.1) y = 1;   // 高 G 急转：沿当前坡度拉到底
      V3FP.ael = clamp(gam, -1.2, 1.2);
    } else {
      let gc = V3FP.ael, gz = -2.6;
      for (const k of [0, 2, 4]) gz = Math.max(gz, flGround(F.P[0] + F.V[0] * k, F.P[1] + F.V[1] * k));
      gc = Math.max(gc, -Math.asin(clamp((-F.P[2] - gz - 80) / (Va * 6), 0, .95)));
      const nreq = (Math.cos(gam) + clamp(Va * FP_GK * (gc - gam), -FP_GN[0] * FL_G, FP_GN[1] * FL_G) / FL_G) / Math.max(cf, .2);
      y = clamp(nreq >= n0 ? (Math.min(nreq, nm) - n0) / Math.max(.5, nm - n0) : -(n0 - Math.max(nreq, nn)) / Math.max(.5, n0 - nn), -1, 1) * (1 - smooth(1.22, 1.5, Math.abs(phi)));
    }
    r = fpCurve(mr);
    }
  } else {
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
    const I = fpInstr(F, fpMk()); x = I.x; y = I.y; r = I.r;
    if (F.Va > 1) V3FP.ael = Math.asin(clamp(-F.V[2] / F.Va, -1, 1));   // 交回来时准心在航迹上，不猛地扳
  }
  F.P0 = F.P.slice(); F.q0 = F.q.slice();   // 上一步的位置、姿态：画面按这一步走了多少插值（推演每秒 30 步，画面 60 帧以上，不插值飞机一顿一顿地抖）
  const hit = flStep(F, dt, { x, y, r, thr: ab ? 1 : V3FP.thr, ab, law: V3FP.ap ? 'n' : V3FP.law, gear: V3FP.gear, flap: V3FP.flapC, sb: K.has('KeyB') || !!T.sb, hook: V3FP.hook, hg: hg && !V3FP.ap, mk: fpMk(), mkp: fpMkP() });
  flToGame(p);
  if (F.ev) { const ev = F.ev; F.ev = null; if (fpLandEv(p, ev)) return true; }   // 接地、离地、挂索、冲出甲板（挂上索、跑道上停下来：交给地勤，不再走物理引擎）
  if (F.gnd && F.gk === 'rwy' && F.gs < 18 && V3FP.thr < .5) { fpRwyStop(p); return true; }
  // 受力回馈：过载黑视（持续 6 g 以上视野变暗收窄）、红视（−2 g 以下）、大迎角抖振、开火冲击
  const gz = F.nz / fpMk();   // 按放大前的过载算（飞行员抗荷能力随 FP_MK 放大）
  V3FP.gb = clamp(V3FP.gb + (gz > 7.5 ? (gz - 7.5) * .25 : -.5) * dt, 0, 1);   // 有抗荷服：7.5 g 以上才开始，9 g 撑 2.7 秒左右视野收窄到最小（原来 7 g 起、1.6 秒——真飞行员在离心机里 9 g 能撑十几秒）；教官最多拉到 7.5 g，不会自己把人拉黑
  V3FP.rb = clamp(V3FP.rb + (F.nz < -2 ? (-2 - F.nz) * .5 : -.5) * dt, 0, 1);
  V3FP.buf = clamp(smooth((A.alim || .43) * .72, (A.alim || .43) * 1.05, Math.abs(F.a)) + (F.stall || 0), 0, 1);
  V3FP.imp = Math.max(0, V3FP.imp - dt * 3);
  fpRumble(gp, F, ab);
  if (gp && (Math.abs(gp.lx) > .05 || Math.abs(gp.ly) > .05)) {   // 右摇杆看四周：皇牌空战式转自由视角（不回去），别的方式松手转回机尾
    if (V3FP.ctl === 'ace' && V3FP.cy != null) { V3FP.cy = airAng(V3FP.cy - gp.lx * 2.2 * dt); if (V3FP.ael != null) V3FP.ael = clamp(V3FP.ael - gp.ly * 1.2 * dt, -1.2, 1.2); V3FP.rcT = 0; }   // 右摇杆：左右转镜头，上下移动准心
    else { V3FP.orb[0] = airAng(V3FP.orb[0] + gp.lx * 2.2 * dt); V3FP.orb[1] = clamp(V3FP.orb[1] - gp.ly * 1.6 * dt, -1.4, 1.4); }
    V3FP.gpLook = true;
  } else V3FP.gpLook = false;
  if (hit) airLost(p, `${airMdl(p.kind, p.v).name}${F.crash ? F.crash + '，' : ''}${hit === 'sea' ? '坠海' : '撞地坠毁'}`, hit === 'sea');
  return true;
}
// 起降事件（flight.js F.ev）：平显上一行提示；挂上拦阻索就交给甲板作业流程（cvdeck.js cvTrapStep：拉停、收索、滑去机位整备）
function fpLandEv(p, ev) {
  const F = p.fl;
  if (ev.k === 'vle') fwMsg('速度太快放不下起落架（要低于 576 km/h）');
  else if (ev.k === 'td') fwMsg(`接地 · 下沉 ${ev.vs.toFixed(1)} 米 / 秒${ev.sf === 'deck' && !V3FP.hook ? ' · 没放尾钩！加满油门复飞' : ev.sf === 'rwy' ? ' · 收油门，按住 B 刹车' : ''}`);
  else if (ev.k === 'lo') fwMsg('离地');
  else if (ev.k === 'edge') fwMsg('冲出甲板：加力、拉杆！');
  else if (ev.k === 'trap') {
    const c = ev.c, h = c === S.cv ? 0 : (S.cvx || []).indexOf(c) + 1;
    if (h >= 0 && cvHome(p) !== h) p.home = h;   // 落在别的航母上：就归这艘
    Object.assign(p, { fl: null, fp: false, pt3: null, tl: ev.t, spd: Math.max(20, F.gs / Math.max(airK(p), .3)), rest: 0, alt: 0, bank: 0, dk: null });
    airSet(p, 'trap');
    V3FP.landed = { t: S.t, how: 'trap' };
    log(`${airMdl(p.kind, p.v).name}挂上第 ${ev.wire} 道拦阻索，着舰成功`, 'good', 'fptrap', 1, p);
    return true;
  }
  return false;
}
// 夺取的机场跑道上减到滑行速度：交给机场地勤（abn.js abPlaneFly 'roll' 那一步收尾：进机位整备）
function fpRwyStop(p) {
  const b = S.abBase;
  Object.assign(p, { fl: null, fp: false, pt3: null, alt: 0, bank: 0, spd: 12, afPh: 'roll', ru: b && typeof eaL === 'function' ? eaL(b, p.x, p.y)[0] : 0 });
  V3FP.landed = { t: S.t, how: 'rwy' };
  log(`${airMdl(p.kind, p.v).name}在夺取的机场跑道上降落`, 'good', 'fprwy', 1, p);
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
  if (V3FP.k === 'air' && V3FP.landed && (S.t - V3FP.landed.t > 3.5 || !o || o.dead)) {   // 着舰挂索 / 跑道上停下来：看着拉停几秒，再交给地勤整备
    log(V3FP.landed.how === 'trap' ? '着舰完成：飞机交给甲板调度，滑去机位挂弹加油，整备好了可以再登机' : '降落完成：飞机交给机场地勤整备，整备好了可以再登机', 'good', 'fpend', 2);
    fpExit();
    return;
  }
  if (!o || (V3FP.k === 'air' ? o.dead || !S.planes.includes(o) : o === S.dd ? S.dd.state === 'sunk' : !alive(o))) {
    log(V3FP.k === 'air' ? (o && o.dead ? '座机被击落，退出驾驶' : '飞机已着舰 / 返回机场，退出驾驶') : '军舰沉没，退出驾驶', 'bad', 'fpend', 2);
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
  for (const e of S.eships || []) if (!e.dead && (spec || inVision(e.x, e.y) || S.t - (e.det ?? -99) < 10)) out.push({ o: e, k: 'sea', t: 'eship', x: e.x, y: e.y, z: 4, nm: (typeof NV_CLS === 'object' && NV_CLS[e.cls] && NV_CLS[e.cls].nm) || '敌舰' });
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
function fpProj(E, x, y, z, D, n, fov = fpFov()) {   // fov：视野（追尾镜头按速度略放宽、吊舱按变焦，fpFov）
  const view = new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -v3Dot(x, E), -v3Dot(y, E), -v3Dot(z, E), 1]);
  const rd = v3RD(), fog = [D * 1.3 * rd, D * 2.8 * rd], asp = CAM.vw / Math.max(1, CAM.vh), fo = 1 / Math.tan(fov / 2), fa = Math.max(D * 9, fog[1] * 1.5), nf = 1 / (n - fa);
  const proj = new Float32Array([fo / asp, 0, 0, 0, 0, fo, 0, 0, 0, 0, (fa + n) * nf, -1, 0, 0, 2 * fa * n * nf, 0]);
  return (V3.cam = { E, x, y, z, D, rd, fog, asp, M: v3Mul(proj, view) });
}
// —— 速度感与手感（v3fpStep 每帧调 fpFeel）——
//   视野随空速放大（120 → 420 米/秒：46° → 约 55°），开加力那一下猛地一推、追尾镜头被甩开一点再追上；贴地高速（离地 220 米以下）气流颠簸，跨音速抖振（镜头抖动 fpShake）；
//   声音 fpAudio（audio.js 的 Web Audio，全合成）：涡轮啸叫随转速升高、推力的低频轰鸣、加力的爆燃轰鸣与次低音、气流的风噪随动压变响（大迎角抖振时一阵一阵）；
//   画面 fpFx（v3fx.js 调）：过载 4.5 g 以上或大迎角时翼尖拖出两道白色涡流，6 g 以上机翼上方一片水汽；离地近、速度快时迎面掠过的风线
const fpFov = () => (V3FP.on && V3FP.k === 'air' && ((V3FP.pipPass || (V3FP.mBig && V3FP.mv != null)) && V3FP.mFov || (V3FP.vw === 'tgp' && V3FP.tg ? V3FP.tg.fov : V3FP.fov))) || V3_FOV;   // 光电吊舱、导弹导引头：真实变焦的视场角（fptgp.js、fpMslCam）
function fpFeel(dt) {
  const o = V3FP.o, F = V3FP.on && V3FP.k === 'air' && o && o.fl;
  if (!F) { V3FP.fov = null; V3FP.turb = V3FP.trans = 0; fpAudio(null); return; }
  const V = F.Va || 0, agl = -F.P[2] - flGround(F.P[0], F.P[1]);
  if (F.ab && !V3FP.abWas) V3FP.abKick = 1;   // 刚点燃加力
  V3FP.abWas = !!F.ab; V3FP.abKick = Math.max(0, (V3FP.abKick || 0) - dt * 1.3);
  const sk = smooth(150, 420, V), fovT = V3_FOV * (1 + .07 * sk + (F.ab ? .04 : 0) + V3FP.abKick * .05), f0 = V3FP.fov || V3_FOV;
  V3FP.fov = f0 + (fovT - f0) * Math.min(1, dt * 2.5);
  const cdT = 1 + .12 * sk + (F.ab ? .04 : 0) + V3FP.abKick * .15, c0 = V3FP.cdK || 1;
  V3FP.cdK = c0 + (cdT - c0) * Math.min(1, dt * 3);
  V3FP.turb = smooth(220, 25, agl) * smooth(60, 260, V);
  V3FP.trans = smooth(.9, .98, F.M || 0) * smooth(1.08, 1, F.M || 0);
  fpAudio(F);
}
// 驾驶时的声音：第一次用到时建好一套常开的声源，之后每帧只调音量、频率（F 为空：慢慢收掉）
function fpAudio(F) {
  if (typeof AU !== 'object' || !AU.ctx || typeof auOk !== 'function' || !auOk() || typeof auFilt !== 'function') return;
  const c = AU.ctx, t = c.currentTime, set = (p, v, k = .12) => { if (isFinite(v)) p.setTargetAtTime(v, t, k); };
  let A = V3FP.au;
  if (!F) { if (A) set(A.out.gain, 0, .25); return; }
  if (!A) {
    const out = c.createGain(); out.gain.value = 0; out.connect(AU.bus.sfx);
    const src = () => { const n = c.createBufferSource(); n.buffer = AU.noise; n.loop = true; return n; }, gain = v => { const g = c.createGain(); g.gain.value = v; return g; };
    const w1 = c.createOscillator(), w2 = c.createOscillator(), wbp = auFilt('bandpass', 2600, 5), wg = gain(0);   // 涡轮啸叫：两个略失谐的振荡器过窄带通
    w1.type = 'triangle'; w2.type = 'sawtooth'; w1.frequency.value = 2400; w2.frequency.value = 2413;
    w1.connect(wbp); w2.connect(wbp); wbp.connect(wg); wg.connect(out);
    const n1 = src(), rlp = auFilt('lowpass', 300, .7), rg = gain(0); n1.connect(rlp); rlp.connect(rg); rg.connect(out);   // 推力的轰鸣
    const n2 = src(), alp = auFilt('lowpass', 180, .9), ag = gain(0); n2.connect(alp); alp.connect(ag); ag.connect(out);   // 加力的爆燃轰鸣
    const sub = c.createOscillator(), sg = gain(0); sub.type = 'sine'; sub.frequency.value = 40; sub.connect(sg); sg.connect(out);   // 次低音（胸口那种震）
    const n3 = src(), wf = auFilt('bandpass', 900, .6), fg = gain(0); n3.connect(wf); wf.connect(fg); fg.connect(out);   // 风噪
    for (const x of [w1, w2, n1, n2, sub, n3]) x.start();
    A = V3FP.au = { out, w1, w2, wbp, wg, rlp, rg, alp, ag, sub, sg, wf, fg };
  }
  const ab = !!F.ab, thr = ab ? 1 : clamp(V3FP.thr, 0, 1), V = F.Va || 0, rpm = .55 + .45 * thr, cock = V3FP.vw === 'cock';
  const q = clamp(.5 * (typeof flRho === 'function' ? flRho(-F.P[2]) : 1.2) * V * V / 60000, 0, 1.6);   // 动压（海平面 310 米/秒约 1）
  set(A.out.gain, .9, .3);
  set(A.w1.frequency, 1500 + 1900 * rpm, .4); set(A.w2.frequency, 1512 + 1917 * rpm, .4); set(A.wbp.frequency, 1700 + 2000 * rpm, .4);
  set(A.wg.gain, (cock ? .01 : .018) * rpm * rpm);
  set(A.rg.gain, (cock ? .09 : .2) * (.25 + .75 * thr)); set(A.rlp.frequency, 180 + 520 * thr, .3);
  set(A.ag.gain, ab ? (cock ? .22 : .42) : 0, ab ? .06 : .35); set(A.alp.frequency, ab ? 240 + 60 * Math.sin(t * 6.3) : 160, .05);
  set(A.sg.gain, ab ? .16 : 0, ab ? .05 : .35); set(A.sub.frequency, 38 + 5 * Math.sin(t * 9.1), .05);
  const buf = V3FP.buf || 0;
  set(A.fg.gain, (cock ? .16 : .09) * q * (1 + buf * (.6 + .4 * Math.sin(t * 23)))); set(A.wf.frequency, 450 + 1300 * clamp(V / 420, 0, 1), .3);
}
// 画面上的速度感（v3fx.js 每帧调，out 发光、sm 遮挡的烟；镜头 C）
function fpFx(out, sm, C) {
  const o = V3FP.o, F = V3FP.on && V3FP.k === 'air' && o && o.fl;
  if (V3FP.on && V3FP.k === 'air' && typeof ftFx === 'function' && typeof v3fSpark === 'function') ftFx(out, sm, C);   // 热诱弹、蒸汽锥、音爆、吊舱红外的热源（fptgp.js）
  if (!F || typeof v3fSpark !== 'function' || typeof v3fRib !== 'function' || V3FP.mv != null || V3FP.vw === 'tgp') return;
  const rs = fpRS(o), B = fpBody(o), V = F.Va || 0, nz = F.nz || 1, E = C.E, now = performance.now() / 1000;
  const P = [rs.x, -rs.y, rs.z], sz = (typeof airSize3 === 'function' ? airSize3(o, 'p') : 15), D = typeof AIRD === 'object' ? AIRD[typeof airSilKey === 'function' ? airSilKey(o.kind, o.v) : ''] : null;
  const tip = D && D.wing ? D.wing.reduce((m, q) => q[1] > m[1] ? q : m, D.wing[0]) : [-2, 7], k = sz / 21;
  const at = (u, v) => [P[0] + (B.f[0] * u + B.r[0] * v) * k, P[1] + (B.f[1] * u + B.r[1] * v) * k, P[2] + (B.f[2] * u + B.r[2] * v) * k];
  // 翼尖涡流：记下最近约 0.7 秒翼尖走过的点（按推演插值后的位置），过载越大越浓
  const vI = clamp(smooth(4.2, 7.5, nz) + smooth(.32, .5, Math.abs(F.a || 0)) * .7, 0, 1), T = V3FP.vtx || (V3FP.vtx = []);
  if (!T.length || now - T[T.length - 1][2] > .016) { T.push([at(tip[0], -tip[1]), at(tip[0], tip[1]), now, vI]); if (T.length > 48) T.shift(); }
  while (T.length && now - T[0][2] > .7) T.shift();
  for (let i = 1; i < T.length; i++) {
    const a0 = now - T[i - 1][2], a1 = now - T[i][2], i0 = T[i - 1][3] * (1 - a0 / .7), i1 = T[i][3] * (1 - a1 / .7);
    if (i0 + i1 < .02) continue;
    for (const s of [0, 1]) v3fRib(sm, E, T[i - 1][s], T[i][s], .55 * k, [.94, .95, .96, .55 * i0], [.94, .95, .96, .55 * i1]);
  }
  // 机翼上方的水汽（6 g 以上一片白雾，贴着机翼上表面、往后散）
  const vp = smooth(5.8, 8.5, nz) * smooth(80, 160, V);
  if (vp > .02) for (let i = 0; i < 10; i++) {
    const u = -1.5 - (i % 5) * 1.2, v = ((i * 37) % 11 - 5) / 5 * tip[1] * .75, p = at(u, v), up = .5 * k + (i % 3) * .15 * k;
    v3fSpark(sm, C, [p[0] + B.u[0] * up, p[1] + B.u[1] * up, p[2] + B.u[2] * up], (1.6 + (i % 4) * .4) * k, [.95, .96, .97, .22 * vp * (.7 + .3 * Math.sin(now * 17 + i))]);
  }
  // 风线：镜头周围固定在空中的一些点，飞过去时按速度拉成一道道细线（越快、离地越近越多越亮）
  const agl = -F.P[2] - flGround(F.P[0], F.P[1]), wI = smooth(90, 260, V) * (.35 + .65 * smooth(400, 40, agl));
  if (wI < .03) { V3FP.wl = null; return; }
  const dir = v3Norm(F.V ? [F.V[1], F.V[0], -F.V[2]] : B.f), cf = V3FP.camF || B.f, W0 = V3FP.wl || (V3FP.wl = []);
  const spawn = () => { const r = 6 + Math.random() * 34, an = Math.random() * 6.283, s = 60 + Math.random() * 140, cu = B.u, cr = B.r;
    return [E[0] + cf[0] * s + (cr[0] * Math.cos(an) + cu[0] * Math.sin(an)) * r, E[1] + cf[1] * s + (cr[1] * Math.cos(an) + cu[1] * Math.sin(an)) * r, E[2] + cf[2] * s + (cr[2] * Math.cos(an) + cu[2] * Math.sin(an)) * r]; };
  while (W0.length < 46) W0.push(spawn());
  const len = clamp(V * .045, 3, 22);
  for (let i = 0; i < W0.length; i++) {
    const p = W0[i], rel = [p[0] - E[0], p[1] - E[1], p[2] - E[2]], ahead = v3Dot(rel, cf);
    if (ahead < 4 || ahead > 260 || Math.hypot(rel[0] - cf[0] * ahead, rel[1] - cf[1] * ahead, rel[2] - cf[2] * ahead) > 60) { W0[i] = spawn(); continue; }
    const q = [p[0] - dir[0] * len, p[1] - dir[1] * len, p[2] - dir[2] * len], f = smooth(4, 30, ahead) * smooth(260, 120, ahead) * wI;
    if (i > 14 + 32 * wI) continue;   // 速度不太快、离地高时少几道
    v3fRib(out, E, q, p, .05 + ahead * .0016, [1, 1, 1, 0], [1, 1, 1, .26 * f]);
  }
}
// 受力回馈：镜头抖动（大迎角抖振最猛，过载、加力、开火冲击次之），返回 [右, 上] 两个小角度（弧度）
function fpShake() {
  if (!V3FP.ffb || V3FP.k !== 'air') return null;
  // 贴地高速的低频「气流颠簸」去掉了：离地 220 米以下一直在一秒一两下地晃，看着像飞机在摇摆（用户反映）；跨音速、大迎角抖振、开火冲击照旧（高频、幅度小）
  const a = V3FP.buf * .0045 + smooth(5, 9, (V3FP.o.fl || {}).nz || 1) * .0016 + (V3FP.ab ? .0005 : 0) + V3FP.imp * .006 + (V3FP.trans || 0) * .0018;
  if (a < 1e-5) return null;
  const t = performance.now() / 1000;
  return [a * (Math.sin(t * 61) + Math.sin(t * 37.3) * .6), a * (Math.sin(t * 53.7 + 1) + Math.sin(t * 29.1) * .6)];
}
// 飞机的追尾镜头：鼠标瞄准时镜头顺着瞄准方向看（飞机飞进准星），鼠标摇杆时跟着机体姿态（略带滞后）——筋斗、横滚时镜头跟着翻过去；
//   按住 C（或手柄右摇杆）自由视角绕着飞机转；滚轮改远近
// 锁头视角看谁：选定目标（武器环里锁的那个），没有就最近的看得见的敌机（20 公里内）；GL 坐标
function fpPadT() {
  const T = V3FP.fwT, o = V3FP.o;
  if (T) return [T.x, -T.y, T.z];
  let best = null, bd = 20000;
  for (const c of fpFoes(true)) { const d = Math.hypot(c.x - o.x, c.y - o.y); if (d < bd) { bd = d; best = c; } }
  return best ? [best.x, -best.y, best.z] : null;
}
function fpChaseCam(P) {
  const o = V3FP.o, L = fpLen(o), d = clamp(V3FP.cd, L * 1.3, 2000) * (V3FP.cdK || 1), now = performance.now(), dt = clamp((now - (V3FP.ct || now)) / 1000, 0, .1);   // cdK：速度快、开加力时镜头往后让一点（fpFeel）
  V3FP.ct = now;
  const B = fpBody(o), k = 1 - Math.exp(-dt * 7);   // 机体轴带一点滞后
  const lerp3 = (a, b) => a ? v3Norm([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]) : b;
  V3FP.cf = lerp3(V3FP.cf, B.f); V3FP.cu = lerp3(V3FP.cu, B.u);
  // 鼠标瞄准：镜头顺着准星；手动压杆、拉杆时（以及鼠标摇杆）跟着机体姿态（筋斗、横滚时一起翻过去），两种之间约半秒平滑过渡
  const bw = V3FP.bw = clamp((V3FP.bw ?? 0) + (V3FP.ctl === 'aim' && o.fl && !V3FP.man ? -dt : dt) * 2.5, 0, 1);
  let f = V3FP.cf, c = V3FP.cu;
  if (bw < 1) { const a = fpAimDir(), au = fpAimUp(); f = v3Norm([a[0] + (f[0] - a[0]) * bw, a[1] + (f[1] - a[1]) * bw, a[2] + (f[2] - a[2]) * bw]); c = [au[0] + (c[0] - au[0]) * bw, au[1] + (c[1] - au[1]) * bw, au[2] + (c[2] - au[2]) * bw]; }
  // 镜头上方：平时取世界的「上」（横滚时地平线不跟着转，看得见飞机在滚）；机头接近竖直（拉筋斗）时世界的上方没法用，换成机体的上方，顺着翻过去
  //   皇牌空战式：地平线跟着坡度歪四成五（看得出在压坡度转弯，又不至于整个世界跟着转晕）
  const cl = [0, 0, 1], wv = Math.max(smooth(.82, .97, Math.abs(f[2])), V3FP.ctl === 'ace' ? .45 : 0), cm = [cl[0] + (c[0] - cl[0]) * wv, cl[1] + (c[1] - cl[1]) * wv, cl[2] + (c[2] - cl[2]) * wv], q0 = v3Dot(cm, f);
  let u = v3Norm([cm[0] - f[0] * q0, cm[1] - f[1] * q0, cm[2] - f[2] * q0]);
  if (V3FP.ctl === 'ace') {
    // 皇牌空战式：镜头顺着准心看（世界坐标里的方位 V3FP.cy、高度角 V3FP.ael，鼠标移动它，飞机朝它飞）——飞机滚转、翻筋斗时镜头不跟着转；
    //   镜头始终绕着飞机（飞机在画面中间），C 键把准心平滑转回机头方向；按住右键拖动看四周（V3FP.orb，不动准心），松开约半秒转回准心
    if (V3FP.cy == null || V3FP.rcT) {
      const ty = Math.atan2(B.f[1], B.f[0]);
      if (V3FP.cy == null) V3FP.cy = ty;
      else { const kk = 1 - Math.exp(-dt * 9); V3FP.cy = airAng(V3FP.cy + airAng(ty - V3FP.cy) * kk); if (Math.abs(airAng(ty - V3FP.cy)) < .01 || now - V3FP.rcT > 1500) V3FP.rcT = 0; }   // 转到位（或 1.5 秒）为止
    }
    const cp = V3FP.cp = clamp(V3FP.ael != null ? V3FP.ael : Math.asin(clamp(B.f[2], -1, 1)), -1.45, 1.45), cc = Math.cos(cp);
    if (!(V3FP.drag && V3FP.dbtn === 2) && now - (V3FP.mlT || 0) > 250) { const kb = 1 - Math.exp(-dt * 5); V3FP.orb[0] *= 1 - kb; V3FP.orb[1] *= 1 - kb; }
    const lo = Math.abs(V3FP.orb[0]) + Math.abs(V3FP.orb[1]) > 1e-4, ly = V3FP.cy + (lo ? V3FP.orb[0] : 0), lp = lo ? clamp(cp + V3FP.orb[1], -1.45, 1.45) : cp, lc = Math.cos(lp);
    f = [lc * Math.cos(ly), lc * Math.sin(ly), Math.sin(lp)];
    u = v3Norm([-f[0] * f[2], -f[1] * f[2], 1 - f[2] * f[2]]);   // 世界的「上」（去掉沿视线的分量）：地平线永远是平的
  } else {
    // 别的操纵方式（鼠标管飞行）：按住 C 自由视角，松开后慢慢转回机尾后方
    if (!V3FP.free && !V3FP.gpLook && now - (V3FP.mlT || 0) > 1500) { const kb = 1 - Math.exp(-dt * 4); V3FP.orb[0] *= 1 - kb; V3FP.orb[1] *= 1 - kb; }
    if (Math.abs(V3FP.orb[0]) + Math.abs(V3FP.orb[1]) > 1e-4) { f = fpRot(f, u, -V3FP.orb[0]); const r = v3Norm(v3Cross(f, u)); f = fpRot(f, r, V3FP.orb[1]); u = fpRot(u, r, V3FP.orb[1]); }
  }
  // 锁头视角（按住 T，皇牌空战的目标视角）：镜头从飞机后面看向选定目标，没选就看最近的敌机——缠斗时不丢目标；按真实时间平滑转过去
  const pt = V3FP.keys.has('KeyT') ? fpPadT() : null;
  V3FP.padK = clamp((V3FP.padK || 0) + (pt ? dt : -dt) * 3, 0, 1);
  if (pt) V3FP.padP = pt;
  if (V3FP.padK > .001 && V3FP.padP) {
    const T0 = V3FP.padP, dv = v3Norm([T0[0] - P.x, T0[1] + P.y, T0[2] - P.z]), k = smooth(0, 1, V3FP.padK);
    f = v3Norm([f[0] + (dv[0] - f[0]) * k, f[1] + (dv[1] - f[1]) * k, f[2] + (dv[2] - f[2]) * k]);
    const q1 = v3Dot(u, f); u = v3Norm([u[0] - f[0] * q1, u[1] - f[1] * q1, u[2] - f[2] * q1]);
  }
  const T = [P.x, -P.y, P.z], E = [T[0] - f[0] * d + u[0] * d * .16, T[1] - f[1] * d + u[1] * d * .16, T[2] - f[2] * d + u[2] * d * .16];
  // 抖动只转视线、不挪镜头位置：飞机和背景一起抖，像镜头在抖（原来连位置一起绕着飞机转——飞机在画面中间不动、背后的世界在晃，看着像飞机在摇）
  const sh = fpShake();
  if (sh) { const r = v3Norm(v3Cross(f, u)); f = v3Norm([f[0] + r[0] * sh[0] + u[0] * sh[1], f[1] + r[1] * sh[0] + u[1] * sh[1], f[2] + r[2] * sh[0] + u[2] * sh[1]]); const q0 = v3Dot(u, f); u = v3Norm([u[0] - f[0] * q0, u[1] - f[1] * q0, u[2] - f[2] * q0]); }
  const g = typeof v3HtX === 'function' ? v3HtX(E[0], -E[1]) : v3Ht(clamp(E[0], 0, W - 1), clamp(-E[1], 0, H - 1));
  if (E[2] < g + 3) E[2] = g + 3;   // 不钻到地面以下
  const z = [-f[0], -f[1], -f[2]], x = v3Norm(v3Cross(u, z)), y = v3Cross(z, x), alt = Math.max(1, E[2] - Math.max(g, -2.6));
  V3FP.camF = f;
  return fpProj(E, x, y, z, clamp(Math.max(alt * 5, d * 6), 520, 2600), clamp(d * .015, .4, 8));   // 视野按 fpFov（速度感放宽、吊舱变焦）
}
// 模型键（v3g.js V3G_AIR）与模型在世界里的变换（挂点、炮口位置用）
const fpMdlKey = o => (typeof V3G_AIR === 'object' && typeof airSilKey === 'function' && V3G_AIR[airSilKey(o.kind, o.v)]) || 'j31';
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
// 尾喷口开合（v3units.js 画飞机时传给 v3gPlane）：真实的收扩喷口——慢车张开、巡航中间、不开加力的最大推力收到最小、开加力张到最大；作动筒约一秒到位
const FP_NOZ = [.18, 0, -.2, .38];   // 慢车、巡航、军推（收到最小）、加力（张到最大）——同 v3det.js NZ_*
const fpNoz = o => V3FP.on && V3FP.o === o ? V3FP.nozV || 0 : 0;
// —— 导弹视角：发射后右上角一块小屏放这枚弹的导引头画面（不切走主画面，主画面还是你的飞机，照常飞、照常开火）——
//   像真实的电视 / 红外制导弹回传给座舱的画面：镜头在弹头上、盯着导引头跟踪的目标点（fwFly 平滑过的 m.fw.tq；离弹轴 70° 以外看不到就顺着弹飞的方向看），
//   视场按距离自动变焦（远处窄到 3°、近处放宽到 34°）——目标一直在十字中间，最后几百米越来越大直到命中；
//   画面一律是光电的（v3post.js v3poEO）：红外导引头（霹雳-10 等）和没有成像导引头的弹按红外白热，电视导引头（KD-88、蓝箭-7）按电视黑白。
//   命中 / 落地 / 自毁之后镜头退到来袭方向上一百多米、看两秒半爆炸再关；V 把小屏放大成全屏（全屏也是光电画面），再按 V 缩回 ——
const FP_MHOLD = 2600;   // 命中后停留看爆炸（毫秒）
function fpMslOn(m) { if (V3FP.k !== 'air' || !m) return; Object.assign(V3FP, { mv: m.id, mObj: m, mo: [0, 0], mf: null, mp: null, mq: null, mfv: null, mEnd: null, mRes: null, mhp: null, mt: null, md: null }); }
function fpMslOff() { Object.assign(V3FP, { mv: null, mObj: null, mf: null, mp: null, mq: null, mfv: null, mEnd: null, mRes: null, mhp: null, mBig: false, mFov: null }); }
// 这枚弹的光电画面：1 红外白热、3 电视黑白
function fpMslEO() { const Wd = typeof FW_W === 'object' && FW_W[V3FP.mw]; return Wd && Wd.sk === 'tv' ? 3 : 1; }
// 由前方向 f 和世界的上方定镜头（地平线不歪）；f 接近竖直时用 r0 定左右
function fpCamAxes(f, r0) {
  const hz = Math.hypot(f[0], f[1]), r = hz > .05 ? v3Norm([f[1], -f[0], 0]) : r0, u = v3Norm(v3Cross(r, f)), z = [-f[0], -f[1], -f[2]], x = v3Norm(v3Cross(u, z));
  return { x, y: v3Cross(z, x), z, u };
}
function fpMslCam() {
  const now = performance.now(), dt = clamp((now - (V3FP.mt || now)) / 1000, 0, .1);
  V3FP.mt = now;
  // 弹在 S.missiles 里找不到了（炸了被清掉）也还拿着这个对象，读得到它怎么结束的
  const m = (V3FP.mObj && V3FP.mObj.id === V3FP.mv ? V3FP.mObj : null) || S.missiles.find(q => q.id === V3FP.mv && q.fw);
  if (m && !m.done) {
    const v = m.fw.v, sp = Math.hypot(v[0], v[1], v[2]) || 1, fv = [v[0] / sp, v[1] / sp, v[2] / sp], tq = m.fw.tq;
    V3FP.mObj = m; V3FP.mw = m.fw.w; V3FP.mp = [m.x, -m.y, m.z3]; V3FP.mfv = fv;
    let f0 = fv, dist = null;
    if (tq) {   // 导引头离轴 ±70° 以内：看着目标点
      const d = [tq[0] - m.x, tq[1] + m.y, tq[2] - m.z3], L = Math.hypot(d[0], d[1], d[2]);
      if (L > 1 && (d[0] * fv[0] + d[1] * fv[1] + d[2] * fv[2]) / L > .34) { f0 = [d[0] / L, d[1] / L, d[2] / L]; dist = L; }
    }
    V3FP.mq = dist != null ? tq.slice() : null;
    const k = 1 - Math.exp(-dt * 10);   // 稳定平台：转得快但不抖
    V3FP.mf = V3FP.mf ? v3Norm([0, 1, 2].map(i => V3FP.mf[i] + (f0[i] - V3FP.mf[i]) * k)) : f0;
    V3FP.md = dist != null ? dist : Math.hypot(m.tx - m.x, m.ty - m.y);
    const fov = V3FP.mFov = dist != null ? clamp(2 * Math.atan(9 / (dist * .09)), .052, .6) : .52;   // 目标（按 18 米算）占画面高度一成左右，再近就放宽到 34° 让它变大
    const f = V3FP.mf, A = fpCamAxes(f, v3Norm(v3Cross(f, fpBody(V3FP.o).u))), E = [m.x + fv[0] * 1.5, -m.y + fv[1] * 1.5, m.z3 + fv[2] * 1.5];   // 镜头在弹头上
    if (V3FP.mBig) V3FP.camF = f;
    const D = clamp((dist != null ? dist : 2000) * .9, 1600, 40000);   // 雾的尺度：目标那么远也不进雾
    return fpProj(E, A.x, A.y, A.z, D, clamp((dist != null ? dist : 300) * .002, .3, 12), fov);
  }
  // 命中 / 落地 / 自毁之后：镜头退到来袭方向上，看爆炸
  if (!V3FP.mp || !V3FP.mfv) { fpMslOff(); return null; }
  if (!V3FP.mEnd) {
    V3FP.mEnd = now; V3FP.mRes = (m && m.fw && m.fw.end) || 'sd';
    const hit = V3FP.mRes === 'hit' && V3FP.mq, x = m ? m.x : V3FP.mp[0], y = m ? -m.y : V3FP.mp[1];
    V3FP.mhp = hit ? V3FP.mq.slice() : V3FP.mRes === 'gnd' ? [x, y, Math.max(fwGz(x, -y), -2.6) + 2] : V3FP.mp.slice();
  }
  if (now - V3FP.mEnd > FP_MHOLD) { fpMslOff(); return null; }
  const P = V3FP.mhp, fv = V3FP.mfv, back = 130, E = [P[0] - fv[0] * back, P[1] - fv[1] * back, P[2] - fv[2] * back + back * .22];
  const g = typeof v3HtX === 'function' ? v3HtX(E[0], -E[1]) : v3Ht(clamp(E[0], 0, W - 1), clamp(-E[1], 0, H - 1));
  if (E[2] < Math.max(g, -2.6) + 4) E[2] = Math.max(g, -2.6) + 4;   // 不钻到地面以下
  const d = [P[0] - E[0], P[1] - E[1], P[2] - E[2]], L = Math.hypot(d[0], d[1], d[2]) || 1, f = [d[0] / L, d[1] / L, d[2] / L], A = fpCamAxes(f, [1, 0, 0]);
  V3FP.mFov = .45; V3FP.md = null;
  if (V3FP.mBig) V3FP.camF = f;
  return fpProj(E, A.x, A.y, A.z, 1600, .3, V3FP.mFov);
}
// 小屏的位置（CSS 像素）：右上角，在 3D 按钮组下面；宽约三成屏、16:9
function fpPipRect() {
  const w = Math.round(clamp(CAM.vw * .3, 200, 440)), h = Math.round(w * 9 / 16);
  return [CAM.vw - w - 14, 108, w, h];
}
// 每帧（view3d.js v3Draw 在后期处理之后调用）：把场景从导弹后方再画一遍到小屏那块（剪刀测试圈住；不画阴影、地图物件、后期）
function v3fpPip(now) {
  if (!V3FP.on || V3FP.k !== 'air' || V3FP.mv == null || V3FP.mBig || typeof v3Scene !== 'function') return;
  const [px, py, pw, ph] = fpPipRect(), K = { vw: CAM.vw, vh: CAM.vh, cam: V3.cam }, dpr = R.dpr || 1;
  let ok = false;
  try {
    CAM.vw = pw; CAM.vh = ph;
    const C = fpMslCam();
    if (C) {
      const vp = [Math.round(px * dpr), Math.round((K.vh - py - ph) * dpr), Math.round(pw * dpr), Math.round(ph * dpr)], eo = fpMslEO();
      V3FP.pipPass = true; V3FP.pipEO = eo;   // 这一遍：模型细节按导引头的视场挑（fpFov），红外时人、车、飞机按温度提亮（fptgp.js ftIR）
      try { v3Scene(C, now, vp); } finally { V3FP.pipPass = false; V3FP.pipEO = null; }
      if (typeof v3poEO === 'function' && !V3FP.eoBad) try { v3poEO(vp, eo, now); } catch (e) { V3FP.eoBad = true; console.warn('导弹小屏光电换算不可用', e); }   // 换成光电画面（v3post.js）；出错就只画彩色，不影响主画面
      V3FP.pipC = C; ok = true;
    }
  } finally { CAM.vw = K.vw; CAM.vh = K.vh; V3.cam = K.cam; }
  V3FP.pipOn = ok;
}
function v3fpCamera() {
  const P = fpPose() || { x: CAM.x, y: CAM.y, z: 200, yaw: 0, pitch: -.3, roll: 0 };
  if (V3FP.k === 'air' && V3FP.mv != null && V3FP.mBig) { const C = fpMslCam(); if (C) return C; }
  if (V3FP.k === 'air' && V3FP.vw === 'tgp' && typeof ftCam === 'function') { const C = ftCam(); if (C) return C; }   // 光电吊舱（fptgp.js）
  if (V3FP.k === 'air') return fpChaseCam(P);
  const B = fpAxes(P);
  let f = B.f, u = B.u;
  const E = [P.x, -P.y, P.z], hd = V3FP.look;   // 舰：舰桥上看出去，鼠标转头（先左右、再抬头低头）
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
  fpFeel(clamp((now - (V3FP.feT || now)) / 1000, 0, .1)); V3FP.feT = now;
  if (!P) return;
  const chase = V3FP.k === 'air', cf = V3FP.k === 'air' && V3FP.camF;   // 飞机：按上一帧镜头的视线
  const yaw = cf ? Math.atan2(-cf[1], cf[0]) : P.yaw + V3FP.look[0], pitch = cf ? Math.asin(clamp(cf[2], -1, 1)) : P.pitch + V3FP.look[1];
  const g = v3Ht(clamp(P.x, 0, W - 1), clamp(P.y, 0, H - 1)), alt = Math.max(1, P.z - g);
  const cp = Math.cos(pitch), down = -Math.sin(pitch), reach = chase ? clamp(V3FP.cd * 2 + 200, 250, 1400) : down > .08 ? Math.min(1600, alt / down * cp) : 900;
  CAM.x = clamp(P.x + Math.cos(yaw) * reach * (chase ? .5 : 1), 0, W); CAM.y = clamp(P.y + Math.sin(yaw) * reach * (chase ? .5 : 1), 0, H);
  CAM.z = CAM.fit * clamp(1800 / Math.max(60, alt + reach * .35), 1.2, 9);
  if (V3FP.mv != null && V3FP.mBig && V3FP.mp) {   // 全屏导弹视角：贴图、细节按导引头盯着的那一点（命中后按爆炸点），缩放按看得见的地面宽度
    const G = V3FP.mEnd ? V3FP.mhp : V3FP.mq || V3FP.mp, gd = V3FP.mEnd ? 130 : V3FP.md || 300;
    if (G) { CAM.x = clamp(G[0], 0, W); CAM.y = clamp(-G[1], 0, H); CAM.z = CAM.fit * clamp(1800 / Math.max(40, gd * (V3FP.mFov || .5) * 1.4), 1.2, 14); }
  }
  if (V3FP.k === 'air' && V3FP.vw === 'tgp' && typeof ftCenter === 'function') ftCenter();   // 吊舱：画面中心是它盯着的那一点
  V3FP.lock = V3.cam && V3FP.k === 'ship' ? fpLockTarget() : null;
  if (V3FP.k === 'air') {   // 尾喷口：按油门、加力（油尽熄火时张开）慢慢开合
    //   推加力时照真实的顺序：发动机先转到军推、喷口收到最小，约 0.6 秒后加力点着、喷口张到最大（看得出先收后张）；作动筒约 0.3 秒跟上
    const dt = clamp((now - (V3FP.nozT || now)) / 1000, 0, .1), F = o.fl, abOn = !!(F && F.ab);
    V3FP.abLt = abOn ? (V3FP.abLt || 0) + dt : 0;
    const want = (o.fuel ?? 1) > 0 ? (abOn ? (V3FP.abLt < .6 ? FP_NOZ[2] : FP_NOZ[3]) : V3FP.thr > .92 ? FP_NOZ[2] : V3FP.thr > .45 ? FP_NOZ[1] : FP_NOZ[0]) : .25;   // 油尽熄火：喷口张开
    V3FP.nozT = now; V3FP.nozV = (V3FP.nozV || 0) + (want - (V3FP.nozV || 0)) * Math.min(1, dt * 3.2);
  }
  // 这型飞机的座舱盖玻璃：从外面也看得见座舱里面；平显玻璃（模型里是一整块不透明的亮绿色）换成透明的淡绿玻璃（v3g.js）
  if (typeof V3G === 'object') { const mk = V3FP.k === 'air' ? fpMdlKey(o) : null; V3G.glass = mk ? { key: mk, k: .6, hud: typeof V3G_PIT === 'object' && V3G_PIT[mk] ? V3G_PIT[mk].hud : null } : null; }
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
// —— 画面（view3d.js v3Overlay 调用，屏幕空间）：武器平显（fpwpn.js）、下方一块飞行数据（起降用）、导弹小屏的框、过载的黑视 / 红视；地名、番号牌这些标识都不画 ——
function v3fpOverlay(ctx) {
  if (!V3FP.on || !V3FP.o || V3FP.k !== 'air') return;
  const big = V3FP.mv != null && V3FP.mBig, tgp = V3FP.vw === 'tgp' && !big;   // 光电吊舱：画吊舱自己的符号，不画平显（fptgp.js）
  if (!tgp && typeof fwHud === 'function') fwHud(ctx);
  if (!tgp && !big && V3FP.ctl === 'ace') fpAimMark(ctx);   // 准心（鼠标上下移动它）与飞机实际飞去的方向
  if (!tgp && !big) fpHudData(ctx, CAM.vw, CAM.vh);
  { const P = fpPose(); if (P) fpRwr(ctx, CAM.vw, CAM.vh, P, tgp || big); }   // 雷达告警：吊舱、导弹全屏视角里也照样响、照样出字
  if (typeof ftOverlay === 'function') ftOverlay(ctx);   // 吊舱符号、吊舱锁定框、机型与挂载参数面板（fptgp.js、fpinfo.js）
  if (V3FP.mv != null && !V3FP.mBig && V3FP.pipOn) fpPipFrame(ctx);
  if (big) fpSeekHud(ctx, 0, 0, CAM.vw, CAM.vh, V3.cam, true);   // 全屏导弹视角：导引头的符号
  fpGfx(ctx, CAM.vw, CAM.vh);
}
// 准心（皇牌空战式：鼠标上下移动它，飞机按它的高度角爬升 / 俯冲）：圆圈画在「现在的航向、准心的高度角」那个方向的远处；
//   小圆点加两道短翼是飞机实际飞去的方向（速度方向）——圆点进了圆圈就是飞到了准心的高度角
function fpAimMark(ctx) {
  const o = V3FP.o, F = o && o.fl;
  if (!F || V3FP.ael == null || F.gnd || typeof v3Proj !== 'function' || !V3.cam) return;
  const P = fpPose(), V = [F.V[1], F.V[0], -F.V[2]], hz = Math.hypot(V[0], V[1]), vl = Math.hypot(hz, V[2]);
  if (hz < 1 || vl < 1) return;
  const D = 4000, ce = Math.cos(V3FP.ael), at = d => v3Proj(P.x + d[0] * D, P.y - d[1] * D, P.z + d[2] * D);
  const q = at([V[0] / hz * ce, V[1] / hz * ce, Math.sin(V3FP.ael)]), m = at([V[0] / vl, V[1] / vl, V[2] / vl]);
  const ok = p => p && (p.f == null || p.f < 1.5) && p.x > -40 && p.x < CAM.vw + 40 && p.y > -40 && p.y < CAM.vh + 40;
  ctx.save(); ctx.lineWidth = 1.5; ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 3; ctx.strokeStyle = ctx.fillStyle = 'rgba(232,255,242,.9)';
  if (ok(q)) { ctx.beginPath(); ctx.arc(q.x, q.y, 12, 0, 6.2832); ctx.stroke(); }
  if (ok(m)) { ctx.beginPath(); ctx.arc(m.x, m.y, 3.5, 0, 6.2832); ctx.moveTo(m.x - 12, m.y); ctx.lineTo(m.x - 4, m.y); ctx.moveTo(m.x + 4, m.y); ctx.lineTo(m.x + 12, m.y); ctx.moveTo(m.x, m.y - 4); ctx.lineTo(m.x, m.y - 9); ctx.stroke(); }
  ctx.restore();
}
// 导弹小屏：边框 + 导引头的符号
function fpPipFrame(ctx) {
  const [x, y, w, h] = fpPipRect();
  ctx.save(); ctx.strokeStyle = 'rgba(242,242,234,.75)'; ctx.lineWidth = 1; ctx.strokeRect(x - .5, y - .5, w + 1, h + 1); ctx.restore();
  fpSeekHud(ctx, x, y, w, h, V3FP.pipC, false);
}
// 导引头画面的符号（像真实的导引头回传画面：白色、描一圈暗边，白热、黑白画面上都看得清）：中间留空的十字、四角取景框、目标上的跟踪框，
//   左上弹名与导引头（红外 / 电视），右上离目标多远或命中 / 落地 / 自毁，命中那一下画面闪白
function fpSeekHud(ctx, x, y, w, h, C, big) {
  const Wd = typeof FW_W === 'object' && FW_W[V3FP.mw], INK = '#f2f2ea', EDGE = 'rgba(0,0,0,.8)', cx = x + w / 2, cy = y + h / 2, end = V3FP.mEnd;
  const line = (path, col = INK, lw = big ? 1.6 : 1.2) => { ctx.beginPath(); path(); ctx.strokeStyle = EDGE; ctx.lineWidth = lw + 2; ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke(); };
  const text = (t, tx, ty, col = INK) => { ctx.lineWidth = 3; ctx.strokeStyle = EDGE; ctx.strokeText(t, tx, ty); ctx.fillStyle = col; ctx.fillText(t, tx, ty); };
  ctx.save(); ctx.lineJoin = 'round';
  if (!end) {
    const g = big ? 14 : 6, L = h * (big ? .07 : .09), bx = w * .3, by = h * .3, c = Math.min(w, h) * .06;
    line(() => {
      ctx.moveTo(cx - g - L, cy); ctx.lineTo(cx - g, cy); ctx.moveTo(cx + g, cy); ctx.lineTo(cx + g + L, cy);
      ctx.moveTo(cx, cy - g - L); ctx.lineTo(cx, cy - g); ctx.moveTo(cx, cy + g); ctx.lineTo(cx, cy + g + L);
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(cx + sx * bx, cy + sy * (by - c)); ctx.lineTo(cx + sx * bx, cy + sy * by); ctx.lineTo(cx + sx * (bx - c), cy + sy * by); }
    });
    const T = V3FP.mq;   // 跟踪框：导引头跟踪的目标点在画面上的位置
    if (T && C && C.M) {
      const M = C.M, X = T[0], Y = T[1], Z = T[2], cw = M[3] * X + M[7] * Y + M[11] * Z + M[15];
      if (cw > 0) {
        const qx = x + ((M[0] * X + M[4] * Y + M[8] * Z + M[12]) / cw + 1) / 2 * w, qy = y + (1 - ((M[1] * X + M[5] * Y + M[9] * Z + M[13]) / cw + 1) / 2) * h, r = big ? 16 : 8;
        if (qx > x + r && qx < x + w - r && qy > y + r && qy < y + h - r) line(() => ctx.rect(qx - r, qy - r, r * 2, r * 2));
      }
    }
  } else {
    const a = (performance.now() - end) / 1000;
    if (V3FP.mRes === 'hit' && a < .25) { ctx.fillStyle = `rgba(255,255,255,${.7 * (1 - a / .25)})`; ctx.fillRect(x, y, w, h); }   // 命中那一下：画面闪白（导引头被爆炸照满）
  }
  ctx.font = `${big ? 14 : 11}px "IBM Plex Mono", "Noto Sans SC", monospace`; ctx.textBaseline = 'top';
  const m = big ? 18 : 6;
  ctx.textAlign = 'left'; text(`${Wd ? Wd.nm : '导弹'} · ${fpMslEO() === 3 ? '电视' : '红外'}`, x + m, y + m);
  ctx.textAlign = 'right';
  if (end) text(V3FP.mRes === 'hit' ? '命中' : V3FP.mRes === 'gnd' ? '落地' : '自毁', x + w - m, y + m, V3FP.mRes === 'hit' ? INK : '#ffb0a0');
  else if (V3FP.md != null) text(`${(V3FP.md / 1000).toFixed(1)} km`, x + w - m, y + m);
  ctx.textBaseline = 'bottom'; text(big ? 'V 缩回小屏' : 'V 放大', x + w - m, y + h - m, 'rgba(242,242,234,.8)');
  ctx.restore();
}
// 飞行数据（画面下方正中，一小块）：空速、马赫、过载、迎角；高度、离地 / 离甲板高度、升降速度；油门、燃油；起落架、襟翼、尾钩、减速板；
//   失速、低空下沉太快「拉起」的警告；放下起落架靠近航母时加一块着舰引导（下滑道 3.5° 的光球、对中偏差、离接地点多远）
function fpHudData(ctx, w, h) {
  const o = V3FP.o, F = o && o.fl;
  if (!F) return;
  const [phi, th] = flEul(F.q), P = fpPose(), sf = flSurf(F.P[0], F.P[1]), agl = -F.P[2] - (F.gh || FL_GH) - Math.max(sf.z, -2.6), vs = -F.V[2], col = '#7dffb0', warn = '#ffb84a', red = '#ff4a4a';
  const font = n => `${n}px "IBM Plex Mono", "Noto Sans SC", monospace`, cx = w / 2, y0 = h - 92;
  ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 3;
  ctx.font = font(13); ctx.fillStyle = col;
  ctx.fillText(`${Math.round(F.Va * 3.6)} km/h   M ${F.M.toFixed(2)}   ${F.nz.toFixed(1)} G   迎角 ${(F.a * 180 / Math.PI).toFixed(1)}°`, cx, y0);
  ctx.fillText(`高度 ${Math.round(-F.P[2])} m   ${sf.k === 'deck' ? '离甲板' : '离地'} ${Math.max(0, Math.round(agl))} m   ${vs >= 0 ? '↑' : '↓'}${Math.abs(vs).toFixed(1)} m/s`, cx, y0 + 18);
  ctx.fillText(`油门 ${Math.round(V3FP.thr * 100)}%${F.ab ? ' 加力' : ''}   燃油 ${Math.round(F.fuel)} kg${F.gnd ? `   地面滑跑${F.sb ? ' · 刹车' : ''}` : ''}`, cx, y0 + 36);
  const g = F.gear, gs = g >= .99 ? '放下' : g <= .01 ? '收起' : '收放中', fl = V3FP.flapC > .75 ? '着陆' : V3FP.flapC > .25 ? '起飞' : '收起';
  const cvOk = (FL_AC[F.k] || {}).cv;
  ctx.fillStyle = g > .01 && g < .99 ? warn : col;
  ctx.fillText(`起落架 ${gs}（G）   襟翼 ${fl}（L）${cvOk ? `   尾钩 ${V3FP.hook ? '放下' : '收起'}（H）` : ''}${F.sb ? '   减速板' : ''}`, cx, y0 + 54);
  const ew = typeof ewStat === 'function' ? ewStat(o) : null;
  if (ew) { ctx.fillStyle = ew.on ? '#7fd8ff' : col; ctx.fillText(`电子战：干扰${ew.on ? `开 · 压制 ${ew.nj} 部雷达` : '关'}（J）   侦察到 ${ew.ns} 部敌雷达`, cx, y0 + 72); }
  ctx.font = font(15); ctx.fillStyle = red;
  if (F.stall > .3 && !F.gnd) ctx.fillText('失速', cx, y0 - 26);
  else if (!F.gnd && agl < 400 && vs < -Math.max(8, agl / 6) && !(g > .99 && agl < 60 && vs > -6)) ctx.fillText('拉起', cx, y0 - 26);   // 低空、下沉快：再这样几秒就撞了
  ctx.restore();
  if (g > .5 && cvOk && !F.gnd) fpMeatball(ctx, w, h, P);
}
// 雷达告警（照真实战斗机的雷达告警接收机）：
//   右下角武器表上面一个小圆，机头朝上，照着你的敌雷达按方位画——S 防空导弹、A 高炮、F 战斗机、N 军舰、E 警戒雷达；越危险越靠里：
//     只是在搜索、照到你的绿色，进了它射程的橙色，锁定了你的红色（最里圈），正在用导弹打你的红色闪；被我方干扰压着的淡蓝带斜杠；飞向你的导弹在外圈画红三角。
//   声音（Web Audio）：被锁定——每 0.25 秒一声「嘀」；导弹来袭——高低音交替的急促警报。平显上方出大字：「雷达锁定」（方位）/「导弹来袭」（钟点方位、距离，Z 热诱弹）。
//   clean：吊舱、导弹全屏视角里只出大字、响声音，不画小圆
function fpRwr(ctx, w, h, P, clean) {
  const o = V3FP.o;
  if (!o || typeof ewRwr !== 'function') return;
  const R = ewRwr(o), r = 44, cx = w - 16 - r, cy = Math.min(h - 16 - 18 * 5, V3FP.wtTop || h) - r - 14, blink = (performance.now() / 250 | 0) % 2;
  const rel = (x, y) => Math.atan2(y - P.y, x - P.x) - P.yaw, clock = a => Math.round(((a % 6.2832) + 6.2832) % 6.2832 / 6.2832 * 12) % 12 || 12;   // rel：相对机头的方位（顺时针为正）；钟点方位：正前方 12 点
  let near = null, lk = null;
  for (const m of R.msl) if (!near || m.d < near.d) near = m;
  for (const e of R.em) if (e.trk && (!lk || e.d < lk.d)) lk = e;
  fpRwrSound(near ? 2 : lk ? 1 : 0);
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 3; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (!clean) {
    ctx.fillStyle = 'rgba(0,14,8,.45)'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = near || lk ? 'rgba(255,74,74,.85)' : 'rgba(125,255,176,.7)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.2832); ctx.stroke();
    ctx.strokeStyle = 'rgba(125,255,176,.3)'; ctx.beginPath(); ctx.arc(cx, cy, r * .5, 0, 6.2832); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy - r + 6); ctx.stroke();
    ctx.font = '11px "IBM Plex Mono", monospace';
    const at = (x, y, k) => { const a = rel(x, y); return [cx + Math.sin(a) * k, cy - Math.cos(a) * k]; };
    for (const e of R.em) {
      const k = r * (e.trk ? .3 : .45 + .45 * clamp(e.d / (e.R0 * 1.6), 0, 1)), [x, y] = at(e.x, e.y, k), L = { sam: 'S', aaa: 'A', ftr: 'F', ship: 'N', ews: 'E' }[e.k] || '?';
      ctx.fillStyle = e.lock ? (blink ? '#ff4a4a' : '#ffd0d0') : e.trk ? '#ff4a4a' : e.jam ? '#7fd8ff' : e.d < e.R0 ? '#ffb84a' : '#7dffb0';
      ctx.fillText(L, x, y);
      if (e.trk) { ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.2832); ctx.stroke(); }   // 锁定的：符号外加一圈
      if (e.jam) { ctx.strokeStyle = '#7fd8ff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 5, y + 5); ctx.lineTo(x + 5, y - 5); ctx.stroke(); }
    }
    for (const m of R.msl) {
      const [x, y] = at(m.x, m.y, r - 4);
      ctx.fillStyle = '#ff4a4a'; ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 4.5, y + 4); ctx.lineTo(x - 4.5, y + 4); ctx.closePath(); ctx.fill();
    }
  }
  // 平显上方的大字（画面中间偏上，不挡准心）
  const ty = h * .24;
  if (near) {
    ctx.font = 'bold 22px "IBM Plex Mono", "Noto Sans SC", monospace'; ctx.fillStyle = blink ? '#ff3b3b' : '#ffd0d0';
    ctx.fillText(`导弹来袭  ${clock(rel(near.x, near.y))} 点  ${(near.d / 1000).toFixed(1)} km`, w / 2, ty);
    ctx.font = '13px "IBM Plex Mono", "Noto Sans SC", monospace'; ctx.fillStyle = '#ffd0d0';
    ctx.fillText(`${R.msl.length > 1 ? `${R.msl.length} 枚 · ` : ''}Z 热诱弹 · 急转、往下拉开距离`, w / 2, ty + 22);
  } else if (lk) {
    const L = { sam: '防空导弹', aaa: '高炮', ftr: '战斗机', ship: '军舰' }[lk.k] || '火控雷达';
    ctx.font = 'bold 20px "IBM Plex Mono", "Noto Sans SC", monospace'; ctx.fillStyle = '#ff6a4a';
    ctx.fillText(`雷达锁定  ${L}  ${clock(rel(lk.x, lk.y))} 点`, w / 2, ty);
  }
  ctx.restore();
}
// 雷达告警的声音（audio.js 的 Web Audio，按音频时钟排好下一声，不受帧率影响）：mode 0 静音、1 锁定（每 0.25 秒一声 1100 Hz）、2 导弹来袭（900 / 1400 Hz 交替，每 0.09 秒换一次）
function fpRwrSound(mode) {
  if (typeof AU !== 'object' || !AU.ctx || typeof auOk !== 'function' || !auOk() || typeof auTone !== 'function') return;
  const t = AU.ctx.currentTime;
  if (!mode) { V3FP.rwM = 0; return; }
  if (V3FP.rwM !== mode || !(V3FP.rwT > t - .3)) { V3FP.rwM = mode; V3FP.rwT = t + .02; V3FP.rwI = 0; }
  while (V3FP.rwT < t + .15) {
    if (mode === 1) { auTone('sfx', 'square', 1100, V3FP.rwT, .1, .05); V3FP.rwT += .25; }
    else { auTone('sfx', 'square', V3FP.rwI++ % 2 ? 1400 : 900, V3FP.rwT, .08, .06); V3FP.rwT += .09; }
  }
}
// 着舰引导（光学助降系统的样子）：放下起落架、在航母斜角甲板延长线后方 6 公里内——下滑道 3.5°，光球在中间就对了，偏高往上、偏低往下；
//   下面一行：离接地点多远、偏左偏右多少米、该飞的迎角
function fpMeatball(ctx, w, h, P) {
  if (typeof cvAll !== 'function' || typeof CVG !== 'object') return;
  const L = CVG.land;
  let best = null;
  for (const c of cvAll()) {
    if (!(c.hp > 0) || c.x < -999) continue;
    const a = c.heading + CV_LANG, dx = Math.cos(a), dy = Math.sin(a), [tx, ty] = cvW(lerp(L.u0, L.u1, CVG.td), lerp(L.v0, L.v1, CVG.td), c);
    const rx = P.x - tx, ry = P.y - ty, along = rx * dx + ry * dy, lat = -rx * dy + ry * dx;
    if (along > -40 || along < -6000 || Math.abs(lat) > Math.max(300, -along * .25)) continue;
    if (!best || -along < -best.along) best = { along, lat };
  }
  if (!best) return;
  const hd = P.z - (-2.6 + CVG.zd) - ((V3FP.o.fl || {}).gh || FL_GH), ang = Math.atan2(hd, -best.along) * 180 / Math.PI, dev = ang - 3.5;
  const x = w / 2 - 230, y = h - 150, H2 = 70, by = y + clamp(-dev / 1.5, -1, 1) * H2 * .5;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = 3;
  ctx.strokeStyle = 'rgba(125,255,176,.8)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x - 26, y); ctx.lineTo(x - 8, y); ctx.moveTo(x + 8, y); ctx.lineTo(x + 26, y); ctx.stroke();   // 基准灯（中间那条线）
  ctx.strokeRect(x - 5, y - H2 / 2, 10, H2);
  ctx.fillStyle = Math.abs(dev) < .4 ? '#7dffb0' : Math.abs(dev) < 1 ? '#ffb84a' : '#ff4a4a';
  ctx.beginPath(); ctx.arc(x, by, 6, 0, 6.2832); ctx.fill();
  ctx.font = '12px "IBM Plex Mono", "Noto Sans SC", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = '#7dffb0';
  const side = Math.abs(best.lat) < 3 ? '对中' : best.lat > 0 ? `偏右 ${Math.round(best.lat)} m` : `偏左 ${Math.round(-best.lat)} m`;
  ctx.fillText(`着舰 ${(-best.along / 1000).toFixed(1)} km · ${dev > .4 ? '偏高' : dev < -.4 ? '偏低' : '下滑道上'} · ${side}`, x, y + H2 / 2 + 6);
  ctx.fillText('迎角保持 8–9°，挂索后自动拉停', x, y + H2 / 2 + 22);
  ctx.restore();
}

// —— 输入 ——
function fpView() { if (V3FP.mv != null) { V3FP.mBig = !V3FP.mBig; V3FP.mo = [0, 0]; } else fwMsg('发射导弹后右上角的小屏是导引头画面（光电），V 放大'); }
function fpGear() {
  const F = V3FP.o && V3FP.o.fl;
  if (F && F.gnd && V3FP.gear) { fwMsg('在地面上不能收起落架'); return; }
  V3FP.gear = !V3FP.gear; fwMsg(V3FP.gear ? '放起落架' : '收起落架');
}
function fpFlap() { V3FP.flapC = V3FP.flapC > .75 ? 0 : V3FP.flapC > .25 ? 1 : .5; fwMsg(V3FP.flapC > .75 ? '襟翼：着陆' : V3FP.flapC > .25 ? '襟翼：起飞' : '襟翼：收起'); }
// J：歼-16D 的干扰吊舱开 / 关（关了不压制敌雷达，也不再因为一直发射被敌方无源侦察测到；电子侦察是无源的，一直在收）
function fpJam() {
  const o = V3FP.o;
  if (!o || typeof ewIsJ !== 'function' || !ewIsJ(o)) { fwMsg('这型飞机没有干扰吊舱（歼-16D 才有）'); return; }
  o.jam = o.jam === false; fwMsg(o.jam ? '干扰吊舱：开（压制敌雷达，但自己会被测到方位）' : '干扰吊舱：关（只做电子侦察）');
}
function fpHook() {
  const F = V3FP.o && V3FP.o.fl;
  if (!F || !(FL_AC[F.k] || {}).cv) { fwMsg('陆基飞机没有尾钩'); return; }
  V3FP.hook = !V3FP.hook; fwMsg(V3FP.hook ? '放尾钩' : '收尾钩');
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('keydown', e => {
    if (!V3FP.on || (e.target && e.target.closest && e.target.closest('input,textarea,select'))) return;
    if (!V3FP_KEYS[e.code]) return;
    e.preventDefault(); e.stopPropagation();   // 操纵时这些键只归这里（不然 V、T、F、R 还会选中支援菜单的工具，方向键会平移地图）
    if (e.repeat) return;
    V3FP.keys.add(e.code);
    if (V3FP.k === 'air') {   // 杆、舵、油门在 fpFly 里按住多久推多少；这里只处理按一下的
      if (e.code === 'KeyV') fpView();   // 导弹视角：小屏放大成全屏 / 缩回
      if (e.code === 'KeyF') fwFire();
      if (e.code === 'KeyR') fwCycle();   // 换目标（光电吊舱里：锁定十字下的目标，再按解锁）
      if (e.code === 'KeyG') fpGear();
      if (e.code === 'KeyL') fpFlap();
      if (e.code === 'KeyH') fpHook();
      if (e.code === 'KeyJ') fpJam();
      if (typeof ftOn === 'function') {   // 光电吊舱、热诱弹（fptgp.js）：Y 进出吊舱，吊舱里 U 按档变焦（也可滚轮）、N 白热 / 黑热 / 电视；Z 热诱弹
        if (e.code === 'KeyY') { if (V3FP.vw === 'tgp') ftOff(); else ftOn(); }
        if (e.code === 'KeyZ') ftFlare();
        if (e.code === 'KeyN' && V3FP.vw === 'tgp') ftModeNext();
        if (e.code === 'KeyU' && V3FP.vw === 'tgp') ftZoomStep();
      }
      if (e.code === 'KeyI' && typeof fiToggle === 'function') fiToggle();   // 机型与挂载参数面板（fpinfo.js）
      const dg = /^Digit([1-6])$/.exec(e.code);
      if (dg) fwSel(+dg[1] - 1);
      if (e.code === 'KeyC') { if (V3FP.ctl === 'ace') V3FP.rcT = performance.now(); else { V3FP.free = true; if (V3FP.ctl === 'stick') V3FP.ms = [0, 0]; } }   // 皇牌空战式：镜头转回机尾后方；别的方式按住自由视角（鼠标摇杆时顺便杆回中）
      if (e.code === 'KeyM') { V3FP.ctl = V3FP.ctl === 'ace' ? 'aim' : V3FP.ctl === 'aim' ? 'stick' : 'ace'; V3FP.ms = [0, 0]; V3FP.orb = [0, 0]; V3FP.cy = null; if (V3FP.ctl === 'aim' && V3FP.o) { const B = fpBody(V3FP.o); V3FP.aim = [Math.atan2(-B.f[1], B.f[0]), Math.asin(clamp(B.f[2], -1, 1))]; } log(V3FP.ctl === 'aim' ? '鼠标瞄准（战争雷霆式）' : V3FP.ctl === 'stick' ? '鼠标摇杆' : '皇牌空战式：鼠标准心管飞去哪儿，A / D 横滚（按住一直滚）、↑ / ↓ 推拉杆，机动性放大 ' + FP_MK + ' 倍', 'info', 'fpctl', 1); }
      if (e.code === 'KeyK') { V3FP.ffb = !V3FP.ffb; log(V3FP.ffb ? '受力回馈：开' : '受力回馈：关', 'info', 'fpffb', 1); }
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
    if (fpLocked()) { dx = e.movementX || 0; dy = e.movementY || 0; if (Math.abs(dx) > 250 || Math.abs(dy) > 250) return; }   // 刚锁定鼠标、切窗口回来时浏览器偶尔报一次几百像素的假位移：丢掉（不然准星一下甩到身后，飞机莫名其妙掉头）
    else if (V3FP.drag) { dx = e.clientX - V3FP.drag[0]; dy = e.clientY - V3FP.drag[1]; V3FP.drag = [e.clientX, e.clientY]; }
    if (!dx && !dy) return;
    if (V3FP.k === 'air') {
      if (V3FP.mv != null && V3FP.mBig) return;   // 导弹全屏视角是导引头画面（镜头钉在弹头上），鼠标不转它、也不带机头
      if (V3FP.vw === 'tgp' && typeof ftSlew === 'function') { ftSlew(dx, dy); return; }   // 光电吊舱：鼠标转视线（fptgp.js）
      if (V3FP.drag && V3FP.dbtn === 2) V3FP.rmv = (V3FP.rmv || 0) + Math.abs(dx) + Math.abs(dy);   // 右键拖动了多远（拖得少算单击：换目标）
      if (V3FP.ctl === 'ace') {   // 皇牌空战式：鼠标移动准心（世界坐标里的方位、高度角，飞机朝它飞，镜头顺着它看；C 转回机头方向）
        if (V3FP.drag && V3FP.dbtn === 2) { V3FP.orb[0] = airAng(V3FP.orb[0] - dx * .004); V3FP.orb[1] = clamp(V3FP.orb[1] - dy * .0032, -1.4, 1.4); V3FP.mlT = performance.now(); return; }   // 按住右键拖动：看四周，不动准心
        if (!V3FP.drag && Math.abs(dx) + Math.abs(dy) < 2) return;   // 手搭在鼠标上的小抖动不动准心
        if (V3FP.cy == null) return;
        V3FP.cy = airAng(V3FP.cy - dx * .004); V3FP.rcT = 0;
        if (V3FP.ael != null) V3FP.ael = clamp(V3FP.ael - dy * .0026, -1.2, 1.2);   // 上下：移动准心（飞机跟着爬升 / 俯冲，镜头俯仰跟着准心）
        return;
      }
      if (V3FP.free || (V3FP.drag && V3FP.dbtn === 2)) {   // 自由视角（按住 C、右键拖动），松开后慢慢转回机尾后方
        V3FP.orb[0] = airAng(V3FP.orb[0] - dx * .004); V3FP.orb[1] = clamp(V3FP.orb[1] - dy * .0032, -1.4, 1.4); V3FP.mlT = performance.now();
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
    if (V3FP.on && V3FP.k === 'air' && V3FP.vw === 'tgp' && typeof ftZoom === 'function' && typeof R === 'object' && e.target === R.cv) { ftZoom(e.deltaY); e.preventDefault(); e.stopPropagation(); return; }   // 吊舱：滚轮变焦
    if (!V3FP.on || V3FP.k !== 'air' || typeof R !== 'object' || e.target !== R.cv) return;
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
    if (kind === 'down') { V3FP.dbtn = e.button; V3FP.rmv = 0; if (fpLocked()) { V3FP.drag = e.button === 2 ? [e.clientX, e.clientY] : null; if (e.button === 0) fwFire(); } else { V3FP.drag = [e.clientX, e.clientY]; if (!V3.coarse) fpLock(); } }   // 锁定鼠标后左键开火（头一下先锁定鼠标）
    if (kind === 'up') { if (V3FP.dbtn === 2 && (V3FP.rmv || 0) < 6 && fpLocked()) fwCycle(); V3FP.drag = null; }   // 右键单击（没怎么拖）：换目标
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
    // 飞机：▲ 推杆、▼ 拉杆、◀ ▶ 滚转（按住），油门 ± 按住，「武器」换下一种、「开火」打红框、「机炮」按住、「换目标」、「起落架」、「刹车」按住、「导弹」放大导弹视角；舰：▲ ▼ 车钟、◀ ▶ 转舵，「开火」主炮、「武器」垂发
    mk(L, '▲', () => { if (air()) T.y = -1; else V3FP.tele = Math.min(FP_TELE.length - 1, V3FP.tele + 1); }, () => { T.y = 0; });
    mk(L, '◀', () => { T.x = -1; }, () => { T.x = 0; });
    mk(L, '▶', () => { T.x = 1; }, () => { T.x = 0; });
    mk(L, '▼', () => { if (air()) T.y = 1; else V3FP.tele = Math.max(0, V3FP.tele - 1); }, () => { T.y = 0; });
    mk(L, '油门+', () => { if (air()) V3FP.keys.add('KeyW'); else V3FP.tele = Math.min(FP_TELE.length - 1, V3FP.tele + 1); }, () => V3FP.keys.delete('KeyW'));
    mk(L, '油门−', () => { if (air()) V3FP.keys.add('KeyS'); else V3FP.tele = Math.max(0, V3FP.tele - 1); }, () => V3FP.keys.delete('KeyS'));
    mk(Rg, '开火', () => { if (air()) fwFire(); else fpFire(false); });
    mk(Rg, '武器', () => { if (air()) fwNext(); else fpFire(true); });
    mk(Rg, '机炮', () => { V3FP.touchGun = true; }, () => { V3FP.touchGun = false; });
    mk(Rg, '换目标', () => { if (air()) fwCycle(); });
    mk(Rg, '加力', () => { if (air()) V3FP.ab = !V3FP.ab; });
    mk(Rg, '起落架', () => { if (air()) fpGear(); });
    mk(Rg, '刹车', () => { T.sb = true; }, () => { T.sb = false; });
    if (typeof ftOn === 'function') {   // 光电吊舱（进出、拖动画面转视线）、热诱弹、变焦、白热 / 黑热 / 电视（fptgp.js）；吊舱里「换目标」是锁定十字下的目标
      mk(Rg, '吊舱', () => { if (!air()) return; if (V3FP.vw === 'tgp') ftOff(); else ftOn(); });
      mk(Rg, '诱弹', () => { if (air()) ftFlare(); });
      mk(Rg, '变焦', () => { if (air() && V3FP.vw === 'tgp') ftZoomStep(); });
      mk(Rg, '红外', () => { if (air() && V3FP.vw === 'tgp') ftModeNext(); });
    }
    if (typeof fiToggle === 'function') mk(Rg, '参数', () => { if (air()) fiToggle(); });   // 机型与挂载参数（fpinfo.js）
    mk(Rg, '回正', () => { V3FP.look = [0, 0]; V3FP.orb = [0, 0]; V3FP.ms = [0, 0]; V3FP.rcT = performance.now(); });
    mk(Rg, '导弹', () => { if (air()) fpView(); });
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
