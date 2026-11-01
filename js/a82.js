'use strict';
// 美军第 82 空降师（守方）：联合强行进入（JFE）——C-17A 低空伞降一个加强伞兵连 + 重装空投，随后 CH-47F 吊运 M777A2 榴弹炮前出。
//   番号：第 1 旅战斗队（「魔鬼旅」）第 504 伞兵团 1 营 A 连（加强），配属第 3 营 319 空降野战炮兵团（M119A3）、第 82 空降师炮兵（M777A2）、
//   第 82 战斗航空旅（CH-47F、AH-64E）。编制照美军轻步兵 / 空降步兵连（ATP 3-21.8、ATP 3-21.10）：
//     连部、3 个步枪排（排部 + 3 个 9 人步枪班 + 武器班：2 个 M240B 机枪组、2 个标枪反坦克组）、迫击炮班（2 门 M224A1 60 毫米迫击炮），
//     另配毒刺防空组、营狙击组。游戏里一个小组 3 人：步枪班 = 班长组（M4A1 ×2 + M110 精确射手步枪）+ A、B 两个火力组（M4A1 ×2 + M249）。全连 47 组 139 人。
//   装机按真实的「交叉装载」：同一个排分在几架飞机上（一架被打下不至于整排全没）；4 架伞兵机各 7–14 组、第 5 架重装空投（2 辆 JLTV M1278 重型火力车 + 2 门 M119A3）。
//   投放参数：人员 800 英尺（244 米）离地、重装 1100 英尺（335 米）；进场约 250 节、投放 140 节（72 米/秒）；两侧舱门同时跳，每门约每秒一人（游戏里每 1.4 秒出 3 人）；
//     T-11 伞开伞约 3 秒、掉 35 米，之后平均每秒下降 19 英尺（5.8 米），约 40 秒落地；重装平台 G-11 组伞约每秒 8.5 米。
//   空降场：在受威胁据点的内陆一侧 1.2–3.2 公里、东西向一条 1.4 公里长的平地，整条离我军地面部队 900 米以外、离已知防空 1.5 公里以外；
//     运输机从东或西图边沿空降场轴线进场，投完爬升北返。落地后各组向空降场靠目标一端集合，整连编成战斗群（orbat.js）攻击或增援（目标选择同 101，a101Aim）。
//   迫击炮班落地后到集合点后方 250 米架炮，成为守方迫击炮阵地（射程 3.5 公里、威力小于 81 毫米）；M119A3 落地后 90 秒架好开火。
//   标枪：每组 3 发，2.5 公里内、守方看得见的我方车辆，原地不动锁定 5 秒后发射——软发射出筒、主发动机点火，攻顶模式爬到约 160 米再俯冲砸车顶（a82Jav）。
//   CH-47F：开始伞降后约 150 秒，2 架各吊一门 M777A2 从北图边飞到空降场以北 2.5–4.5 公里的炮位，悬停放下火炮、落地卸下炮班与弹药，北返；炮班 2 分钟架好炮。
//   C-17、CH-47 都在 S.eair.fly 里（我方战斗机、舰空导弹、防空车、便携防空导弹都能打），被打下时机上的人员装备一起损失。
// 状态：S.e82 = { n 剩余波数, next, lift: {...} | null, ch: [下降中], jv: [飞行中的标枪], cx: [吊运的火炮], done }
const A82 = { first: { normal: 300, hard: 230, hell: 170 }, gap: 320, n: { normal: 0, hard: 1, hell: 1 },
  jumpH: 244, hvyH: 335, vT11: 5.8, vG11: 8.5, open: 3, vIn: 130, vDrop: 72, exit: 1.4, hvyExit: 1.6,
  dzLen: 1400, dzMin: 1200, dzMax: 3200, safe: 900, aaR: 1500, sig: 16,
  mod: { pow: 1.25, rof: 1.1, hard: .2, calm: .8 },
  javR: 2500, javMin: 65, javLock: 5, javRe: 20, javSpd: 160, javTop: 160,
  chDelay: 150, gunSet: 120, m119Set: 90 };
// 每组：men 推演里的兵种，w 三维里各人手里的武器（v3a82.js 按这个画用户给的枪械模型），nm 名称
const A82_T = {
  hq: { men: ['radio', 'rifle', 'rifle'], w: ['m4a1', 'm4a1', 'm4a1'], nm: '连部' },
  plt: { men: ['radio', 'rifle', 'rifle'], w: ['m4a1', 'm4a1', 'm4a1'], nm: '排部' },
  sql: { men: ['rifle', 'rifle', 'rifle'], w: ['m4a1', 'm110', 'm4a1'], nm: '班长组', mod: { rng: 1.15 } },   // 班长 + 精确射手（M110）
  sqa: { men: ['rifle', 'mg', 'rifle'], w: ['m4a1', 'm249', 'm4a1'], nm: 'A 火力组' },
  sqb: { men: ['rifle', 'mg', 'rifle'], w: ['m4a1', 'm249', 'm4a1'], nm: 'B 火力组' },
  mg: { men: ['mg', 'rifle', 'rifle'], w: ['m240', 'm4a1', 'm4a1'], nm: 'M240B 机枪组', mod: { sup: 1.6, rng: 1.2 } },
  jav: { men: ['rifle', 'rifle', 'rifle'], w: ['javl', 'm4a1', 'm4a1'], nm: '标枪反坦克组', jav: 3 },
  mor: { men: ['rifle', 'rifle', 'rifle'], w: ['m4a1', 'm4a1', 'm4a1'], nm: 'M224A1 迫击炮班', mor: true },
  stg: { men: ['rifle', 'aa', 'rifle'], w: ['m4a1', 'stinger', 'm4a1'], nm: '毒刺防空组', aam: 3 },
  snp: { men: ['rifle', 'rifle'], w: ['m110', 'm4a1'], nm: '营狙击组', mod: { rng: 1.9, pow: 2.3, rof: .8 } }
};
// 装机（跳伞顺序；'键:排'，排 0 = 连部直属）
const a82Sq = pl => [`sql:${pl}`, `sqa:${pl}`, `sqb:${pl}`];
const A82_LOAD = [
  { sq: ['hq:0', 'plt:1', ...a82Sq(1), ...a82Sq(1), ...a82Sq(1), 'stg:0'] },
  { sq: ['plt:2', ...a82Sq(2), ...a82Sq(2), ...a82Sq(2), 'mg:1', 'mg:1', 'jav:1', 'jav:1'] },
  { sq: ['plt:3', ...a82Sq(3), ...a82Sq(3), ...a82Sq(3), 'mg:2', 'mg:2', 'jav:2', 'jav:2'] },
  { sq: ['mg:3', 'mg:3', 'jav:3', 'jav:3', 'mor:0', 'mor:0', 'snp:0'] },
  { sq: [], veh: [{ k: 'jltv' }, { k: 'm119' }, { k: 'm119' }, { k: 'jltv' }] }
];
const A82_UNIT = ['A 连连部', 'A 连 1 排', 'A 连 2 排', 'A 连 3 排'];
const a82Men = () => A82_LOAD.reduce((a, L) => a + L.sq.reduce((b, s) => b + A82_T[s.split(':')[0]].men.length, 0), 0);
// 守方飞机的型号：CH-47F（a82.js 自己飞，eair.js 见 a.a82 就交给 a82Fly）
if (typeof EA_SPEC === 'object') EA_SPEC.ch47 = { name: 'CH-47F 支奴干运输直升机', spd: 72, turn: 1.4, hp: 3, flares: 2 };
if (typeof EA_SIL === 'object') EA_SIL.ch47 = 'uh60';   // 平面画面的剪影借黑鹰的（直升机轮廓）

function a82Ensure() {
  if (S.e82 && Array.isArray(S.e82.ch)) return S.e82;
  const lv = S.level || 'hard', sbx = S.mode === 'sandbox', isle = !!(S.lv && S.lv.isle);   // 架空的海岛战役：守方不编入真实部队番号
  return (S.e82 = { n: isle ? 0 : sbx ? (S.assets && S.assets.e82) || 0 : A82.n[lv] || 0, next: (A82.first[lv] || 230) * (sbx ? .8 : 1), lift: null, ch: [], jv: [], cx: [], done: 0 });
}
const a82AirH = () => typeof V3_AIR === 'number' ? V3_AIR : 352.7;   // 飞机高度 alt 1 对应多少米（view3d.js）
const a82Alt = m => m / a82AirH() + .05;
// 一条空降场（东西向、长 dzLen）上的点：中心 (x, y)，u ∈ [−.5, .5]
const a82Foes = () => [...S.teams.filter(q => q.side === 'p' && q.men.length && !q.ride && isLand(q.x, q.y)), ...(S.veh || []).filter(v => v.side === 'p' && !v.dead && !v.lst && isLand(v.x, v.y))];
const a82AA = () => [...S.teams.filter(q => q.side === 'p' && q.men.length && q.men.includes('aa') && q.aaSeenE != null && S.t - q.aaSeenE < 240),
  ...(S.veh || []).filter(v => v.side === 'p' && !v.dead && (v.type === 'aa_veh' || v.type === 'sam_veh') && spotted(v.x, v.y))];
function a82Clean(x0, y0, L, w) {
  for (let u = -.5; u <= .5001; u += 50 / L) for (const dy of [-w / 2, 0, w / 2]) {
    const x = x0 + u * L, y = y0 + dy;
    if (x < 20 || x > W - 20 || y < 20 || y > H - 20) return false;
    const t = typeAt(x, y);
    if (isWater(t) || t === T.RIVER || t === T.CLIFF || t === T.FORD || !passInf(x, y)) return false;
  }
  return true;
}
// 空降场：目标据点 p 内陆一侧（北）1.2–3.2 公里；整条离我军地面部队 safe 以外、离已知防空 aaR 以外；近目标、远离我军、平坦的优先
function a82DZ(p) {
  const foes = a82Foes(), aa = a82AA(), L = A82.dzLen;
  let best = null, bs = -Infinity;
  for (let k = 0; k < 160; k++) {
    const r = A82.dzMin + Math.random() * (A82.dzMax - A82.dzMin), a = -Math.PI / 2 + gauss() * .55;
    const x = clamp(p.x + Math.cos(a) * r, L / 2 + 150, W - L / 2 - 150), y = clamp(p.y + Math.sin(a) * r, 200, H - 200);
    if (!isLand(x, y) || coastAt(x) - y < 600 || !a82Clean(x, y, L, 240)) continue;
    let dp = 1e9;
    for (const o of foes) { const dx = Math.max(0, Math.abs(o.x - x) - L / 2), d = Math.hypot(dx, o.y - y); if (d < dp) dp = d; }
    if (dp < A82.safe || aa.some(o => Math.hypot(Math.max(0, Math.abs(o.x - x) - L / 2), o.y - y) < A82.aaR)) continue;
    const s = Math.min(dp, 2500) / 400 - dist(x, y, p.x, p.y) / 700 + Math.random() * .4;
    if (s > bs) { bs = s; best = { x: Math.round(x), y: Math.round(y) }; }
  }
  return best;
}
// 炮位（CH-47F 放 M777A2）：空降场再往北 2.5–4.5 公里（目标在射程里，离我军远），平坦、离我军与已知防空远
function a82GunPos(p, dz) {
  const foes = a82Foes(), aa = a82AA();
  let best = null, bs = -Infinity;
  for (let k = 0; k < 120; k++) {
    const r = 2500 + Math.random() * 2000, a = -Math.PI / 2 + gauss() * .5, x = clamp(p.x + Math.cos(a) * r, 150, W - 150), y = clamp(p.y + Math.sin(a) * r, 150, H - 150);
    if (!isLand(x, y) || !a82Clean(x, y, 160, 120)) continue;
    let dp = 1e9;
    for (const o of foes) { const d = dist(o.x, o.y, x, y); if (d < dp) dp = d; }
    if (dp < 1500 || aa.some(o => dist(o.x, o.y, x, y) < A82.aaR)) continue;
    const s = Math.min(dp, 3500) / 500 - Math.abs(r - 3200) / 800 + Math.random() * .3;
    if (s > bs) { bs = s; best = { x: Math.round(x), y: Math.round(y) }; }
  }
  return best || (dz ? { x: dz.x, y: Math.max(150, dz.y - 900) } : null);
}

// —— 起飞：4 架伞兵机 + 1 架重装机，同一条航线前后拉开（每架间隔约 25 秒），交替左右偏 60 米避开前机尾流 ——
function a82Think() {
  const E8 = a82Ensure();
  if (E8.lift || !(E8.n > 0) || S.t < E8.next || typeof eaEnsure !== 'function') return;
  if (S.teams.filter(q => q.side === 'p' && q.men.length && isLand(q.x, q.y)).length < 5) return;
  if (S.e101 && S.e101.lift) { E8.next = S.t + 20; return; }   // 和 101 错开，不同时用空域
  const p = typeof a101Obj === 'function' ? a101Obj() : null, dz = p && a82DZ(p);
  if (!dz) { E8.next = S.t + 15; return; }
  const E = eaEnsure(), id = S.nid++, foes = a82Foes();
  const westFar = foes.reduce((a, o) => a + (o.x < dz.x ? 1 : 0), 0) < foes.length / 2, dir = westFar ? 1 : -1;   // 从我军少的一侧进场
  E8.lift = { id, dz, dir, key: p.key, t: S.t, land: 0, veh: 0, guns: 0, lost: 0, us: [], vs: [], rec: [], men: a82Men(), ap: { x: dz.x, y: Math.round(dz.y + 140) } };
  E8.n--; E8.next = S.t + A82.gap;
  E8.chq = { at: S.t + A82.chDelay, key: p.key, dz };   // 伞降开始约 150 秒后 CH-47F 吊炮出动（与伞降这一波是否结束无关）
  A82_LOAD.forEach((L, k) => {
    const back = k * 1800 + 600, lat = (k % 2 ? 60 : -60), hv = !!(L.veh && L.veh.length);
    E.fly.push({ id: S.nid++, type: 'c17', a82: true, lift: id, k, x: dir > 0 ? -back : W + back, y: dz.y + lat, heading: dir > 0 ? 0 : Math.PI, spd: A82.vIn, alt: a82Alt(hv ? A82.hvyH : A82.jumpH), bank: 0,
      hp: EA_SPEC.c17.hp, flares: EA_SPEC.c17.flares, ph: 'in', sq82: L.sq.slice(), veh82: (L.veh || []).slice(), rT: 0, t: S.t, pv: false, sq: [], veh: [] });
  });
  if (typeof v8Stat === 'function') v8Stat('a82Go');
  log(`敌第 82 空降师联合强行进入：${A82_LOAD.length} 架 C-17A 正沿${dir > 0 ? '西' : '东'}面航线进场，空降场在${typeof cmdWhere === 'function' ? cmdWhere(dz.x, dz.y) : gridRef(dz.x, dz.y)}一带`, 'bad', null, 0, { x: dz.x, y: dz.y });
}

// 守方飞机里属于 82 师的（eair.js 交过来）：C-17 伞降 / 重装空投，CH-47F 吊运火炮
function a82Fly(a, dt) {
  if (a.type === 'sh60b') return typeof mh60Fly === 'function' ? mh60Fly(a, dt) : (a.dead = true);   // 美舰的舰载直升机（mh60.js）
  if (a.type === 'ch47') return a82Heli(a, dt);
  const E8 = a82Ensure(), L = E8.lift && E8.lift.id === a.lift ? E8.lift : null, left = a.sq82.length + a.veh82.length;
  if (!L) { a.ph = 'out'; a.sq82 = []; a.veh82 = []; }
  const dz = L ? L.dz : { x: a.x, y: a.y }, dir = L ? L.dir : 1, x0 = dz.x - dir * A82.dzLen / 2, x1 = dz.x + dir * A82.dzLen / 2;
  if (a.ph === 'rtb') a.ph = left && dir * (a.x - x0) > -900 ? (a.rel ? 'drop' : 'in') : left ? 'abort' : 'out';   // 中弹：快到空降场就硬着头皮投完，远的带着人返航
  if (a.ph === 'in' || a.ph === 'drop') {
    const ty = dz.y + (a.k % 2 ? 60 : -60), ahead = dir * (x0 - a.x);   // 离开始投放点还有多远
    const want = a.ph === 'drop' || ahead < 2500 ? A82.vDrop : A82.vIn;   // 投放前 2.5 公里减到投放速度
    eaSteer(a, a.x + dir * 900, ty, dt, want);
    if (a.ph === 'in' && ahead <= 0) { a.ph = 'drop'; a.rT = 0; a.rel = true; }
    if (a.ph === 'drop') {
      if ((a.rT -= dt) <= 0) { const hv = !a.sq82.length && a.veh82.length; a.rT = hv ? A82.hvyExit : A82.exit; a82Release(a); }
      if (!a.sq82.length && !a.veh82.length) a.ph = 'out';
      if (dir * (a.x - x1) > 350 && (a.sq82.length || a.veh82.length)) a.ph = 'out';   // 过了空降场还没跳完的（跳得慢）：带回去
    }
    return;
  }
  // 返航：爬升、转向北，出图
  a.alt = Math.min(1, a.alt + dt * .03);
  eaSteer(a, a.x + dir * 1500, -1200, dt, A82.vIn + 60);
  if (a.y < -150 || a.x < -2500 || a.x > W + 2500) { a.dead = true; a.home = true; }
}
// 出舱：伞兵一组 3 人（两侧舱门），重装平台一个
function a82Release(a) {
  const E8 = a82Ensure(), L = E8.lift;
  if (a.sq82.length) {
    const s = a.sq82.shift(), [key, pl] = s.split(':'), T0 = A82_T[key];
    E8.ch.push({ k: 'team', id: S.nid++, lift: a.lift, key, pl: +pl, men: T0.men.slice(), w: T0.w.slice(), x: a.x - Math.cos(a.heading) * 20 + gauss() * A82.sig, y: a.y + gauss() * A82.sig * 1.6, z: A82.jumpH, t: 0, hT: 0, T: 0 });
  } else if (a.veh82.length) {
    const v = a.veh82.shift();
    E8.ch.push({ k: 'veh', id: S.nid++, lift: a.lift, v, x: a.x - Math.cos(a.heading) * 30 + gauss() * 8, y: a.y + gauss() * 10, z: A82.hvyH, t: 0, h: a.heading });
  }
  if (L && !L.said) {
    L.said = true;
    if (spotted(a.x, a.y) || inVision(a.x, a.y)) log('敌 C-17 运输机在空降场上空投放，伞兵与重装平台成串落下——美军第 82 空降师', 'bad', null, 0, { x: a.x, y: a.y });
  }
}
// 下降：先开伞（掉 35 米），之后按 T-11 / G-11 的下降速度；随风飘（每秒东 3、北 2 米，与 101、蛟龙一致）；下降中挨我方地面火力
function a82Chutes(dt) {
  const E8 = a82Ensure();
  for (const c of E8.ch) {
    c.t += dt; c.x += 3 * dt; c.y -= 2 * dt;
    const op = c.k === 'veh' ? 4 : A82.open, v = c.k === 'veh' ? A82.vG11 : A82.vT11;
    c.z -= (c.t < op ? (c.k === 'veh' ? 60 : 35) / op : v) * dt;
    if (c.z > 0) continue;
    c.done = true;
    a82Land(c);
  }
  if (E8.ch.some(c => c.done)) E8.ch = E8.ch.filter(c => !c.done);
  if ((E8.fT = (E8.fT ?? .5) - dt) > 0) return;
  E8.fT = .5;
  const air = E8.ch.filter(c => c.k === 'team' && c.men.length && c.z > 2), shoot = (src, R, pk) => {
    const L = air.filter(c => dist(src.x, src.y, c.x, c.y) < R);
    if (!L.length) return;
    const c = L[Math.floor(Math.random() * L.length)];
    tracer(src.x, src.y, c.x + gauss() * 4, c.y - c.z * .15, 'p', true);
    if (Math.random() < pk && c.men.length) { const i = Math.floor(Math.random() * c.men.length); c.men.splice(i, 1); c.w.splice(i, 1); S.stats.killed++; const Lf = E8.lift; if (Lf && Lf.id === c.lift) Lf.lost++; }
  };
  if (!air.length) return;
  for (const q of S.teams) if (q.side === 'p' && q.men.length && q.sup < 70 && !q.ride) shoot(q, 450, .05 * q.men.length / 3);
  for (const v of S.veh || []) if (v.side === 'p' && !v.dead && (v.type === 'aa_veh' || v.type === 'sam_veh')) shoot(v, 1500, .35);
}
// 各排：连部 0、1–3 排（role = 'bg'：战斗群统一指挥；ab：各空降模块自己指挥，战区不调度，theater.js thAir）
function a82Unit(L, pl) {
  if (L.us[pl] != null && UNIT_MAP.get(L.us[pl])) return UNIT_MAP.get(L.us[pl]);
  const p = S.points.find(o => o.key === L.key) || S.points[0];
  const u = addUnit('e', 'inf', { role: 'bg', obj: p.key, form: 'wedge', a4n: `第 82 空降师 504 团 1 营${A82_UNIT[pl] || ''}`, morale: 92, elite: true, ab: 'a82' });
  L.us[pl] = u.id; u.a4T = S.t;
  return u;
}
function a82Land(c) {
  const E8 = a82Ensure(), L = E8.lift && E8.lift.id === c.lift ? E8.lift : null;
  let x = clamp(c.x, 10, W - 10), y = clamp(c.y, 10, H - 10);
  const n = c.k === 'team' ? c.men.length : 0;
  if (isWater(typeAt(x, y))) { if (L) L.lost += n; return; }
  if (!passInf(x, y)) {
    const j = nearestPassable(ci(x, y), c.k === 'veh' ? 'vehe' : 'e');
    if (j < 0 || dist(cellCX(j), cellCY(j), x, y) > 30) { if (L) L.lost += n; return; }
    x = cellCX(j); y = cellCY(j);
  }
  if (!L) return;
  const p = S.points.find(o => o.key === L.key) || S.points[0], ap = L.ap, face = Math.atan2(p.y - ap.y, p.x - ap.x);
  if (c.k === 'veh') {
    if (c.v.k === 'm119') {   // M119A3：落地后炮班把炮从平台上解下、架起（约 90 秒后开火）
      const e = addEnemy('arty', x, y);
      e.mod = { rof: 1.35, rng: .8 }; e.a82g = 'm119'; e.cd = A82.m119Set; e.th = face; e.hp = Math.round(e.hp * .8); e.maxhp = e.hp;
      L.guns++;
      return;
    }
    const v = addVehicle('e', 'recon', x, y, { auto: true, mdl: 'JLTV M1278 重型火力车（M2HB 机枪）', a82: true, heading: c.h, aim: c.h });
    if (!v) return;
    v.hx = ap.x; v.hy = ap.y; v.home = L.key;
    v.cmd = { x: ap.x + gauss() * 40, y: ap.y + 60 + gauss() * 30, t: 'move', face, until: S.t + 120, ai: 'asm' };
    L.vs.push(v.id); L.veh++;
    return;
  }
  if (!n) return;
  const T0 = A82_T[c.key], u = a82Unit(L, c.pl), k = L.land;
  const q = addTeam('e', x, y, c.men, { role: 'bg', bg: true, obj: p.key, u: u.id, a82: true, a82w: c.w.slice(), a82k: c.key, mod: { ...A82.mod, ...(T0.mod || {}), ...(T0.jav ? { at: 0 } : {}) } });
  if (T0.jav) q.jav = T0.jav;
  if (T0.aam) q.aam = T0.aam;
  if (c.key === 'snp') { L.rec.push(q.id); q.recon = true; }
  if (T0.mor) { q.a82mor = { x: Math.round(ap.x + gauss() * 25 - Math.cos(face) * 250), y: Math.round(ap.y - Math.sin(face) * 250 + gauss() * 25), t: null }; aiGo(q, q.a82mor.x, q.a82mor.y, 'move', p.x, p.y); }
  else {   // 集合：按排在集合点左右展开（排 1 左、2 中、3 右，连部居中靠后）
    const side = [0, -1, 0, 1][c.pl] || 0, back = c.pl ? 0 : 90, ox = -Math.sin(face) * side * 180 - Math.cos(face) * back, oy = Math.cos(face) * side * 180 - Math.sin(face) * back;
    const a = k * 2.4, r = 10 + (k % 7) * 7;
    aiGo(q, ap.x + ox + Math.cos(a) * r, ap.y + oy + Math.sin(a) * r, 'move', p.x, p.y);
  }
  L.land++;
}
// 迫击炮班：到了炮位、停稳 20 秒，架成迫击炮阵地（M224A1：射程约 3.5 公里，60 毫米弹威力小）
function a82Mortars() {
  for (const q of S.teams) {
    if (!q.a82mor || !q.men.length) continue;
    const M = q.a82mor;
    if (dist(q.x, q.y, M.x, M.y) > 18) { if (S.t - (M.goT ?? -99) > 20) { M.goT = S.t; aiGo(q, M.x, M.y, 'move'); } continue; }
    if (M.t == null) { M.t = S.t; continue; }
    if (S.t - M.t < 20) continue;
    const e = addEnemy('mortar', M.x, M.y);
    e.mod = { rng: .62, pow: .7, rof: 1.3 }; e.a82m = true; e.hp = Math.max(3, Math.round(e.hp * .8)); e.maxhp = e.hp;
    q.men = []; q.a82mor = null;
  }
}
// 一波结束（运输机都回去或被打下、全部落地）后再等 20 秒，整连编成战斗群
function a82Group(E8) {
  const L = E8.lift;
  if (!L || S.t - L.t < 5 || E8.ch.some(c => c.lift === L.id) || (S.eair && S.eair.fly.some(a => a.a82 && a.type === 'c17' && a.lift === L.id && !a.dead))) return;
  if (L.endT == null) { L.endT = S.t; return; }
  if (S.t - L.endT < 20) return;
  E8.lift = null; E8.done++;
  const p = ptByKey(L.key), us = L.us.filter(id => id != null && UNIT_MAP.get(id));
  if (!us.length && !L.vs.length) { log(`敌第 82 空降师空降失败${L.lost ? `，空中损失 ${L.lost} 人` : ''}`, 'good', null, 0, L.dz); return; }
  const G = bgNew('e', `82 师 504 团 1 营 A 连（加强）${E8.done > 1 ? ' ' + E8.done : ''}`, '连长', { us, vs: L.vs.slice(), rec: L.rec.slice(), ax: L.ap.x, ay: L.ap.y, key: L.key, ech: 'I',
    face: p ? Math.atan2(p.y - L.ap.y, p.x - L.ap.x) : Math.PI / 2, a82: true, agg: 1, ret: .9, asmT: 120 });
  for (const id of L.rec) { const q = S.teams.find(o => o.id === id); const u = q && UNIT_MAP.get(q.u); if (u) u.bgId = G.id; }
  if (typeof a101Aim === 'function') a101Aim(G, true);
  if (spotted(L.ap.x, L.ap.y) || inVision(L.ap.x, L.ap.y)) log(`敌第 82 空降师在空降场集合完毕（${L.land} 个组、${L.veh} 辆车、${L.guns} 门火炮），开始向${p ? p.name : '前沿'}运动`, 'bad', null, 0, L.ap);
}

// —— CH-47F 吊运 M777A2：北图边进场 → 炮位上空减速悬停 → 放下火炮、松钩 → 让开 70 米落地卸炮班 → 北返 ——
const A82_CH = { cruise: 57, app: 600, hookH: 6, land: 1.06, gnd: 25 };   // 吊挂巡航约 110 节；放炮时降到机身中线离地约 6 米（炮落地、吊索松下来）；land：落地时机身中线高度（让机轮正好着地）；落地卸载 25 秒
function a82Chinook(L) {
  const E8 = a82Ensure(), p = ptByKey(L.key), gp = p && a82GunPos(p, L.dz);
  E8.gkey = L.key;
  if (!gp || typeof eaEnsure !== 'function') return;
  const E = eaEnsure();
  for (let k = 0; k < 2; k++) {
    const gx = gp.x + (k ? 45 : -45), gy = gp.y + (k ? 20 : -20);
    E.fly.push({ id: S.nid++, type: 'ch47', a82: true, k, x: clamp(gx + (k ? 80 : -80), 30, W - 30), y: -300 - k * 450, heading: Math.PI / 2, spd: A82_CH.cruise, alt: a82Alt(45), bank: 0,
      hp: EA_SPEC.ch47.hp, flares: EA_SPEC.ch47.flares, ph: 'in', gx, gy, load: 'm777', crew: 8, t: S.t, pv: false });
  }
  for (let k = 0; k < 2; k++) {   // 随队 AH-64E 两架：先到炮位一带警戒
    const h = EA_SPEC.heli;
    E.fly.push({ id: S.nid++, wid: null, type: 'heli', base: null, spd: h.spd, bank: 0, x: clamp(gp.x + (k ? 300 : -300), 20, W - 20), y: -100 - k * 80, heading: Math.PI / 2, alt: .3, ph: 'out', tx: gp.x, ty: gp.y + 600,
      tgt: { k: 'pt' }, flares: h.flares, hp: h.hp, t: S.t, pv: false, ammo: 1, atgm: 4, rk: 3, slot: k, esc82: true });
  }
  E8.chT = S.t;
}
function a82Heli(a, dt) {
  const E8 = a82Ensure(), C = A82_CH, d = dist(a.x, a.y, a.gx, a.gy);
  if (a.ph === 'rtb') a.ph = a.load && d > 900 ? 'abort' : a.load ? 'app' : 'out';   // 中弹：离炮位还远就带着炮回去
  const alt = m => { const k = a82AirH(), d = (a82Alt(m) - a.alt) * k; a.alt += clamp(d * Math.min(1, dt * 1.2), -6 * dt, 7.6 * dt) / k; };   // 升降最快约 7.6 米/秒（CH-47F 爬升约 1500 英尺/分），下降 6 米/秒
  if (a.ph === 'in') {
    eaSteer(a, a.gx, a.gy, dt, C.cruise); alt(45);
    if (d < C.app) a.ph = 'app';
    return;
  }
  if (a.ph === 'app') {   // 进近：边减速边下降，对准放炮点悬停
    const sp = clamp(d * .12, 0, C.cruise);
    if (d > 6) eaSteer(a, a.gx, a.gy, dt, sp); else { a.spd = Math.max(0, a.spd - 8 * dt); a.x += (a.gx - a.x) * Math.min(1, dt); a.y += (a.gy - a.y) * Math.min(1, dt); }
    alt(d > 120 ? 40 : C.hookH + 6);
    if (d < 8 && a.spd < 3) { a.ph = 'set'; a.pT = S.t; }
    return;
  }
  if (a.ph === 'set') {   // 慢慢放低，火炮着地后松钩
    a.spd = 0; alt(C.hookH);
    if (S.t - a.pT > 6) {
      a.load = null; a.ph = 'clear'; a.pT = S.t;
      const p = E8.gkey ? ptByKey(E8.gkey) : null, face = p ? Math.atan2(p.y - a.gy, p.x - a.gx) : Math.PI / 2;
      E8.cx.push({ x: a.gx, y: a.gy, h: a.heading, face, t: S.t, by: a.id });
      a.lx = a.gx + Math.cos(a.heading + Math.PI / 2) * 70; a.ly = a.gy + Math.sin(a.heading + Math.PI / 2) * 70;
    }
    return;
  }
  if (a.ph === 'clear') {   // 让开放炮点，落地卸炮班与弹药（A-22 弹药袋）
    const dl = dist(a.x, a.y, a.lx, a.ly);
    if (dl > 4) eaSteer(a, a.lx, a.ly, dt, clamp(dl * .3, 2, 12)); else a.spd = 0;
    alt(dl > 25 ? 14 : C.land);
    if (dl < 6 && a.alt < a82Alt(C.land + .4)) { a.ph = 'gnd82'; a.pT = S.t; }
    return;
  }
  if (a.ph === 'gnd82') { a.spd = 0; a.alt = a82Alt(C.land); if (S.t - a.pT > C.gnd) { a.ph = 'out'; a.crew = 0; } return; }
  // 返航（abort：带着炮）：爬升、往北出图
  alt(60); eaSteer(a, a.x, -800, dt, EA_SPEC.ch47.spd);
  if (a.y < -250) { a.dead = true; a.home = true; }
}
// 放下的 M777A2：炮班 2 分钟架好（大架张开、驻锄入土、身管放平到射角），之后是守方榴弹炮阵地
function a82Guns() {
  const E8 = a82Ensure();
  for (const g of E8.cx) {
    if (g.done || S.t - g.t < A82.gunSet) continue;
    g.done = true;
    const e = addEnemy('arty', g.x, g.y);
    e.a82g = 'm777'; e.th = g.face; e.cd = 5 + Math.random() * 5;
    if (spotted(g.x, g.y) || inVision(g.x, g.y)) log('敌 M777A2 榴弹炮在 CH-47F 吊运来的新阵地上开始射击', 'bad', null, 0, g);
  }
}
// 被打下的 82 师飞机（eair.js eaLost 把 a.dead 置真）：机上还没投的人员、装备、吊着的炮一起损失
function a82Losses() {
  const E8 = a82Ensure();
  for (const a of (S.eair && S.eair.fly) || []) {
    if (!a.a82 || !a.dead || a.home || a.lostSaid) continue;
    a.lostSaid = true;
    const n = (a.sq82 || []).reduce((s, k) => s + A82_T[k.split(':')[0]].men.length, 0), nv = (a.veh82 || []).length, gun = a.load ? 1 : 0, crew = a.crew || 0;
    if (!n && !nv && !gun && !crew) continue;
    if (E8.lift) E8.lift.lost += n;
    S.stats.killed += n + crew;
    const what = [n && `${n} 名伞兵`, nv && `${nv} 个重装平台`, gun && '吊着的 M777A2 榴弹炮', crew && `${crew} 名炮班成员`].filter(Boolean).join('、');
    log(`敌${a.type === 'ch47' ? ' CH-47F' : ' C-17'}被击落，机上${what}全部损失`, 'good', null, 0, { x: a.x, y: a.y });
  }
}

// —— 标枪：发射、飞行（软发射 → 主发动机 → 攻顶：爬升到约 160 米再俯冲）、命中 ——
function a82JavThink() {
  const E8 = a82Ensure();
  for (const q of S.teams) {
    if (!q.a82 || !(q.jav > 0) || !q.men.length || q.ride || (q.javCd || 0) > S.t || q.sup > 75) continue;
    if (S.t - (q.movedT ?? -99) < 3) { q.javLk = null; continue; }   // 走动中不能锁定
    let best = null, bs = -1e9;
    for (const v of S.veh || []) {
      if (v.side !== 'p' || v.dead || v.lst || v.swim || !isLand(v.x, v.y)) continue;
      const d = dist(q.x, q.y, v.x, v.y);
      if (d > A82.javR || d < A82.javMin) continue;
      if (!spotted(v.x, v.y) && !(typeof spotLos === 'function' && spotLos(q.x, q.y, .15, v.x, v.y, .24, S.t - (v.fireT ?? -99) < 3))) continue;   // 本方看见了，或者 CLU 的热像自己看得见（要通视）
      if (E8.jv.some(m => m.tid === v.id && !m.done)) continue;   // 已经有一发在路上
      const s = (BG_TANK.includes(v.type) ? 3 : v.armor >= 2 ? 2 : 1) - d / A82.javR;
      if (s > bs) { bs = s; best = v; }
    }
    if (!best) { q.javLk = null; continue; }
    if (!q.javLk || q.javLk.id !== best.id) { q.javLk = { id: best.id, t: S.t }; continue; }   // 导引头锁定目标的热像
    if (S.t - q.javLk.t < A82.javLock) continue;
    a82JavFire(q, best);
  }
}
function a82JavFire(q, v) {
  const E8 = a82Ensure(), d = dist(q.x, q.y, v.x, v.y), hd = Math.atan2(v.y - q.y, v.x - q.x), top = d > 150;   // 150 米以内只能用直接攻击模式（弹道低）
  q.jav--; q.javCd = S.t + A82.javRe; q.javLk = null; q.fireT = S.t;
  E8.jv.push({ id: S.nid++, x: q.x + Math.cos(hd) * 2, y: q.y + Math.sin(hd) * 2, h: 1.6, hd, pt: .3, spd: 25, t: 0, tid: v.id, x0: q.x, y0: q.y, D0: d, top, apex: top ? Math.min(A82.javTop, 60 + d * .06) : Math.min(60, 20 + d * .1), tr: [] });
  if (inVision(q.x, q.y)) log(`敌标枪反坦克导弹从${typeof cmdWhere === 'function' ? cmdWhere(q.x, q.y) : gridRef(q.x, q.y)}发射，攻击我${vehName(v)}`, 'warn', 'jav' + v.id, 6, { x: q.x, y: q.y });
}
function a82JavFly(dt) {
  const E8 = a82Ensure();
  for (const m of E8.jv) {
    if (m.done) continue;
    m.t += dt;
    const v = (S.veh || []).find(o => o.id === m.tid), tx = v && !v.dead ? v.x : m.tx ?? m.x, ty = v && !v.dead ? v.y : m.ty ?? m.y;
    m.tx = tx; m.ty = ty;
    // 速度：出筒 25 米/秒，0.3 秒后主发动机点火，约 1.7 秒加速到 160 米/秒
    m.spd = m.t < .3 ? 25 : Math.min(A82.javSpd, 25 + (m.t - .3) * 80);
    const r = dist(m.x, m.y, tx, ty), th = 2.2;   // 目标高度（车顶）
    // 俯仰：爬升段朝攻顶高度爬（最大 35°），离目标 h / tan(55°) 以内转入俯冲，直指目标
    let want;
    if (m.t < .3) want = .3;
    else if (r > (m.h - th) / Math.tan(.96) + 60) want = clamp(Math.atan2(m.apex - m.h, Math.max(60, r * .3)), -.25, .6);
    else want = -Math.atan2(m.h - th, Math.max(1, r));
    m.pt += clamp(want - m.pt, -1.8 * dt, 1.8 * dt);
    const dh = Math.atan2(Math.sin(Math.atan2(ty - m.y, tx - m.x) - m.hd), Math.cos(Math.atan2(ty - m.y, tx - m.x) - m.hd));
    m.hd += clamp(dh, -1.6 * dt, 1.6 * dt);
    const st = m.spd * dt, ch = Math.cos(m.pt);
    m.x += Math.cos(m.hd) * ch * st; m.y += Math.sin(m.hd) * ch * st; m.h += Math.sin(m.pt) * st;
    if (m.t > .3 && (m.tr.length === 0 || m.t - m.tr[m.tr.length - 1][3] > .12)) { m.tr.push([m.x, m.y, m.h, m.t]); if (m.tr.length > 140) m.tr.shift(); }
    const hit = v && !v.dead && Math.hypot(r, m.h - th) < Math.max(5, st * 1.2);   // 末段红外成像导引头咬住车体
    if (hit || m.h <= .3 || m.t > 28) {
      m.done = true; m.doneT = S.t;
      if (hit) {
        impact(tx, ty, { men: .4, ship: 1, struct: 0, seg: false, R: 10, vb: 2, veh: true }, 'e');
        vehDamage(v, 46, 3.6, m.x0, m.y0, 'top');   // 串联破甲战斗部打车顶（顶甲最薄）：中型坦克一发报废，重型坦克要两发
        S.fx.push({ kind: 'boom', x: tx, y: ty, r: 12, life: 0, max: .9, side: 'e' });
      } else S.fx.push({ kind: 'flash', x: m.x, y: m.y, r: 6, life: 0, max: .4, side: 'e' });
    }
  }
  if (E8.jv.length && E8.jv.every(m => m.done && S.t - m.doneT > 8)) E8.jv = [];
  else if (E8.jv.length > 40) E8.jv = E8.jv.filter(m => !m.done || S.t - m.doneT < 8);
}

function a82Step(dt) {
  if (!S || S.phase !== 'battle' || S.over || !(typeof eaOn === 'function' && eaOn())) return;
  const E8 = a82Ensure();
  if (E8.ch.length) a82Chutes(dt);
  if (E8.jv.length) a82JavFly(dt);
  if ((E8.thT = (E8.thT ?? 1) - dt) > 0) return;
  E8.thT = 1;
  const L = E8.lift;
  if (E8.chq && S.t >= E8.chq.at) { const Q = E8.chq; E8.chq = null; a82Chinook(Q); }
  a82Group(E8); a82Mortars(); a82Guns(); a82Losses(); a82JavThink();
  for (const G of S.bgs || []) if (G.a82 && !G.dead && typeof a101Aim === 'function') a101Aim(G);
  a82Think();
}

// —— 平面画面：下降中的伞（敌方红色）、重装平台、标枪导弹、吊着的火炮、正在架设的火炮 ——
function a82Draw() {
  const E8 = S && S.e82;
  if (!E8 || typeof R !== 'object' || !R.ctx) return;
  const ctx = R.ctx, r = Math.max(4, px(5));
  for (const c of E8.ch) {
    if (!inView(c.x, c.y, 60)) continue;
    const big = c.k === 'veh', y = c.y - c.z * .16, x = c.x;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(c.x, c.y, r * (big ? 1.6 : .9), r * (big ? .8 : .45), 0, 0, 7); ctx.fill();
    if (R.fx3d) continue;
    ctx.fillStyle = 'rgba(16,4,6,.85)'; ctx.strokeStyle = rgba(COL.enemy, .95); ctx.lineWidth = px(1.2);
    for (const o of big ? [-1, 0, 1] : [0]) { ctx.beginPath(); ctx.arc(x + o * r * 1.8, y - r * (big ? 2.4 : 1.6), r * (big ? 1.2 : 1), Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x + o * r * 1.8 - r, y - r * (big ? 2.4 : 1.6)); ctx.lineTo(x, y); ctx.lineTo(x + o * r * 1.8 + r, y - r * (big ? 2.4 : 1.6)); ctx.stroke(); }
    ctx.fillStyle = rgba(COL.enemy, .95);
    if (big) ctx.fillRect(x - r * .9, y - r * .3, r * 1.8, r * .9); else { ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, px(2)), 0, 7); ctx.fill(); }
  }
  if (R.fx3d) return;   // 3D 里标枪、吊挂的火炮立体画（v3a82.js）
  for (const m of E8.jv) {
    if (m.done || !inView(m.x, m.y, 60) || !(inVision(m.x, m.y) || (typeof specAll === 'function' && specAll()))) continue;
    ctx.strokeStyle = 'rgba(220,220,214,.55)'; ctx.lineWidth = px(1.4); ctx.beginPath();
    m.tr.forEach((p, i) => { const y = p[1] - p[2] * .16; if (i) ctx.lineTo(p[0], y); else ctx.moveTo(p[0], y); });
    ctx.lineTo(m.x, m.y - m.h * .16); ctx.stroke();
    ctx.fillStyle = '#ffd27a'; ctx.beginPath(); ctx.arc(m.x, m.y - m.h * .16, Math.max(1.6, px(2.2)), 0, 7); ctx.fill();
  }
  for (const a of (S.eair && S.eair.fly) || []) if (a.a82 && a.type === 'ch47' && a.load && !a.dead && inView(a.x, a.y, 60) && (inVision(a.x, a.y) || a.pv)) {
    ctx.strokeStyle = rgba(COL.enemy, .8); ctx.lineWidth = px(1); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x, a.y + r * 2); ctx.stroke();
    ctx.fillStyle = rgba(COL.enemy, .9); ctx.fillRect(a.x - r, a.y + r * 2, r * 2, r * .7);
  }
}

// 沙盒目录：守方「第 82 空降师 · 联合强行进入」（每买一份多一波）
if (typeof ctE === 'function' && typeof CATALOG_MAP === 'object' && !CATALOG_MAP.has('e_82')) {
  ctE('e_82', '第 82 空降师 · C-17 联合强行进入', 'e', 'support', 'asset', 1500, (typeof CT_IC === 'object' && CT_IC.c17) || '', [8, 1, 8, 8, 9, 8, 139],
    '美军全球快速反应部队。5 架 C-17A 低空（800 英尺）伞降一个加强伞兵连：139 人，连部、3 个步枪排（M4A1 卡宾枪、M249 班用机枪、M110 精确射手步枪、M240B 机枪、FGM-148 标枪反坦克导弹）、2 门 M224A1 60 毫米迫击炮、毒刺防空组、营狙击组；' +
    '第 5 架重装空投 2 辆 JLTV 重型火力车（M2HB）与 2 门 M119A3 105 毫米榴弹炮。伞降约 150 秒后 2 架 CH-47F 各吊一门 M777A2 155 毫米榴弹炮到后方炮位，2 架 AH-64E 随队。' +
    '运输机、直升机和下降中的伞兵都会挨我方防空火力；空降场选在离我军 900 米以外、已知防空 1.5 公里以外的平地上，落地集合后整连攻击受威胁的据点或反冲击。',
    { kind: 'asset', at: 'none', key: 'e82', add: 1 }, { counters: ['p_para', 'inf_p', 'veh'], weakTo: ['p_manpads', 'p_aa_veh', 'p_air_ftr'] });
  const c = CATALOG.find(o => o.id === 'e_82');
  if (c) CATALOG_MAP.set('e_82', c);
}

HOOK.step.push(a82Step);
HOOK.drawOver.push(a82Draw);
HOOK.newGame.push(() => { if (S) S.e82 = null; });
