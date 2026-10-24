'use strict';
// 航空母舰与舰载机联队：甲板弹射起飞、侦察 / 空袭 / 对地支援三种任务、防空火力、舰尾进近着舰与整备；
// 航母机动与受损（岸防炮可打）；绘制航母、甲板停机、飞机剪影（无文字）
// 任务类型（每种任务默认用哪个型号见 AIR_BASEM，变体见 AIR_VMODEL）；n = 战役默认架数
const AIR_SPEC = {
  recon: { name: '侦察机', n: 2, aa: .06, spd: 190, size: 17 },
  strike: { name: '攻击机', n: 4, aa: .09, spd: 180, size: 15 },
  cas: { name: '对地支援机', n: 4, aa: .09, spd: 170, size: 15 },
  bomber: { name: '轰炸机', n: 0, aa: .07, spd: 150, size: 22 },   // 沙盒购买：轰-6K（地毯轰炸）/ 攻击-11（俯冲精确投弹）
  fighter: { name: '战斗机', n: 2, aa: .05, spd: 230, size: 15 }   // 制空（airwar.js）：在指定空域巡逻，拦截敌机、夺取制空权
};
// 型号：名称、剪影、巡航速度、被高炮打中的基础概率、画面尺寸；land = 陆基（战区机场出动，从地图南缘飞来，不占航母机位，往返加油挂弹 100 秒）；
// stealth = 隐身（敌雷达发现距离、防空命中按此打折）；std = 防区外投放距离（精确制导炸弹 / 反辐射导弹）；aam / aamR / pkK = 空空导弹数、射程、命中修正；loiter = 盘旋秒数
const AIR_MDL = {
  kj600: { name: '空警-600 舰载预警机', sil: 'kj600', spd: 175, aa: .06, size: 19 },
  wz7: { name: '无侦-7 高空无人侦察机', sil: 'wz7', spd: 175, aa: .02, size: 19, land: true },   // 两万米高空，高炮够不着
  j35: { name: '歼-35 隐身舰载战斗机', sil: 'j35', spd: 240, aa: .09, size: 15, stealth: .4, std: 170 },   // 内埋精确制导炸弹，防区外投放
  j35s: { name: '歼-35 隐身舰载战斗机（防空压制型）', sil: 'j35', spd: 240, aa: .09, size: 15, stealth: .4, std: 300, sead: true },   // 反辐射导弹，专打敌防空
  j15t: { name: '歼-15T 舰载战斗机', sil: 'j15', spd: 225, aa: .09, size: 16, agm: 'kd88', agmN: 2, agmR: 380 },   // 2 枚 KD-88 空地导弹（防区外）
  gj11: { name: '攻击-11 隐身无人攻击机', sil: 'gj11', spd: 200, aa: .08, size: 16, stealth: .5 },
  h6k: { name: '轰-6K 轰炸机', sil: 'h6k', spd: 165, aa: .07, size: 24, land: true },
  gj2: { name: '攻击-2 察打一体无人机', sil: 'gj2', spd: 140, aa: .09, size: 17, land: true, loiter: 60, agm: 'ba7', agmN: 4, agmR: 320 },   // 长航时：盘旋 60 秒；4 枚蓝箭-7 空地导弹
  z10: { name: '直-10 武装直升机', sil: 'heli', spd: 110, aa: .09, size: 15, agm: 'hj10', agmN: 8, agmR: 280 },   // 8 枚红箭-10 反坦克导弹
  j20: { name: '歼-20 隐身战斗机', sil: 'j20', spd: 265, aa: .05, size: 17, land: true, stealth: .35, aam: 6, aamR: 560, pkK: 1.15 },   // 4 枚霹雳-15 + 2 枚霹雳-10
  // 彩蛋（j36.js）：歼-36。官方未公布参数，按公开估算：机长约 23 米、翼展约 19 米、最大起飞重量约 55 吨（歼-20 约 37 吨）、三发、主弹舱长约 7.6 米、作战半径约 3000 公里；
  //   体型大、无尾 → 转弯慢（turn）、不带航炮；全向隐身更好、机头大雷达看得更远（radar）、留空时间长（cap 秒）。挂载按弹舱尺寸推测：aamL / aamLR = 霹雳-17 远程空空导弹
  j36: { name: '歼-36 第六代战斗机（制空型）', sil: 'j36', spd: 300, aa: .02, size: 18, land: true, stealth: .2, aam: 6, aamR: 560, aamL: 2, aamLR: 900, pkK: 1.2, radar: 900, turn: 1.7, cap: 240, gun: 0 },
  j36s: { name: '歼-36 第六代战斗机（打击型）', sil: 'j36', spd: 300, aa: .02, size: 18, land: true, stealth: .2, aam: 4, aamR: 560, pkK: 1.2, radar: 900, turn: 1.7, cap: 240, gun: 0, agm: 'ls6', agmN: 4, agmR: 900 }
};
const AIR_BASEM = { recon: 'kj600', strike: 'j35', cas: 'gj2', bomber: 'h6k', fighter: 'j20' };
const AIR_VMODEL = { lr: 'wz7', dive: 'gj11', heavy: 'h6k', fb: 'j15t', heli: 'z10', sead: 'j35s', adv: 'j20', j36: 'j36', j36s: 'j36s' };   // adv：旧存档里的先进战斗机
const airMdlKey = (type, v) => AIR_VMODEL[v] || AIR_BASEM[type];
const airMdl = (type, v) => AIR_MDL[airMdlKey(type, v)] || {};   // 运输机（para.js）等没有型号表的返回空
const airSpec = (type, v) => ({ ...(AIR_SPEC[type] || AIR_SPEC.strike), ...airMdl(type, v) });
const airLandW = w => !!(w && airMdl(w.type, w.v).land);
const airStealth = o => (o && airMdl(o.kind || o.type, o.v).stealth) || 1;   // 飞机（p.kind）或编队记录（w.type）
const AIR_REARM_LAND = 100;   // 陆基飞机：飞回战区机场加油挂弹再飞回来
const AIR_TYPES = ['recon', 'strike', 'cas', 'bomber', 'fighter'];
const AIR_TURN = 1.5;      // 最大转弯角速度（弧度/秒）：巡航转弯半径约 120
const AIR_REARM = 45;      // 着舰后整备时间（秒）
const AIR_TRAILS = new Map();   // 仅渲染用：飞机尾迹点（不进 S）
const CV_LEN = 150;
// 航母局部坐标：u 指向舰首，v 指向右舷（绘制时 rotate(heading) 后 x = u、y = v）
const CVG = {
  deck: [[77, 0], [70, 7], [46, 14], [-20, 15], [-74, 13], [-77, 8], [-77, -8], [-70, -12], [-30, -15], [20, -18], [34, -14], [60, -9]],
  cats: [[8, -3, 76], [8, 4, 76]],              // 舰首两条弹射器：起点 u、v、离舰 u
  land: { u0: -70, v0: 2, u1: 24, v1: -14 },     // 斜角着舰区中线（舰尾 → 左舷前方）
  td: .15,                                        // 接地点在着舰中线上的位置
  // 停机位 [u, v, 机头相对舰首的角度]：侦察 2、攻击 4、对地支援 4、战斗机 2
  slots: [[50, -9.5, 2.2], [41, -10.5, 2.2], [56, 9, -2.2], [47, 10.5, -2.2], [38, 11.5, -2.2], [29, 12, -2.2],
    [-10, 11, -2.2], [-20, 11, -2.2], [-30, 11, -2.2], [-40, 11, -2.2], [-50, 11, -2.2], [-60, 10.5, -2.2]],
  fires: [[-30, 5], [12, -9], [44, 4], [-58, -4]]
};
const CV_LLEN = Math.hypot(CVG.land.u1 - CVG.land.u0, CVG.land.v1 - CVG.land.v0);
const CV_LANG = Math.atan2(CVG.land.v1 - CVG.land.v0, CVG.land.u1 - CVG.land.u0);
// 飞机俯视剪影（半边轮廓，机头 +x，长、翼展均约 21；按真实机型的平面形状）
const AIR_SIL = {
  kj600: [[10, 0], [8.4, 1.2], [3, 1.4], [2.4, 10.5], [-.6, 10.5], [-1.2, 1.4], [-7, 1.1], [-7.8, 4.6], [-9.6, 4.6], [-9.4, .8], [-10, 0]],   // 上单翼双发涡桨 + 背负雷达圆盘
  wz7: [[9, 0], [7.4, 1], [3, 1.2], [-4.6, 9.8], [-5.8, 9.6], [-8.4, 2.4], [-10, 1], [-10.5, 0]],   // 菱形连翼（前翼后掠、后翼前掠在翼尖相接）
  j35: [[11, 0], [8.4, 1], [4, 1.7], [.8, 2.1], [-3.2, 7.6], [-5.2, 7.6], [-5.2, 2.6], [-7, 2.4], [-9.2, 5], [-10.6, 5], [-10.2, 1.6], [-11, 0]],   // 梯形翼 + 平尾，双发双垂尾
  j15: [[11.5, 0], [9, 1], [5, 1.4], [3, 2.7], [.2, 3], [-4, 9.2], [-5.6, 9.2], [-5, 3], [-7, 3], [-9.6, 6.6], [-11.2, 6.6], [-10.6, 2.4], [-11.6, 1.8], [-11.6, 0]],   // 侧卫系：大边条、后掠翼、双发
  j20: [[11.5, 0], [9.4, .8], [6.4, 1.3], [5.2, 1.4], [3.4, 4.4], [2.6, 4.4], [2.8, 1.6], [1.4, 1.8], [-6, 8.6], [-7.6, 8.6], [-6.6, 2.2], [-8.6, 2], [-10.8, 1.6], [-11.4, 0]],   // 鸭翼 + 三角翼，长机身
  gj11: [[8, 0], [5, 2], [-3, 10.5], [-5, 10.5], [-5.6, 8], [-3.6, 6], [-7, 3.4], [-9, 0]],   // 飞翼，W 形后缘
  gj2: [[9, 0], [8, .9], [1.6, 1], [1.1, 10.5], [-.8, 10.5], [-1.2, 1], [-7, .7], [-9.6, 3.6], [-10.6, 3.6], [-9.2, .5], [-10, 0]],   // 细长机身、大展弦比直翼、V 形尾翼
  h6k: [[11.5, 0], [10, 1.2], [4, 1.6], [2.4, 2.9], [-1, 11.2], [-3.1, 11.2], [-2.6, 3], [-6, 1.6], [-8.6, 4.6], [-10.2, 4.6], [-10, 1], [-11.5, 0]],   // 后掠中单翼，翼根两台发动机
  heli: [[8, 0], [7, 1.6], [3, 2.6], [-2, 2.4], [-4, 1], [-11, .6], [-12, 3], [-13, 3], [-12.5, 0]],   // 武装直升机：机身 + 尾梁（旋翼另画）
  // 守方（美军）
  f35: [[10.4, 0], [8, 1], [3.6, 1.8], [.4, 2.2], [-3.6, 7.2], [-5.4, 7.2], [-5.6, 2.4], [-7, 2.3], [-9, 4.6], [-10.2, 4.6], [-9.6, 1.4], [-10.6, 0]],   // 单发，菱形梯形翼，双垂尾
  a10: [[10, 0], [8, 1], [3.2, 1.2], [2.6, 9.4], [-.6, 9.4], [-1.2, 1.4], [-7, 1.3], [-8.4, 4.8], [-10.4, 4.8], [-10, 1], [-10.6, 0]],   // 平直下单翼，尾部背负双发、双垂尾
  f22: [[10.6, 0], [8.2, .9], [4.6, 1.8], [2.6, 2.4], [1.6, 2.6], [-2.8, 7.4], [-4.6, 7.4], [-6.1, 2.8], [-6.6, 2.6], [-8.6, 5.4], [-9.8, 5.4], [-10.1, 1.6], [-10.6, 1.2], [-10.6, 0]],   // 菱形翼（后缘前掠）、全动平尾、二元矢量喷管
  // 彩蛋
  j36: [[12.6, 0], [10.6, .8], [8.2, 1.6], [5.6, 2.6], [1, 5.4], [-5.8, 10.3], [-7.4, 10.3], [-6.4, 6], [-10.6, 2.8], [-11.6, 2.2], [-12.2, 1.2], [-12.2, 0]]   // 歼-36：无尾双菱形翼（翼尖切尖、后缘 W 形），机长 : 翼展约 23 : 19，与歼-20 同一比例尺
};
// 剪影键：按型号；守方 type（ga / heli / ftr / f22）另映射
const airSilKey = (type, v) => type === 'ga' ? 'a10' : type === 'ftr' ? 'f35' : AIR_SIL[type] && !AIR_BASEM[type] ? type : airMdl(type, v).sil || 'j35';
const airName = (type, v) => airMdl(type, v).name || (AIR_SPEC[type] || {}).name || '飞机';
// HUD 图标（24×24，描边风格，与 hud.js ICON 一致）
const CARRIER_ICONS = typeof WI === 'object' ? {   // 照真实机型画（icons.js）：福建舰、空警-600、歼-35、攻击-2、轰-6K、歼-20
  cv: WI.t003, recon: WI.kj600, strike: WI.j35, cas: WI.gj2, bomber: WI.h6k, fighter: WI.j20,
  airauto: '<path d="M12 5l1 3.5 5 4v1.5l-5-1.8-.3 3.3 1.8 1.3v1.2L12 17l-2.5 1v-1.2l1.8-1.3-.3-3.3-5 1.8v-1.5l5-4z"/><path d="M4.5 8.5A8.5 8.5 0 0 1 10 3.3M19.5 15.5A8.5 8.5 0 0 1 14 20.7"/>'
} : {};

const airAng = a => Math.atan2(Math.sin(a), Math.cos(a));
// 航母局部坐标 ↔ 世界坐标
function cvW(u, v, c) {
  c = c || S.cv;
  const ch = Math.cos(c.heading), sh = Math.sin(c.heading);
  return [c.x + ch * u - sh * v, c.y + sh * u + ch * v];
}
function cvL(x, y, c) {
  c = c || S.cv;
  const dx = x - c.x, dy = y - c.y, ch = Math.cos(c.heading), sh = Math.sin(c.heading);
  return [dx * ch + dy * sh, -dx * sh + dy * ch];
}
// 多艘航母（沙盒）：S.cv 为旗舰（母舰号 0），S.cvx 为其余航母（1..n）；舰载机与飞机以 home 记所属母舰
const cvHome = o => (o && o.home) || 0;
const cvOf = h => h ? (S.cvx && S.cvx[h - 1]) || null : S.cv;
const cvAll = () => [S.cv, ...(S.cvx || [])].filter(c => c && isFinite(c.x) && isFinite(c.y));
// 甲板停机位分配（只供绘制与甲板中弹用）：前 12 架各有固定机位；联队超过 12 架时其余待命 / 整备的飞机在机库，
// 甲板有空位就按顺序补上，补上后位置不再变。返回 Map(飞机 id → 机位序号)，wing = 这艘航母的全部舰载机
const CV_PARK = new WeakMap();
function cvPark(c, wing) {
  const n = CVG.slots.length, on = w => w.state === 'deck' || w.state === 'rearm', m = CV_PARK.get(c) || new Map();
  for (const id of [...m.keys()]) if (!wing.some(w => w.id === id && on(w))) m.delete(id);
  const used = new Set(m.values());
  wing.forEach((w, i) => { if (i < n && on(w) && !m.has(w.id) && !used.has(i)) { m.set(w.id, i); used.add(i); } });
  for (let j = 0, i = 0; j < n && i < wing.length; j++) {
    if (used.has(j)) continue;
    while (i < wing.length && (!on(wing[i]) || m.has(wing[i].id))) i++;
    if (i < wing.length) { m.set(wing[i].id, j); used.add(j); i++; }
  }
  CV_PARK.set(c, m);
  return m;
}
// 临时把 S.cv 换成某艘航母执行 fn：复用以 S.cv 为准的起降、受损与绘制代码
function withCV(c, fn) { const keep = S.cv; S.cv = c; try { return fn(); } finally { S.cv = keep; } }
// 从 (x,y) 沿角度 a 延伸 len，但不越出地图（保持方向不变）
function airRay(x, y, a, len, m = 30) {
  const dx = Math.cos(a), dy = Math.sin(a);
  let t = len;
  if (dx > 1e-6) t = Math.min(t, (W - m - x) / dx); else if (dx < -1e-6) t = Math.min(t, (m - x) / dx);
  if (dy > 1e-6) t = Math.min(t, (H - m - y) / dy); else if (dy < -1e-6) t = Math.min(t, (m - y) / dy);
  t = Math.max(0, t);
  return [x + dx * t, y + dy * t];
}

// —— 状态初始化：newGame 部署舰队后调用；从快照恢复时也可重复调用（只补缺） ——
function initCarrier() {
  if (!S) return;
  if (!S.cv || !isFinite(S.cv.x) || !isFinite(S.cv.y))
    S.cv = { x: W / 2, y: CARRIER_Y, tx: W / 2, ty: CARRIER_Y, heading: -Math.PI / 2, hp: 30, maxhp: 30, moving: false };
  const c = S.cv;
  if (!isFinite(c.heading)) c.heading = -Math.PI / 2;
  if (!isFinite(c.tx) || !isFinite(c.ty)) { c.tx = c.x; c.ty = c.y; c.moving = false; }
  if (!isFinite(c.maxhp) || c.maxhp <= 0) c.maxhp = 30;
  if (!isFinite(c.hp)) c.hp = c.maxhp;
  if (!Array.isArray(c.cat) || c.cat.length !== 2) c.cat = [0, 0];
  if (c.exposedUntil == null) c.exposedUntil = 0;
  if (c.hitT == null) c.hitT = -99;
  if (c.auto == null) c.auto = false;
  if (c.autoT == null) c.autoT = 2;
  if (Array.isArray(S.cvx)) S.cvx.forEach((x, i) => {   // 其余航母：补齐字段
    x.home = i + 1;
    if (!isFinite(x.heading)) x.heading = -Math.PI / 2;
    if (!isFinite(x.tx) || !isFinite(x.ty)) { x.tx = x.x; x.ty = x.y; x.moving = false; }
    if (!isFinite(x.maxhp) || x.maxhp <= 0) x.maxhp = 30;
    if (!isFinite(x.hp)) x.hp = x.maxhp;
    if (!Array.isArray(x.cat) || x.cat.length !== 2) x.cat = [0, 0];
    if (x.exposedUntil == null) x.exposedUntil = 0;
    if (x.hitT == null) x.hitT = -99;
  });
  if (!S.air || !Array.isArray(S.air.wing)) {
    const wing = [];
    for (const type of AIR_TYPES) for (let k = 0; k < AIR_SPEC[type].n; k++) wing.push({ id: S.nid++, type, state: 'deck', rearmT: 0 });
    S.air = { wing, wrecks: [] };
  }
  if (!Array.isArray(S.air.wrecks)) S.air.wrecks = [];
  if (!Array.isArray(S.planes)) S.planes = [];
  if (!Array.isArray(S.recon)) S.recon = [];
  if (!S.assets) S.assets = {};
  // 旧版存档里的飞机（没有 phase）：沿原任务飞完，返航后直接消失
  for (const p of S.planes) if (!p.phase) {
    const tx = isFinite(p.tx) ? p.tx : p.x, ty = isFinite(p.ty) ? p.ty : p.y;
    Object.assign(p, { phase: p.dropped ? 'rtb' : 'out', heading: -Math.PI / 2, spd: 180, alt: 1, bank: 0, wid: null, tx, ty, cx: tx, cy: ty,
      wp: p.kind === 'recon' ? [{ x: tx, y: ty }, { x: tx, y: 40 }] : [{ x: tx, y: ty }], leg: 0, aaT: 0, rt: 0, gunT: 0, strafeT: 1, loiterT: 40, rtbT: 0 });
    if (!AIR_SPEC[p.kind]) p.kind = 'strike';
  }
  airCount();
}

// HUD 读取：各机型可出击（在甲板待命）的架数
function airCount() {
  const up = w => w.af ? typeof abAfOpen === 'function' && abAfOpen() : airLandW(w) || (() => { const c = cvOf(cvHome(w)); return c && c.hp > 0; })();   // 陆基飞机不看航母；停在夺取的机场上的要跑道能用（abn.js）
  for (const t of AIR_TYPES) S.assets[t] = S.air ? S.air.wing.filter(w => w.type === t && w.state === 'deck' && up(w)).length : 0;
}

const airWing = p => p.wid != null && S.air ? S.air.wing.find(w => w.id === p.wid) : null;
const AIR_WSTATE = { cat: 'launch', roll: 'launch', out: 'out', loiter: 'out', rtb: 'return', hold: 'return', final: 'return', trap: 'return' };
function airSet(p, phase) {
  p.phase = phase;
  const w = airWing(p);
  if (w && w.state !== 'lost') w.state = AIR_WSTATE[phase] || w.state;
}

// —— 出击：kind = recon / strike / cas；从甲板待命的飞机中派出一架 ——
// pref：想要的变体（如 'sead' 防空压制型歼-35）；没有就用同任务的其他型号
function launchPlane(kind, tx, ty, pref) {
  if (!S.cv || !S.air) initCarrier();
  const sp = AIR_SPEC[kind];
  if (!sp || !isFinite(tx) || !isFinite(ty)) return false;
  const cvOk = cvAll().some(c => c.hp > 0);
  if (!cvOk && !S.air.wing.some(o => o.type === kind && o.state === 'deck' && airLandW(o))) { log('航母飞行甲板瘫痪，舰载机无法起飞', 'warn', 'cvdead', 2); return false; }
  // 多艘航母时：从离目标最近、且有该机型待命的那艘起飞；陆基飞机从战区机场（地图南缘以外）飞来，算作稍远
  const want = pref || (kind === 'bomber' ? (S.enemies.some(e => !e.dead && e.kx != null && dist(e.kx, e.ky, tx, ty) < 40) ? 'dive' : 'heavy') : null);
  let w = null, bd = Infinity;
  for (const o of S.air.wing) if (o.type === kind && o.state === 'deck') {
    const land = airLandW(o), c = land ? null : cvOf(cvHome(o)), af = o.af && S.abBase;
    if (!land && !(c && c.hp > 0)) continue;
    if (o.af && !(typeof abAfOpen === 'function' && abAfOpen())) continue;   // 停在夺取的机场上、跑道用不了的起不来
    const d = (af ? dist(af.x, af.y, tx, ty) : land ? H - ty + 300 : dist(c.x, c.y, tx, ty)) + (want && (o.v || (kind === 'bomber' ? 'heavy' : null)) !== want ? 1e4 : 0);
    if (d < bd) { bd = d; w = o; }
  }
  if (!w) {
    const left = S.air.wing.filter(w => w.type === kind && w.state !== 'lost'), r = left.filter(w => w.state === 'rearm').map(w => w.rearmT);
    log(!left.length ? `${sp.name}已全部损失` : r.length ? `${sp.name}均在出击或整备中（最快 ${Math.ceil(Math.min(...r))} 秒）` : `${sp.name}均已升空`, 'warn', 'air' + kind, 2);
    return false;
  }
  if (w.af && typeof abTakeoff === 'function') return abTakeoff(w, kind, tx, ty);   // 从夺取的机场起飞（abn.js）
  return airLandW(w) ? launchLand(w, kind, tx, ty) : withCV(cvOf(cvHome(w)), () => launchFrom(w, kind, sp, tx, ty));
}
// —— 编队出击（机群）：攻击机、对地支援机、轰炸机至少双机——长机打指定目标，僚机打附近另一个已标定目标（没有就同一目标补投 / 并肩压制）；
//    敌机在活动（敌方掌握或争夺制空权、近 2 分钟见过敌机）时，再派一架战斗机在目标上空护航。返回长机（连长机都派不出时为 false） ——
const AIR_PKG = { strike: 2, cas: 2, bomber: 2 };
const airReady = kind => S.air.wing.some(o => o.type === kind && o.state === 'deck' && (airLandW(o) || (cvOf(cvHome(o)) || { hp: 0 }).hp > 0));
function airWingTgt(kind, tx, ty) {
  if (kind === 'cas') return [tx + gauss() * 25, ty + gauss() * 25];
  const own = (x, y) => S.teams.some(q => q.side === 'p' && q.men.length && dist(q.x, q.y, x, y) < 90);
  const e = S.enemies.filter(e => !e.dead && e.kx != null && dist(e.kx, e.ky, tx, ty) > 25 && dist(e.kx, e.ky, tx, ty) < 140 && !own(e.kx, e.ky)
    && !S.planes.some(p => !p.dead && p.kind === kind && dist(p.tx, p.ty, e.kx, e.ky) < 30)).sort((a, b) => dist(a.kx, a.ky, tx, ty) - dist(b.kx, b.ky, tx, ty))[0];
  return e ? [e.kx, e.ky] : [tx, ty];
}
function airPkg(kind, tx, ty, pref) {
  const G = kind === 'bomber' ? airBomberGate(tx, ty, pref) : null;
  if (kind === 'bomber' && !G) return false;
  if (!launchPlane(kind, tx, ty, pref)) return false;
  const lead = S.planes[S.planes.length - 1], fl = [lead];
  lead.pkg = lead.id;
  while (fl.length < (AIR_PKG[kind] || 1) && airReady(kind)) {
    const [x, y] = airWingTgt(kind, tx, ty);
    if (!launchPlane(kind, x, y, pref)) break;
    const p = S.planes[S.planes.length - 1]; p.pkg = lead.id; fl.push(p);
  }
  if (kind === 'bomber') { airBomberGroup(lead, fl, tx, ty, G); return lead; }
  const A = S.airw, threat = A && (A.st === 'e' || A.st === 'c' || S.t - (A.seenE ?? -1e9) < 120);
  let esc = null;
  if (kind !== 'fighter' && kind !== 'recon' && threat && S.assets.fighter > 0 && airReady('fighter')
    && !S.planes.some(p => !p.dead && p.kind === 'fighter' && ['cat', 'roll', 'out', 'loiter'].includes(p.phase) && dist(p.cx, p.cy, tx, ty) < 300)
    && launchPlane('fighter', clamp(tx, 60, W - 60), clamp(ty, 60, H - 60))) {
    esc = S.planes[S.planes.length - 1]; esc.pkg = lead.id; esc.esc = true;
    if (airReady('fighter') && launchPlane('fighter', clamp(tx, 60, W - 60), clamp(ty, 60, H - 60))) Object.assign(S.planes[S.planes.length - 1], { pkg: lead.id, esc: true, odir: -1 });   // 护航也是双机，免得单机被敌双机围攻
  }
  if (fl.length > 1 || esc) {
    if (typeof v8Stat === 'function') v8Stat('pkg');
    const nm = airName(kind, lead.v), en = esc ? airName('fighter', esc.v).split(' ')[0] : '', ne = S.planes.filter(p => p.esc && p.pkg === lead.id).length;
    log(`${nm.split(' ')[0]} ${fl.length} 机编队出击${esc ? `，${en} ${ne} 架护航` : ''}`, 'info', 'airpkg', 4, { x: tx, y: ty });
    if (typeof chatSay === 'function') chatSay('p', `命令：${nm.split(' ')[0]}${fl.length > 1 ? '双机编队' : ''}出击${typeof cmdWhere === 'function' ? cmdWhere(tx, ty) : ''}${esc ? `，${en}${ne > 1 ? '双机' : '一架'}随队护航，先清空目标上空敌机` : ''}。`, { kind: 'order', at: { x: tx, y: ty }, key: 'airpkg', gap: 20, lv: 1 });
  }
  return lead;
}
// —— 轰炸机突击群（解放军体系作战：预警指挥 + 防空压制 + 制空护航 + 突击）：轰炸机一律不单独出动——
//    ① 先导扫荡：歼-20 双机先飞到目标与敌机场之间的空域，清除敌歼击机；
//    ② 防空压制：目标 320 以内有已知敌防空，先派歼-35 防空压制型打掉；
//    ③ 随队护航：一对战斗机贴着轰炸机长机飞（awFlyP 读 p.escOf），敌机逼近轰炸机就迎击；
//    ④ 轰炸机先在敌防空圈外的待机点盘旋，扫荡到位、防空压掉（最多等 45 秒）再进入投弹航路（airHoldP）；
//    空中有空警-600 时护航机发现距离更远（airwar.js awAew）。
//    没有能起飞的护航机：请求排队，等护航机整备（最多 60 秒，airBomberQueue）；全军没有战斗机：只在我方掌握制空权、或敌方没有歼击机时出动 ——
const airFtrUp = () => S.air.wing.filter(w => w.type === 'fighter' && w.state !== 'lost');
const airFtrDeck = () => S.air.wing.filter(w => w.type === 'fighter' && w.state === 'deck' && !(w.af && !(typeof abAfOpen === 'function' && abAfOpen())) && (airLandW(w) || (cvOf(cvHome(w)) || { hp: 0 }).hp > 0)).length;
// 在空、没在接敌、弹药够的巡逻战斗机（可改派去护航轰炸机）
const airFtrFree = () => S.planes.filter(p => !p.dead && p.kind === 'fighter' && (p.phase === 'loiter' || p.phase === 'out') && !p.tg && p.escOf == null && !p.sweep && (p.aam || 0) >= 2 && p.alt > .5);
const airEFtr = () => !!(S.eair && (S.eair.wing.some(w => (w.type === 'ftr' || w.type === 'f22') && w.state !== 'lost') || S.eair.fly.some(a => !a.dead && (a.type === 'ftr' || a.type === 'f22'))));
// 目标 r 以内已知的敌防空（高炮阵地、防空车、近 2 分钟暴露过的单兵防空）
function airAAKnown(x, y, r) {
  const out = [];
  for (const e of S.enemies) if (!e.dead && (e.kind === 'aa') && e.kx != null && dist(e.kx, e.ky, x, y) < r) out.push({ x: e.kx, y: e.ky, k: 'enemy', id: e.id });
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead && (v.type === 'aa_veh' || v.type === 'sam_veh') && (inVision(v.x, v.y) || (v.seen != null && S.t - v.seen < 60)) && dist(v.x, v.y, x, y) < r) out.push({ x: v.x, y: v.y, k: 'veh', id: v.id });
  if (typeof eaThreat === 'function' && eaThreat(x, y) >= 1) out.push({ x, y, k: 'manpads' });
  return out;
}
function airBomberGate(tx, ty, pref) {
  const say = (t, k) => { log(t, 'warn', 'bgate', 4, { x: tx, y: ty }); if (typeof chatSay === 'function') chatSay('p', t, { kind: 'report', at: { x: tx, y: ty }, key: 'bgate' + k, gap: 40, lv: 1 }); };
  if (!airFtrUp().length) {
    const A = S.airw;
    if (airEFtr() && !(A && A.st === 'p')) { say('轰炸机没有战斗机护航，敌歼击机仍在、我方未掌握制空权——轰炸机暂不出动，改由舰炮、导弹打击。', 'n'); return null; }
    return { noEsc: true };
  }
  if (airFtrDeck() || airFtrFree().length) { S.air.bq = null; return { noEsc: false }; }
  const Q = S.air.bq;
  if (Q && S.t - Q.t > 60) { S.air.bq = null; return { noEsc: true, late: true }; }   // 等了一分钟：不再等，轰炸机按防区外方式出动
  if (!Q) {
    S.air.bq = { x: tx, y: ty, pref, t: S.t };
    const r = S.air.wing.filter(w => w.type === 'fighter' && w.state === 'rearm').map(w => w.rearmT);
    say(`轰炸机等护航战斗机一起出动（护航机整备中${r.length ? `，最快 ${Math.ceil(Math.min(...r))} 秒` : ''}）；最多等 60 秒。`, 'w');
  }
  return null;
}
// 排队的轰炸任务：每秒看一次护航机好了没有
function airBomberQueue(dt) {
  if (!S || S.phase !== 'battle' || S.over || !S.air || !S.air.bq) return;
  if ((S.air.bqT = (S.air.bqT || 0) - dt) > 0) return;
  S.air.bqT = 1;
  const Q = S.air.bq;
  if (!(S.assets.bomber > 0) || !airReady('bomber')) { S.air.bq = null; return; }
  if (airFtrDeck() || airFtrFree().length || S.t - Q.t > 60) airPkg('bomber', Q.x, Q.y, Q.pref);
}
function airBomberGroup(lead, fl, tx, ty, G) {
  const pk = lead.id, said = [];
  let nSw = 0, nEsc = 0, nSd = 0;
  const tag = (o, ex) => Object.assign(o, { pkg: pk }, ex);
  if (!G.noEsc) {
    const nf = airFtrDeck(), eF = airEFtr();
    // 先导扫荡：有三架以上待命、或敌有歼击机且有两架以上待命时，先派双机去目标与敌机场之间
    if (eF && nf >= 3 || nf >= 4) {
      const af = S.enemies.filter(e => e.kind === 'airfield' && !e.dead && e.kx != null).sort((a, b) => dist(a.kx, a.ky, tx, ty) - dist(b.kx, b.ky, tx, ty))[0];
      let sx = tx, sy = ty - 160;
      if (af) { const d = Math.max(1, dist(tx, ty, af.kx, af.ky)), k = Math.min(300, d * .45) / d; sx = tx + (af.kx - tx) * k; sy = ty + (af.ky - ty) * k; }
      sx = clamp(sx, 60, W - 60); sy = clamp(sy, 60, H - 60);
      for (let i = 0; i < 2 && airFtrDeck() > 2 - i - (nf >= 4 ? 0 : 1); i++) if (launchPlane('fighter', sx, sy)) { tag(S.planes[S.planes.length - 1], { sweep: true, esc: true, odir: i ? -1 : 1, capT: 75 }); nSw++; }
    }
    // 随队护航：一对战斗机贴着轰炸机长机；甲板上没有就把在空巡逻、没接敌的战斗机改派过来
    for (let i = 0; i < 2 && airFtrDeck(); i++) if (launchPlane('fighter', clamp(tx, 60, W - 60), clamp(ty, 60, H - 60))) { tag(S.planes[S.planes.length - 1], { esc: true, escOf: pk, slot: i + 1, odir: i ? -1 : 1, capT: 45 }); nEsc++; }
    if (nEsc < 2) for (const f of airFtrFree().sort((a, b) => dist(a.x, a.y, lead.x, lead.y) - dist(b.x, b.y, lead.x, lead.y)).slice(0, 2 - nEsc)) {
      tag(f, { esc: true, escOf: pk, slot: nEsc + 1, capT: Math.max(f.capT || 0, 45) }); if (f.phase === 'loiter') airSet(f, 'out'); f.retask = true; nEsc++;
    }
  }
  // 防空压制：目标附近已知敌防空，派歼-35 防空压制型先打（最多两架）
  const aa = airAAKnown(tx, ty, 320).filter(o => o.k !== 'manpads');
  for (const o of aa.slice(0, 2)) {
    if (!(S.assets.strike > 0) || !S.air.wing.some(w => w.type === 'strike' && w.state === 'deck')) break;
    if (launchPlane('strike', o.x, o.y, 'sead')) { tag(S.planes[S.planes.length - 1], { seadP: true }); nSd++; }
  }
  // 待机点：目标向我方一侧 330（避开已知防空圈），扫荡与压制完成前在这里盘旋
  if (nSw || nSd || nEsc) {   // 有护航就先在待机点会合
    let hx = tx, hy = Math.min(H - 60, ty + 330);
    const th = airAAKnown(tx, ty, 700);
    for (let i = 0; i < 8 && th.some(o => dist(o.x, o.y, hx, hy) < 260); i++) hy = Math.min(H - 40, hy + 50);
    for (const b of fl) b.hold = { x: clamp(hx + (b === lead ? 0 : 40), 40, W - 40), y: hy, t0: S.t, until: S.t + (nSd ? 50 : nSw ? 35 : 28), pkg: pk };
  }
  lead.pkg = pk;
  for (const b of fl) b.pkg = pk;
  if (typeof v8Stat === 'function') v8Stat('bomberPkg');
  if (typeof awStat === 'function') { awStat('bSweep', nSw); awStat('bEsc', nEsc); awStat('bSead', nSd); if (!nSw && !nEsc) awStat('bNoEsc'); }
  const fn = (S.planes.find(p => p.pkg === pk && p.kind === 'fighter') || {}).v, fnm = airName('fighter', fn).split(' ')[0], bnm = airName('bomber', lead.v).split(' ')[0];
  if (nSw) said.push(`${fnm} ${nSw} 架前出扫荡`);
  if (nSd) said.push(`歼-35 防空压制型 ${nSd} 架先打敌防空`);
  if (nEsc) said.push(`${fnm} ${nEsc} 架随队护航${S.planes.some(p => p.pkg === pk && p.retask) ? '（由空中巡逻改派）' : ''}`);
  if (awAewUp()) said.push('空警-600 预警引导');
  const txt = `突击群编成：${bnm} ${fl.length} 架${said.length ? '，' + said.join('，') : G.late ? '（护航机整备未完，轰炸机不进敌防空圈，投完立即脱离）' : '（敌无歼击机威胁，单独出动）'}`;
  log(txt, 'info', 'bpkg', 4, { x: tx, y: ty });
  if (typeof chatSay === 'function') chatSay('p', `命令：${txt}${lead.hold ? '。轰炸机先在防空圈外待机，扫荡与压制完成后进入投弹航路' : ''}。`, { kind: 'order', at: { x: tx, y: ty }, key: 'bpkg', gap: 15, lv: 1 });
}
const awAewUp = () => typeof awAew === 'function' && !!awAew();
// 轰炸机待机：扫荡机到位（巡逻或已接敌）、目标附近已知防空打掉、压制机投弹完毕，或待机时间到，才进入投弹航路
function airHoldP(p, dt, speed) {
  const H0 = p.hold, mates = S.planes.filter(o => !o.dead && o.pkg === H0.pkg);
  const sw = mates.filter(o => o.sweep), swOk = !sw.length || sw.some(o => o.phase === 'loiter' || o.tg);
  const sd = mates.some(o => o.seadP && o.phase === 'out' && !o.dropped);
  const aa = airAAKnown(p.tx, p.ty, 320).filter(o => o.k !== 'manpads').length;
  const es = mates.filter(o => o.escOf === H0.pkg), escOk = !es.length || es.some(o => dist(o.x, o.y, p.x, p.y) < 170);   // 护航机已到身边
  if (S.t > H0.until || (S.t - H0.t0 > 4 && swOk && !sd && !aa && escOk)) {
    p.hold = null;
    if (p.id === H0.pkg && typeof chatSay === 'function') chatSay('p', `报告：${escOk && es.length ? '护航机已会合，' : ''}${swOk ? (sw.length ? '扫荡机已控制目标空域' : '目标空域无敌机') : '扫荡未完'}${aa ? `，目标附近仍有 ${aa} 处敌防空` : '，敌防空已压制'}——轰炸机进入投弹航路。`, { kind: 'report', at: { x: p.tx, y: p.ty }, key: 'bhold', gap: 20, lv: 2 });
    return false;
  }
  p.alt = Math.min(1, p.alt + dt / 2.2); speed(150);
  if (dist(p.x, p.y, H0.x, H0.y) > 130) airSteer(p, H0.x, H0.y, dt); else airOrbit(p, H0.x, H0.y, 90, p.odir || 1, dt);
  return true;
}
// —— 对地支援的真实战法：不在目标上空绕圈等着挨打——
//   待机点选在目标周围、已知防空圈之外（有空地导弹的取导弹射程的八成五，否则 220），在那里盘旋 / 悬停；
//   有空地导弹：在待机点防区外发射；目标附近没有已知防空时才进入一次扫射航路（冲过去打一次，立即拉起回待机点，7 秒后才能再来）；
//   攻击-2 无人机在中空待机（单兵防空、高炮够不着）；直-10 悬停发射红箭-10，每打两发换一个悬停点；
//   导弹告警：放干扰弹、转向背离来袭方向、放弃这次攻击航路；目标附近防空太强、又没有导弹可用：直接返航，不去送 ——
function airCasHold(p) {
  const M = airMdl(p.kind, p.v), uav = !p.v || p.v === 'gj2', heli = p.v === 'heli';
  let T = typeof airThreats === 'function' ? airThreats('p').filter(t => dist(t.x, t.y, p.cx, p.cy) < 1000) : [];
  if (uav) T = T.filter(t => t.k === 'ship' || t.r >= 400);   // 中空：只怕防空导弹
  const R = M.agmR ? M.agmR * .85 : 220, home = { x: p.cx, y: Math.min(H - 40, p.cy + 400) };
  p.hop = (p.hop || 0);
  const sp = airSafePos(p.cx, p.cy, R, T, home.x + (heli ? Math.sin(p.hop * 1.7) * 300 : 0), home.y, heli ? 30 : 50, heli ? (x, y) => coverAt(x, y) * 2 : null) || { x: home.x, y: home.y, risk: 0 };
  p.hp = { x: sp.x, y: sp.y, risk: sp.risk, t: S.t };
  p.tRisk = typeof airThreatAt === 'function' ? airThreatAt(T, p.cx, p.cy, 30) : 0;
}
function airCasFly(p, dt, speed) {
  const M = airMdl(p.kind, p.v), sp = airSpec(p.kind, p.v), uav = !p.v || p.v === 'gj2', heli = p.v === 'heli';
  if (!p.hp || S.t - p.hp.t > 6) airCasHold(p);
  if ((p.loiterT -= dt) <= 0) { airSet(p, 'rtb'); return; }
  p.alt = Math.min(uav ? 1 : heli ? .3 : .85, p.alt + dt / 2);
  // 导弹告警：放干扰弹、背离来袭方向全速脱离 3 秒，放弃本次航路
  if (typeof airMslWarn === 'function' && airMslWarn('p', 'plane', p.id)) {
    if (!(p.brk > S.t)) { p.brk = S.t + 3; p.run = null; if (typeof v8Stat === 'function') v8Stat('casBreak'); if (typeof MSV === 'object') MSV.fl.push({ x: p.x, y: p.y, t: S.t }); log(`${airName(p.kind, p.v).split(' ')[0]}导弹告警：放干扰弹、机动规避`, 'warn', 'casbrk' + p.id, 8, p); }
  }
  if (p.brk > S.t) {
    const m = S.missiles.find(o => o.kind === 'sam' && o.side === 'e' && !o.done && o.tgt && o.tgt.k === 'plane' && o.tgt.id === p.id), a = m ? Math.atan2(p.y - m.y, p.x - m.x) : p.heading;
    speed(sp.spd * 1.1); airSteer(p, clamp(p.x + Math.cos(a) * 300, 30, W - 30), clamp(p.y + Math.sin(a) * 300, 30, H - 30), dt, true);
    if (S.t > p.brk - .1) airCasHold(p);
    return;
  }
  const hasAgm = M.agm && p.agmN > 0, gun = !uav && !heli;
  // 目标附近防空太强、手上又没有防区外武器：返航
  if (!hasAgm && p.tRisk >= 1.5 && !p.run) { log(`${airName(p.kind, p.v).split(' ')[0]}：目标上空防空太强，无防区外武器，返航`, 'warn', 'casrtb' + p.id, 20, p); if (typeof v8Stat === 'function') v8Stat('casAbort'); airSet(p, 'rtb'); return; }
  // 扫射航路：冲向目标、近距扫射一次、立即拉起回待机点
  if (p.run) {
    speed(sp.spd); const d = airSteer(p, p.run.x, p.run.y, dt, true);
    if (d < 70 && !p.run.shot) { p.run.shot = true; casStrafe(p); if (typeof v8Stat === 'function') v8Stat('casRun'); }
    if (p.run.shot && d > 120 || S.t - p.run.t > 9) { p.run = null; p.runCd = S.t + 7; }
    return;
  }
  airAgm(p);
  if (gun && S.t >= (p.runCd || 0) && p.tRisk < .5) {
    let best = null, bd = 1e9;
    const pT = S.teams.filter(q => q.side === 'p' && q.men.length);
    for (const q of S.teams) if (q.side === 'e' && q.men.length && dist(q.x, q.y, p.cx, p.cy) <= 160 && inVision(q.x, q.y) && !pT.some(o => dist(o.x, o.y, q.x, q.y) <= 45)) { const d = dist(q.x, q.y, p.x, p.y); if (d < bd) { bd = d; best = q; } }
    for (const e of S.enemies) if (!e.dead && dist(e.x, e.y, p.cx, p.cy) <= 160 && inVision(e.x, e.y)) { const d = dist(e.x, e.y, p.x, p.y); if (d < bd) { bd = d; best = e; } }
    if (best) { p.run = { x: best.x, y: best.y, t: S.t }; return; }
  }
  if (heli) {   // 悬停：到了就停住、机头对准目标；每打两发换个悬停点
    const d = dist(p.x, p.y, p.hp.x, p.hp.y);
    if (d > 18) { speed(sp.spd * .8); airSteer(p, p.hp.x, p.hp.y, dt, true); }
    else { speed(0); const want = Math.atan2(p.cy - p.y, p.cx - p.x); p.heading += clamp(Math.atan2(Math.sin(want - p.heading), Math.cos(want - p.heading)), -1.5 * dt, 1.5 * dt); p.bank = 0; }
    if (p.agmN != null) { if (p.n0 == null) p.n0 = p.agmN; if (p.n0 - p.agmN >= 2) { p.n0 = p.agmN; p.hop++; airCasHold(p); if (typeof v8Stat === 'function') v8Stat('heliHop'); } }
    return;
  }
  speed(uav ? 120 : 140);
  airOrbit(p, p.hp.x, p.hp.y, uav ? 90 : 70, p.odir || 1, dt);
}
// 新飞机的公共字段
function airNew(w, kind, x, y, heading, tx, ty, extra) {
  const M = airMdl(kind, w.v), p = { id: S.nid++, wid: w.id, home: cvHome(w), kind, v: w.v || null, x, y, heading, spd: 0, alt: 0, bank: 0,
    tx, ty, cx: tx, cy: ty, wp: [{ x: tx, y: ty }], leg: 0, aaT: Math.random() * .5, rt: 0, gunT: 0, strafeT: 1, loiterT: M.loiter || 40, odir: 1, dropped: false, rtbT: 0, ...extra };
  if (kind === 'recon') { const a = Math.atan2(ty - y, tx - x), [bx, by] = airRay(tx, ty, a, 700); p.wp.push({ x: bx, y: by }); }   // 侦察机：飞越目标后沿同一方向再向纵深飞 700
  if (kind === 'fighter') Object.assign(p, { aam: M.aam || 4, gun: M.gun ?? 40, capT: M.cap || 90, aamR: M.aamR || 480, pkK: M.pkK || 1, aamL: M.aamL || 0, aamLR: M.aamLR || 0, radar: M.radar || 520, aam0: (M.aam || 4) + (M.aamL || 0) });   // 空空导弹 · 机炮点射次数 · 巡逻秒数 · 远程弹 · 机载雷达（airwar.js）
  if (M.agm) p.agmN = M.agmN;   // 空地导弹（airAgm）
  return p;
}
// 陆基飞机（歼-20、轰-6K、无侦-7、攻击-2）：从战区机场起飞，由地图南缘进入战场
function launchLand(w, kind, tx, ty) {
  tx = clamp(tx, 10, W - 10); ty = clamp(ty, 10, H - 10);
  const x = clamp(tx + gauss() * 120, 60, W - 60), M = airMdl(kind, w.v);
  const p = airNew(w, kind, x, H + 10, -Math.PI / 2, tx, ty, { phase: 'out', land: true, alt: 1, spd: M.spd || AIR_SPEC[kind].spd });
  S.planes.push(p);
  w.state = 'out';
  airCount();
  log(`${airName(kind, w.v)}从战区机场起飞，目标方位 ${fmtBrg(bearing(x, H, tx, ty))}`, 'info', 'airup', 1.5);
  return true;
}
function launchFrom(w, kind, sp, tx, ty) {
  const c = S.cv;
  tx = clamp(tx, 10, W - 10); ty = clamp(ty, 10, H - 10);
  // 两条弹射器轮流使用：同一条间隔 2.4 秒，两条之间至少错开 1.2 秒
  const k = c.cat[0] <= c.cat[1] ? 0 : 1, at = Math.max(S.t, c.cat[k], c.cat[1 - k] - 1.2);
  c.cat[k] = at + 2.4;
  const [u0, v0] = CVG.cats[k], [x, y] = cvW(u0, v0);
  const p = airNew(w, kind, x, y, c.heading, tx, ty, { phase: 'cat', wait: at - S.t, cat: k, lu: u0, lv: v0 });
  S.planes.push(p);
  w.state = 'launch';
  c.exposedUntil = Math.max(c.exposedUntil || 0, S.t + 10);   // 起降作业：甲板灯光与弹射蒸汽，10 秒内易被岸防炮发现
  airCount();
  log(`${airName(kind, w.v)}弹射起飞，目标方位 ${fmtBrg(bearing(c.x, c.y, tx, ty))}`, 'info', 'airup', 1.5);
  return true;
}

// —— 每个推演步：航母机动、自动派机、整备、各架飞机飞行与任务、防空火力 ——
function updatePlanes(dt) {
  if (!S.cv || !S.air) initCarrier();
  updateCarrier(dt);
  updateAirAuto(dt);
  airBomberQueue(dt);
  for (const w of S.air.wing) if (w.state === 'rearm' && (w.rearmT -= dt) <= 0) {
    w.state = 'deck'; w.rearmT = 0;
    if (airLandW(w)) log(`${airName(w.type, w.v)}在${w.af ? '夺取的机场' : '战区机场'}加油挂弹完毕，可以再次出击`, 'good', 'rearm' + w.type + (w.v || ''), 8);
    else if (S.cv.hp > 0) log(`${airName(w.type, w.v)}整备完毕`, 'good', 'rearm' + w.type + (w.v || ''), 8);
  }
  for (const p of S.planes) {
    if (p.dead) continue;
    if (p.kind === 'transport') {   // 战区运输机（para.js）：不归航母，照样挨高炮
      if (typeof paFly === 'function') paFly(p, dt); else p.dead = true;
      if (!p.dead && p.alt > .4) airAA(p, dt);
      continue;
    }
    let c = cvOf(cvHome(p)) || S.cv;
    if (!p.land && c.hp <= 0 && p.phase !== 'cat' && p.phase !== 'roll') {   // 母舰瘫痪：改降其他还能起降的航母
      const alt = cvAll().find(o => o.hp > 0), w = airWing(p);
      if (alt) { p.home = cvHome(alt); if (w) w.home = p.home; c = alt; }
    }
    withCV(c, () => flyPlane(p, dt));
    if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.heading)) { airAbort(p); continue; }   // 防御：数值异常直接收回
    if (!p.dead && p.alt > .4) airAA(p, dt);
  }
  S.planes = S.planes.filter(p => !p.dead);
  for (const w of S.air.wrecks) if (!w.hit && S.t - w.t >= 2.2) {   // 残骸坠地
    w.hit = true;
    const [x, y] = airWreckPos(w, 2.2);
    S.fx.push({ kind: isLand(x, y) ? 'boom' : 'flash', x, y, r: 14, life: 0, max: .8, side: 'p' });
  }
  S.air.wrecks = S.air.wrecks.filter(w => S.t - w.t < 2.6);
  airCount();
}

// 转向飞行：限制角速度；固定目标落在转弯圈内时先直飞拉开（带回差，避免贴着转弯圈绕圈）
// free：追踪前方移动的引导点（盘旋、最后进近）时不做此判断
function airSteer(p, tx, ty, dt, free) {
  const d = dist(p.x, p.y, tx, ty), df = airAng(Math.atan2(ty - p.y, tx - p.x) - p.heading), spd = Math.max(20, p.spd);
  let turn = clamp(df, -AIR_TURN * dt, AIR_TURN * dt);
  if (!free && Math.abs(df) > .15) {
    const r = spd / AIR_TURN, s = df > 0 ? 1 : -1, ox = p.x - Math.sin(p.heading) * r * s, oy = p.y + Math.cos(p.heading) * r * s;
    if (dist(ox, oy, tx, ty) < r * (p.ext ? 1.4 : 1.02)) { turn = 0; p.ext = true; } else p.ext = false;
  } else p.ext = false;
  p.heading = airAng(p.heading + turn);
  p.bank = lerp(p.bank || 0, dt > 0 ? turn / (AIR_TURN * dt) : 0, Math.min(1, dt * 6));
  p.x += Math.cos(p.heading) * p.spd * dt; p.y += Math.sin(p.heading) * p.spd * dt;
  return d;
}
// 绕圆盘旋：瞄准圆周上前方的点（dir = 1 顺时针）
function airOrbit(p, cx, cy, R, dir, dt) {
  const d = dist(p.x, p.y, cx, cy);
  if (d > R * 2.2) return airSteer(p, cx, cy, dt);
  const a = Math.atan2(p.y - cy, p.x - cx) + dir * .55;
  return airSteer(p, cx + Math.cos(a) * R, cy + Math.sin(a) * R, dt, true);
}
// 着舰几何：斜角甲板中线方向与接地点（随航母移动）
function cvLanding() {
  const L = CVG.land, a = S.cv.heading + CV_LANG, [x, y] = cvW(lerp(L.u0, L.u1, CVG.td), lerp(L.v0, L.v1, CVG.td));
  return { x, y, a, dx: Math.cos(a), dy: Math.sin(a) };
}
const cvDeckBusy = p => S.planes.some(o => o !== p && !o.dead && cvHome(o) === cvHome(p) && (o.phase === 'final' || o.phase === 'trap'));

function flyPlane(p, dt) {
  const c = S.cv, sp = airSpec(p.kind, p.v), dead = c.hp <= 0, M = airMdl(p.kind, p.v);
  const speed = v => { p.spd += clamp(v - p.spd, -70 * dt, 45 * dt); };
  p.gunT = Math.max(0, (p.gunT || 0) - dt);
  if (p.afPh && typeof abPlaneFly === 'function' && abPlaneFly(p, dt, speed)) return;   // 在夺取的机场起降（abn.js）
  if (!Array.isArray(p.wp) || !p.wp.length) p.wp = [{ x: isFinite(p.tx) ? p.tx : p.x, y: isFinite(p.ty) ? p.ty : p.y }];
  // 甲板阶段：弹射器上等待 → 滑跑加速离舰（随航母移动，用局部坐标）
  if (p.phase === 'cat' || p.phase === 'roll') {
    if (dead) { airAbort(p); return; }
    if (p.phase === 'cat') { if ((p.wait -= dt) <= 0) { airSet(p, 'roll'); p.spd = 15; } }
    else { p.spd += 85 * dt; p.lu += p.spd * dt; }
    [p.x, p.y] = cvW(p.lu, p.lv); p.heading = c.heading; p.alt = 0; p.bank = 0;
    if (p.phase === 'roll' && p.lu >= CVG.cats[p.cat || 0][2]) { airSet(p, 'out'); p.alt = .05; }
    return;
  }
  if (p.phase === 'trap') {   // 拦阻索减速，停稳后入库整备
    const L = CVG.land;
    p.tl =(p.tl ?? CVG.td) + p.spd * dt / CV_LLEN; p.spd = Math.max(0, p.spd - 170 * dt);
    [p.x, p.y] = cvW(lerp(L.u0, L.u1, p.tl), lerp(L.v0, L.v1, p.tl)); p.heading = airAng(c.heading + CV_LANG); p.alt = 0; p.bank = 0;
    if (p.spd <= 0 && (p.rest = (p.rest || 0) + dt) > .6) {
      p.dead = true;
      const w = airWing(p);
      if (w && w.state !== 'lost') { w.state = 'rearm'; w.rearmT = AIR_REARM; }
    }
    return;
  }
  if (p.kind === 'fighter' && (p.phase === 'out' || p.phase === 'loiter') && typeof awFlyP === 'function') { awFlyP(p, dt, speed); return; }   // 战斗机巡逻 / 拦截（airwar.js）
  if (p.phase === 'out') {
    p.alt = Math.min(1, p.alt + dt / 2.2); speed(sp.spd);
    if (p.kind === 'recon') {
      const wp = p.wp[Math.min(p.leg, p.wp.length - 1)], d = airSteer(p, wp.x, wp.y, dt);
      const ahead = (wp.x - p.x) * Math.cos(p.heading) + (wp.y - p.y) * Math.sin(p.heading);
      if (d < 45 || (ahead < 0 && d < 160)) p.leg++;
      if (p.y < STAGING_Y && (p.rt -= dt) <= 0) { p.rt = .2; S.recon.push({ x: p.x, y: p.y, until: S.t + 25 }); }
      if (p.leg >= p.wp.length) airSet(p, 'rtb');
    } else if (p.kind === 'strike' || p.kind === 'bomber') {
      if (p.hold && !p.dropped && airHoldP(p, dt, speed)) return;   // 突击群：防空圈外待机
      if (p.asm && !p.dropped && typeof navyPlaneAsm === 'function' && navyPlaneAsm(p, dt, speed)) return;   // 挂反舰导弹打敌舰（navy.js）
      const dive = p.kind === 'bomber' && p.v === 'dive', heavy = p.kind === 'bomber' && !dive, std = p.kind === 'strike' && M.std;   // 歼-35：防区外投放精确制导弹药
      if (!p.dropped) {
        const df = Math.abs(airAng(Math.atan2(p.ty - p.y, p.tx - p.x) - p.heading)), d = airSteer(p, p.tx, p.ty, dt);
        if (dive && d < 280 && df < .5) { p.diving = true; speed(235); p.alt = Math.max(.32, p.alt - dt * .9); }   // 俯冲：压低高度加速
        if (std ? d < M.std && df < .3 : dive ? d < 42 : heavy ? d < 95 && df < .3 : d < 80 && df < .35) (std ? guidedDrop : p.kind === 'bomber' ? bomberDrop : strikeDrop)(p);
      } else if (p.std) {   // 投完立即掉头，不飞进敌防空圈
        airSteer(p, p.x - Math.cos(p.heading) * 300, Math.min(H - 40, p.y + 300), dt, true);
        if ((p.egT -= dt) <= 0) airSet(p, 'rtb');
      } else {
        airSteer(p, p.x + Math.cos(p.heading) * 200, p.y + Math.sin(p.heading) * 200, dt);
        if ((p.egT -= dt) <= 0) { p.diving = false; airSet(p, 'rtb'); }
      }
    } else {
      // 对地支援：先飞到任务区外的待机点（避开已知防空圈），到了转入待机（airCasFly）
      if (!p.hp) { Object.assign(p, { cx: p.tx, cy: p.ty, loiterT: M.loiter || 40, strafeT: .8 }); airCasHold(p); }
      const d = airSteer(p, p.hp.x, p.hp.y, dt);
      if (dist(p.x, p.y, p.tx, p.ty) < (M.agmR || 0) + 60) airAgm(p);   // 进入导弹射程就先发射，不必等飞临目标上空
      if (d < 70) { const cross = Math.cos(p.heading) * (p.hp.y - p.y) - Math.sin(p.heading) * (p.hp.x - p.x); p.odir = cross >= 0 ? 1 : -1; airSet(p, 'loiter'); }
    }
    return;
  }
  if (p.phase === 'loiter') { airCasFly(p, dt, speed); return; }
  if (p.land) {   // 陆基飞机：向南飞出地图，回战区机场加油挂弹（100 秒后再出击）；夺取了敌机场、有油料就改降那里（abn.js）
    if (typeof abRtbLand === 'function' && abRtbLand(p) && abPlaneFly(p, dt, speed)) return;
    p.alt = Math.min(1, p.alt + dt / 3); speed(sp.spd);
    airSteer(p, clamp(p.x, 40, W - 40), H + 60, dt, true);
    if (p.y > H + 15) { p.dead = true; const w = airWing(p); if (w && w.state !== 'lost') { w.state = 'rearm'; w.rearmT = AIR_REARM_LAND; w.af = false; } }
    return;
  }
  // —— 返航：rtb 飞到舰尾一侧的顺风点（偏离中线约两个转弯半径）→ final 转弯切入斜角甲板中线下滑 → trap 着舰；
  //    甲板占用时 hold 在右舷外盘旋等待 ——
  p.rtbT = (p.rtbT || 0) + dt;
  if (dead) {   // 航母瘫痪：无处降落，飞回航母附近迫降
    p.alt = Math.max(.3, p.alt - dt * .1); speed(140);
    if (airSteer(p, c.x, c.y, dt) < 140 || p.rtbT > 60) airLost(p, '航母瘫痪，舰载机无处降落，迫降海面', true);
    return;
  }
  const G = cvLanding(), rx = p.x - G.x, ry = p.y - G.y, along = rx * G.dx + ry * G.dy, lat = -rx * G.dy + ry * G.dx, hd = Math.abs(airAng(p.heading - G.a));
  const s = lat >= 0 ? 1 : -1, ax = G.x - G.dx * 380 - G.dy * s * 150, ay = G.y - G.dy * 380 + G.dx * s * 150;
  if (p.rtbT > 90) {   // 兜底：长时间未能着舰，直接收回
    Object.assign(p, { tl: CVG.td, spd: 60, rest: 0 }); airSet(p, 'trap');
    return;
  }
  if (p.phase === 'final') {
    const k = clamp(-along / 330, 0, 1);
    speed(lerp(78, 130, k)); p.alt = Math.min(p.alt, .06 + k * .94);
    const look = Math.min(along + 100, 30);
    airSteer(p, G.x + G.dx * look, G.y + G.dy * look, dt, true);
    if (along >= -3) {
      if (Math.abs(lat) < 12 && hd < .5) { Object.assign(p, { tl: CVG.td, spd: Math.min(p.spd, 90), rest: 0 }); airSet(p, 'trap'); }
      else { airSet(p, 'rtb'); p.alt = Math.max(p.alt, .35); }   // 复飞
    } else if (Math.abs(lat) > 320 || along < -900) airSet(p, 'rtb');
    return;
  }
  p.alt = Math.min(1, p.alt + dt / 3);
  const busy = cvDeckBusy(p), da = dist(p.x, p.y, ax, ay);
  if (p.phase === 'hold') {
    speed(140);
    const [hx, hy] = cvW(-40, 240);
    airOrbit(p, hx, hy, 130, 1, dt);
    if (!busy) airSet(p, 'rtb');
    return;
  }
  speed(sp.spd);
  if (!busy && along < -200 && along > -650 && Math.abs(lat) < 90 && hd < .6) { airSet(p, 'final'); return; }   // 已在进近航线上
  if (busy && da < 300) { airSet(p, 'hold'); return; }
  airSteer(p, ax, ay, dt);
  if (da < 70 && !busy) airSet(p, 'final');
}

// 攻击机：沿进场方向投下三连弹（以目标为中心，间隔 34）
function strikeDrop(p) {
  p.dropped = true; p.egT = 1.4;
  const ch = Math.cos(p.heading), sh = Math.sin(p.heading);
  for (let i = 0; i < 3; i++) {
    const off = (i - 1) * 34 + gauss() * 8, side = gauss() * 6;
    fireShell(p.x, p.y, clamp(p.tx + ch * off - sh * side, 0, W), clamp(p.ty + sh * off + ch * side, 0, H), 'p', 'bomb', .7, false, { t: -i * .18 });
  }
}

// 已知的敌防空（我方情报）：高炮阵地、防空车（M163、M-SHORAD、LPWS）、近 90 秒暴露过的毒刺组；w = 威胁分
function airAASites() {
  const out = [];
  if (!S) return out;
  for (const e of S.enemies) if (!e.dead && e.kind === 'aa' && e.kx != null) out.push({ x: e.kx, y: e.ky, w: (e.mod && e.mod.aa ? 1.6 : 1) * ((e.sup || 0) > 50 ? .5 : 1), k: 'gun', id: e.id, o: e });
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead && v.kx != null && (vehSp(v).aa || (v.mod && v.mod.cram))) out.push({ x: v.kx, y: v.ky, w: v.type === 'sam_veh' ? 2 : 1.3, k: 'veh', id: 'v' + v.id, o: v });
  for (const q of S.teams) if (q.side === 'e' && q.men.length && q.men.includes('aa') && q.aaSeen != null && S.t - q.aaSeen < 90) out.push({ x: q.aax, y: q.aay, w: .8, k: 'mp', id: 'q' + q.id, o: q });
  return out;
}
const airAAAt = (x, y, r = 300) => airAASites().reduce((a, s) => a + (dist(s.x, s.y, x, y) < r ? s.w : 0), 0);
// 歼-35：防区外投放两枚精确制导炸弹（散布很小）；防空压制型发射反辐射导弹，自动对准目标 140 以内已知的敌防空
function guidedDrop(p) {
  p.dropped = true; p.std = true; p.egT = 2.5;
  const M = airMdl(p.kind, p.v);
  let tx = p.tx, ty = p.ty;
  if (M.sead) { let bd = 140; for (const a of airAASites()) { const d = dist(a.x, a.y, p.tx, p.ty); if (d < bd) { bd = d; tx = a.x; ty = a.y; } } }
  const d = dist(p.x, p.y, tx, ty);
  for (let i = 0; i < 2; i++) fireShell(p.x, p.y, clamp(tx + gauss() * 4, 0, W), clamp(ty + gauss() * 4, 0, H), 'p', 'bomb', .4 + d / 260, false, { t: -i * .3, gd: true });
  if (typeof v8Stat === 'function') v8Stat(M.sead ? 'seadArm' : 'gdrop');
  log(M.sead ? `${M.name}在防区外发射反辐射导弹，压制敌防空` : `${M.name}在防区外投放精确制导炸弹`, 'info', 'gdrop', 10, { x: tx, y: ty });
}

// 轰炸机投弹：俯冲轰炸机两枚重磅弹几乎正中目标；重型轰炸机沿进场方向六弹地毯轰炸（间隔 26）
function bomberDrop(p) {
  p.dropped = true; p.egT = 1.6;
  const ch = Math.cos(p.heading), sh = Math.sin(p.heading);
  if (p.v === 'dive') for (let i = 0; i < 2; i++) fireShell(p.x, p.y, clamp(p.tx + gauss() * 7, 0, W), clamp(p.ty + gauss() * 7, 0, H), 'p', 'bomb', .45, false, { t: -i * .12 });
  else for (let i = 0; i < 6; i++) {
    const off = (i - 2.5) * 26 + gauss() * 6, side = gauss() * 10;
    fireShell(p.x, p.y, clamp(p.tx + ch * off - sh * side, 0, W), clamp(p.ty + sh * off + ch * side, 0, H), 'p', 'bomb', .9, false, { t: -i * .14 });
  }
}

// 对地支援机扫射：盘旋中心 160 内、我方视野内、距任何我方小组 45 以上的最近目标
// 空地导弹：射程 agmR 内、任务区 220 以内看得见的硬目标（坦克 / 战车、装甲车、碉堡、炮位、防空、发射车）；离我军 40 以内不打；
// 同一目标只要一枚在飞；两次发射间隔 2.5 秒（KD-88 防区外、蓝箭-7 / 红箭-10 近距）
const AGM_V = { tank: 6, td: 5.5, hv_tank: 6.5, lt_tank: 5, apc: 4.5, amtank: 4.5, aa_veh: 5, sam_veh: 5.5, spg: 4.5, recon: 3, flame_tank: 5.5 };
const AGM_E = { bunker: 4.5, coastal: 5, arty: 4.5, mortar: 3.5, aa: 5, tel: 6, ascm: 6 };
function airAgm(p) {
  const M = airMdl(p.kind, p.v);
  if (!M.agm || !(p.agmN > 0) || (p.agmT || 0) > S.t || typeof msPgm !== 'function' || p.alt < .4) return;
  p.agmT = S.t + 1;
  const cx = p.cx ?? p.tx, cy = p.cy ?? p.ty, own = (x, y) => S.teams.some(q => q.side === 'p' && q.men.length && dist(q.x, q.y, x, y) < 40);
  const flying = (k, id) => S.missiles.some(m => m.kind === 'pgm' && !m.done && m.side === 'p' && m.tgt && m.tgt.k === k && m.tgt.id === id);
  let best = null, bs = 0;
  const cand = (k, o, v) => {
    const d = dist(p.x, p.y, o.x, o.y);
    if (!v || d > M.agmR || dist(o.x, o.y, cx, cy) > 220 || !inVision(o.x, o.y) || own(o.x, o.y) || flying(k, o.id)) return;
    const s = v / (1 + d / 400);
    if (s > bs) { bs = s; best = { k, id: o.id, x: o.x, y: o.y, o }; }
  };
  for (const v of S.veh || []) if (v.side === 'e' && !v.dead) cand('veh', v, AGM_V[v.type] || 3);
  for (const a of S.armor || []) if (!a.dead) cand('armor', a, 4.5);
  for (const e of S.enemies) if (!e.dead) cand('enemy', e, AGM_E[e.kind]);
  if (!best) return;
  msPgm(M.agm, 'p', p.x, p.y, best, p.kind);
  p.agmN--; p.agmT = S.t + 2.5;
  if (typeof v8Stat === 'function') v8Stat('agm');
  const nm = best.k === 'veh' ? (typeof vehName === 'function' ? vehName(best.o) : '敌战车') : best.k === 'armor' ? '敌装甲车' : (ENEMY_SPEC[best.o.kind] || {}).name || '目标';
  log(`${airName(p.kind, p.v).split(' ')[0]}发射${MS_PGM[M.agm].nm}，打击${nm}（余 ${p.agmN} 枚）`, 'info', 'agm' + p.id, 2, best);
}
function casStrafe(p) {
  const pT = S.teams.filter(q => q.side === 'p' && q.men.length), safe = (x, y) => !pT.some(q => dist(q.x, q.y, x, y) <= 45);
  let best = null, bd = 260, team = false;
  for (const q of S.teams) if (q.side === 'e' && q.men.length && dist(q.x, q.y, p.cx, p.cy) <= 160 && inVision(q.x, q.y)) {
    const d = dist(p.x, p.y, q.x, q.y);
    if (d < bd && safe(q.x, q.y)) { bd = d; best = q; team = true; }
  }
  for (const e of S.enemies) if (!e.dead && dist(e.x, e.y, p.cx, p.cy) <= 160 && inVision(e.x, e.y)) {
    const d = dist(p.x, p.y, e.x, e.y);
    if (d < bd && safe(e.x, e.y)) { bd = d; best = e; team = false; }
  }
  if (!best) return false;
  if (team) {
    suppress(best, 30, p.x, p.y);
    if (Math.random() < .25 * coverAt(best.x, best.y) / .9 * (SMOKE[ci(best.x, best.y)] ? .5 : 1)) killMan(best);
    for (const o of S.teams) if (o !== best && o.side === 'e' && o.men.length && dist(o.x, o.y, best.x, best.y) < 22) suppress(o, 12, p.x, p.y);
  } else {
    damageEnemy(best, 1.5);
    best.sup = Math.min(100, (best.sup || 0) + 45);
  }
  for (let k = 0; k < 4; k++) tracer(p.x, p.y, best.x + gauss() * 7, best.y + gauss() * 7, 'p', true);
  Object.assign(p, { gunT: .35, gx: best.x, gy: best.y });
  S.stats.shots++;
  log('对地支援机开始扫射', 'info', 'strafe', 20, best);
  return true;
}

// 防空炮：190 内每 0.5 秒判定一次；被压制的炮位命中率下降
function airAA(p, dt) {
  if ((p.aaT = (p.aaT || 0) - dt) > 0) return;
  p.aaT = .5;
  if (typeof eaHigh === 'function' && (eaHigh(p) || eaHighUav(p))) return;   // 战斗机在巡逻高度、无人机在中空：高炮够不着
  const sp = airSpec(p.kind, p.v), st = sp.stealth ? (1 + sp.stealth) / 2 : 1;   // 隐身机：雷达高炮难以跟踪，光学瞄准仍可能打中
  for (const a of S.enemies) {
    if (a.dead || a.kind !== 'aa' || dist(a.x, a.y, p.x, p.y) > 190) continue;
    tracer(a.x, a.y, p.x + gauss() * 14, p.y + gauss() * 14, 'e', inVision(a.x, a.y));
    if (a.kx == null && Math.random() < .15) { a.kx = a.x; a.ky = a.y; log('防空炮火暴露位置', 'warn', null, 0, a); }
    const k = p.kind === 'bomber' ? (p.v === 'dive' ? (p.diving ? 1.3 : 1) : .75) : 1;
    if (Math.random() < sp.aa * k * st * (1 - (a.sup || 0) / 130)) { airLost(p, `${airName(p.kind, p.v)}被击落`); break; }
  }
}

// 损失一架飞机：击落（空中爆炸 + 翻滚坠落）或迫降（水花）
function airLost(p, msg, ditch) {
  if (p.dead) return;
  p.dead = true;
  const w = airWing(p);
  if (w) w.state = 'lost';
  if (ditch) S.fx.push({ kind: 'flash', x: p.x, y: p.y, r: 12, life: 0, max: .8, side: 'p' });
  else {
    S.fx.push({ kind: 'boom', x: p.x, y: p.y, r: 22, life: 0, max: 1, side: 'p' });
    S.air.wrecks.push({ x: p.x, y: p.y, h: p.heading, spd: Math.min(80, p.spd * .4), kind: p.kind, v: p.v || null, t: S.t, hit: false });
  }
  if (msg) log(msg, 'bad', null, 0, { x: p.x, y: p.y });
}
const airWreckPos = (w, age) => [w.x + Math.cos(w.h) * w.spd * age, w.y + Math.sin(w.h) * w.spd * age];
// 中止起飞（航母瘫痪时仍在弹射器上的飞机）
function airAbort(p) {
  p.dead = true;
  const w = airWing(p);
  if (w && w.state !== 'lost') { w.state = p.phase === 'cat' || p.phase === 'roll' ? 'deck' : 'lost'; w.rearmT = 0; }
}

// —— 航母机动：只在集结线以北 150 以南的深水区；转向平缓 ——
function orderCV(x, y) {
  if (!S.cv || !S.air) initCarrier();
  const c = S.cv;
  if (c.hp <= 0) { log('航母已瘫痪，无法机动', 'warn', 'cvmv', 2); return false; }
  if (!isFinite(x) || !isFinite(y)) return false;
  const deploy = S.phase === 'deploy', ymin = deploy ? STAGING_Y + 40 : STAGING_Y - 150;
  x = clamp(x, 90, W - 90); y = Math.min(y, H - 30);
  if (y < ymin || typeAt(x, y) !== T.DEEP) {
    log(deploy ? '部署阶段航母只能停在集结海域' : '航母只能在集结线以北 150 以南的深水区机动', 'warn', 'cvl', 2);
    return false;
  }
  if (deploy) Object.assign(c, { x, y, tx: x, ty: y, moving: false });
  else Object.assign(c, { tx: x, ty: y, moving: true, pathT: -9 });
  return true;
}

function cvClear(x0, y0, x1, y1) {
  const n = Math.ceil(dist(x0, y0, x1, y1) / 15);
  for (let s = 1; s <= n; s++) if (typeAt(lerp(x0, x1, s / n), lerp(y0, y1, s / n)) > T.SHOAL) return false;
  return true;
}

function updateCarrier(dt) {
  if (!S.cv || !S.air) initCarrier();
  cvMove(S.cv, dt);
  for (const x of S.cvx || []) cvMove(x, dt);
}
function cvMove(c, dt) {
  if (c.stepT === S.t) return;   // 同一推演步只更新一次（step 中另有调用也无妨）
  c.stepT = S.t;
  if (c.hp <= 0) { c.moving = false; return; }
  if (!c.moving) return;
  const d = dist(c.x, c.y, c.tx, c.ty);
  if (d < 6) { c.moving = false; return; }
  if (S.t - (c.pathT ?? -9) > 1) { c.pathT = S.t; c.direct = cvClear(c.x, c.y, c.tx, c.ty); }
  let wx = c.tx, wy = c.ty;
  if (!c.direct && d > 30) { const f = field(c.tx, c.ty, 'ship'), n = f && nextStep(f, c.x, c.y); if (n) [wx, wy] = n; }
  const df = airAng(Math.atan2(wy - c.y, wx - c.x) - c.heading);
  c.heading = airAng(c.heading + clamp(df, -.18 * dt, .18 * dt));
  const sp = 10 * clamp(Math.cos(df), .25, 1) * clamp(d / 50, .35, 1) * (typeAt(c.x, c.y) === T.SHOAL ? .55 : 1) * dt;
  const nx = c.x + Math.cos(c.heading) * sp, ny = c.y + Math.sin(c.heading) * sp;
  if (typeAt(nx, ny) <= T.SHOAL && ny >= STAGING_Y - 200) { c.x = clamp(nx, 60, W - 60); c.y = Math.min(ny, H - 20); }
}

// 爆炸落在舰体 30 以内：甲板受损；直接命中可能毁掉甲板上的飞机；归零即瘫痪（由 combat.js impact 调用）
function cvImpact(x, y, pw) { for (const c of cvAll()) withCV(c, () => cvImpact1(x, y, pw)); }
function cvImpact1(x, y, pw) {
  const c = S.cv, h = cvHome(c), nm = c.name || '航母';
  if (!c || c.hp <= 0 || !pw || !pw.ship) return;
  const [u, v] = cvL(x, y), d = Math.hypot(Math.max(0, Math.abs(u) - 75), Math.max(0, Math.abs(v) - 13));
  if (d >= 30) return;
  c.hp = Math.max(0, c.hp - pw.ship * (1 - d / 30 * .6)); c.hitT = S.t;
  if (d === 0) {
    for (const p of S.planes) if (!p.dead && cvHome(p) === h && (p.phase === 'cat' || p.phase === 'roll' || p.phase === 'trap') && dist(p.x, p.y, x, y) < 16) airLost(p, `${airName(p.kind, p.v)}在甲板上被炸毁`);
    if (Math.random() < .3) {
      let best = null, bd = 40;
      const wing = S.air.wing.filter(w => cvHome(w) === h && !airLandW(w));
      for (const [id, j] of cvPark(c, wing)) {   // 只有停在甲板上的会被炸到，机库里的不受影响
        const s = CVG.slots[j], dd = dist(s[0], s[1], u, v);
        if (dd < bd) { bd = dd; best = wing.find(w => w.id === id); }
      }
      if (best) { best.state = 'lost'; log(`${airName(best.type, best.v)}在甲板上被炸毁`, 'bad', null, 0, c); }
    }
  }
  if (c.hp > 0) { log(`${nm}中弹，飞行甲板受损（${Math.ceil(c.hp)}/${c.maxhp}）`, 'bad', 'cvhit' + h, 4, c); return; }
  c.moving = false;
  for (const p of S.planes) if (cvHome(p) === h && (p.phase === 'cat' || p.phase === 'roll')) airAbort(p);
  S.fx.push({ kind: 'boom', x: c.x, y: c.y, r: 60, life: 0, max: 1.6, side: 'p' });
  const alt = cvAll().some(o => o !== c && o.hp > 0);
  log(alt ? `${nm}遭重创，飞行甲板瘫痪：舰载机改由其他航母起降` : '航母遭重创，飞行甲板瘫痪，舰载机无法再起降', 'bad', null, 0, c);
  if (alt) for (const w of S.air.wing) if (cvHome(w) === h && w.state !== 'lost' && w.state !== 'deck' && w.state !== 'rearm') w.home = cvHome(cvAll().find(o => o !== c && o.hp > 0));
  airCount();
}

// 视野来源（由 updateVision 合并到我方视野）
function carrierVision() {
  return S && S.cv ? cvAll().map(c => ({ x: c.x, y: c.y, r: 90, h: 1.5 })) : [];
}

// —— 自动派机（S.cv.auto）：对地支援压制我军的敌人、空袭已标定火力点、侦察前线方向的敌占据点 ——
function updateAirAuto(dt) {
  const c = S.cv;
  if (!c || !c.auto || S.phase !== 'battle' || (!cvAll().some(o => o.hp > 0) && !S.air.wing.some(w => airLandW(w) && w.state !== 'lost'))) return;   // 旗舰的自动开关统管全部航母（含战区陆基飞机）
  if ((c.autoT = (c.autoT ?? 2) - dt) > 0) return;
  c.autoT = 3;
  if (typeof awAutoP === 'function' && awAutoP()) return;   // 制空（airwar.js）：先派战斗机拦截 / 巡逻
  // 敌方掌握制空权、我又没有战斗机在空：攻击机与轰炸机暂缓，对地支援只在我军压力很大时出动
  const awBad = typeof awState === 'function' && awState() === 'e' && !S.planes.some(p => !p.dead && p.kind === 'fighter' && p.alt > .3);
  // 指挥官的航空任务（commander.js）：H 时侦察、受阻攻击的对地支援、假目标后的复查与再次出击
  const T = typeof cmdAirTask === 'function' ? cmdAirTask(c) : null;
  const L = T && airPkg(T.k, T.x, T.y, T.pref);
  if (L) { if (typeof cmdAirLaunched === 'function') cmdAirLaunched(T, L); return; }
  const pT = S.teams.filter(q => q.side === 'p' && q.men.length);
  const near = (x, y, r) => pT.filter(q => dist(q.x, q.y, x, y) < r);
  const busy = (kind, x, y, r) => S.planes.some(p => p.kind === kind && !p.dead && (p.phase === 'cat' || p.phase === 'roll' || p.phase === 'out' || p.phase === 'loiter') && dist(p.cx ?? p.tx, p.cy ?? p.ty, x, y) < r);
  if (S.assets.cas > 0 && pT.length) {
    let best = null, bs = 0;
    for (const o of S.teams) if (o.side === 'e' && o.men.length && inVision(o.x, o.y)) {
      const nb = near(o.x, o.y, 220);
      if (!nb.length || nb.some(q => dist(q.x, q.y, o.x, o.y) < 60) || busy('cas', o.x, o.y, 200)) continue;
      const s = nb.reduce((a, q) => a + 1 + q.sup / 50, 0);
      if (typeof eaThreat === 'function' && eaThreat(o.x, o.y) >= 1 && s < 8) continue;   // 已知敌单兵防空：盘旋的对地支援机不去送（我方压力很大时例外）
      if (typeof cmdAirClosed === 'function' && cmdAirClosed(o.x, o.y) && s < 10) continue;   // 已知敌防空强：先由舰炮、导弹、歼-35 打掉（commander.js cmdSeadP）
      if (s > bs) { bs = s; best = o; }
    }
    if (best && bs >= (awBad ? 6 : 2) && airPkg('cas', best.x, best.y)) return;
  }
  if (S.assets.strike > 0 && !awBad) {
    const PRI = { coastal: 5, ascm: 5, tel: 5, airfield: 4.5, arty: 4, aa: 3.5, mortar: 3, bunker: 2 };   // 歼-35 在时高炮阵地（防空）优先级再乘 1.8
    let best = null, bs = 0;
    for (const e of S.enemies) if (!e.dead && e.kx != null && !(e.kind === 'airfield' && typeof abKeep === 'function' && abKeep())) {   // 打算空降夺取的机场不炸（abn.js）
      if (near(e.kx, e.ky, typeof cmdAirSafe === 'function' ? cmdAirSafe() : 90).length || busy('strike', e.kx, e.ky, 70) || S.shells.some(s => s.side === 'p' && s.kind === 'bomb' && dist(s.x1, s.y1, e.kx, e.ky) < 60)) continue;
      const stl = S.air.wing.some(w => w.type === 'strike' && w.state === 'deck' && airMdl('strike', w.v).stealth);   // 歼-35 隐身：不怕防空圈
      const s = (PRI[e.kind] || 1) * (e.kind === 'bunker' && !near(e.kx, e.ky, 320).length ? .3 : 1) * (!stl && typeof eaThreat === 'function' && eaThreat(e.kx, e.ky) >= 1 ? .4 : 1) * (e.kind === 'aa' && stl ? 1.8 : 1);
      if (s > bs) { bs = s; best = e; }
    }
    const L = best && airPkg('strike', best.kx, best.ky);
    if (L) { if (typeof cmdAirLaunched === 'function') cmdAirLaunched({ k: 'strike', x: best.kx, y: best.ky, eid: best.id }, L); return; }
  }
  if (S.assets.bomber > 0 && !awBad) {   // 轰炸机：炮兵阵地群、岸防炮、碉堡（周围已标定目标越多越优先）；我军 150 以内不投
    const PRI = { coastal: 5, airfield: 5, ascm: 4.5, tel: 4.5, arty: 4.5, aa: 3, mortar: 3, bunker: 2.5 };
    let best = null, bs = 0;
    for (const e of S.enemies) if (!e.dead && e.kx != null && !(e.kind === 'airfield' && typeof abKeep === 'function' && abKeep())) {
      if (near(e.kx, e.ky, 150).length || busy('bomber', e.kx, e.ky, 90) || S.shells.some(s => s.side === 'p' && s.kind === 'bomb' && dist(s.x1, s.y1, e.kx, e.ky) < 60)) continue;
      const s = (PRI[e.kind] || 1) + .8 * S.enemies.filter(o => o !== e && !o.dead && o.kx != null && dist(o.kx, o.ky, e.kx, e.ky) < 90).length;
      if (s > bs) { bs = s; best = e; }
    }
    if (best && airPkg('bomber', best.kx, best.ky)) return;
  }
  if (S.assets.recon > 0 && !S.planes.some(p => p.kind === 'recon' && !p.dead) && S.t - (c.reconT ?? -99) > 40) {
    // 前线方向：我方步兵重心；尚未登陆时用登陆舰队重心
    const inf = pT.filter(q => q.kind === 'inf'), sh = S.ships.filter(s => alive(s)), src = inf.length ? inf : pT.length ? pT : sh.length ? sh : [c];
    const fx = src.reduce((a, q) => a + q.x, 0) / src.length, fy = src.reduce((a, q) => a + q.y, 0) / src.length;
    const tgt = S.points.filter(p => p.owner !== 'p').sort((a, b) => dist(a.x, a.y, fx, fy) - dist(b.x, b.y, fx, fy))[0];
    if (tgt && launchPlane('recon', tgt.x, tgt.y)) c.reconT = S.t;
  }
}
function toggleCvAuto() {
  if (!S.cv || !S.air) initCarrier();
  S.cv.auto = !S.cv.auto;
  log(S.cv.auto ? '航母自动派机支援：开启' : '航母自动派机支援：关闭', 'info', 'cvauto', 0);
  if (typeof updateHud === 'function') updateHud();
}

// 单位卡数据（hud.js updateCards 使用）
function cvCard() {
  if (!S.cv || !S.air) initCarrier();
  const c = S.cv, live = S.air.wing.filter(w => w.state !== 'lost' && !airLandW(w)), n = live.length || 1;
  const ready = live.filter(w => w.state === 'deck' && (cvOf(cvHome(w)) || { hp: 0 }).hp > 0).length, up = live.filter(w => w.state === 'launch' || w.state === 'out' || w.state === 'return').length;
  return { n: ready, hp: clamp(c.hp / c.maxhp, 0, 1), ready: ready / n, air: up / n,
    state: c.hp <= 0 ? 'rout' : c.hp < c.maxhp * .4 || S.t < (c.exposedUntil || 0) ? 'waver' : 'ok', mini: c.auto ? 'auto' : c.moving ? 'move' : 'hold' };
}

// 点选：世界坐标落在航母舰体上返回 'CV'
function pickCarrier(p) {
  const c = S && S.cv;
  if (!c || !p || !isFinite(p.x) || !isFinite(p.y)) return null;
  const rd = typeof R !== 'undefined' && R.s > 0, k = rd ? cvScale() : 1, pad = rd ? px(4) : 0, [u, v] = cvL(p.x, p.y);
  return Math.abs(u) <= 78 * k + pad && Math.abs(v) <= 19 * k + pad ? 'CV' : null;
}

// —— 绘制 ——
const cvScale = () => Math.max(1, 56 / (CV_LEN * R.s));   // 小屏全图时放大，保证航母至少约 56px 长

function cvPath(ctx, pts) { ctx.beginPath(); for (const [u, v] of pts) ctx.lineTo(u, v); ctx.closePath(); }

function airShape(ctx, type) {
  const h = AIR_SIL[type] || AIR_SIL.j35;
  if (type === 'heli') { ctx.beginPath(); ctx.ellipse(1.5, 0, 6.5, 2.6, 0, 0, 7); ctx.moveTo(-4, .7); ctx.lineTo(-12.5, .5); ctx.lineTo(-12.5, -.5); ctx.lineTo(-4, -.7); return; }
  if (type === 'uh60') { ctx.beginPath(); ctx.ellipse(1.5, 0, 7, 3.4, 0, 0, 7); ctx.moveTo(-4.5, 1); ctx.lineTo(-12.5, .6); ctx.lineTo(-12.5, -.6); ctx.lineTo(-4.5, -1); return; }   // 黑鹰：机身更宽（运兵舱）
  ctx.beginPath();
  for (const [x, y] of h) ctx.lineTo(x, y);
  for (let i = h.length - 1; i >= 0; i--) ctx.lineTo(h[i][0], -h[i][1]);
  ctx.closePath();
}

// 飞机剪影：轮廓 + 各型细节（预警机雷达圆盘、歼-20 外倾双垂尾与鸭翼、轰-6K 翼根发动机、A-10 尾部双发、连翼机的中空、V 尾、旋翼与短翼）；攻击机挂弹
function drawAircraft(ctx, x, y, a, type, size, col, alpha, bank, lw, bombs) {
  const sc = size / 21;
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(sc, sc * (1 - .32 * Math.min(1, Math.abs(bank || 0))));
  airShape(ctx, type);
  ctx.fillStyle = `rgba(2,10,6,${.88 * alpha})`; ctx.fill();
  ctx.strokeStyle = rgba(col, alpha); ctx.lineWidth = lw / sc; ctx.stroke();
  ctx.lineWidth = lw / sc * .7;
  const seg = (...p) => { ctx.beginPath(); for (let i = 0; i < p.length; i += 4) { ctx.moveTo(p[i], p[i + 1]); ctx.lineTo(p[i + 2], p[i + 3]); } ctx.stroke(); };
  if (type !== 'heli' && type !== 'uh60' && type !== 'gj11' && type !== 'wz7') seg(8.5, 0, 4.5, 0);   // 座舱
  if (type === 'kj600') {   // 背负雷达圆盘 + 两台涡桨
    ctx.beginPath(); ctx.arc(-1.8, 0, 3.6, 0, 7); ctx.fillStyle = `rgba(2,10,6,${alpha})`; ctx.fill(); ctx.stroke();
    seg(-5.4, 0, 1.8, 0);
    for (const s of [-1, 1]) ctx.strokeRect(1.2, s * 4.4 - .8, 3.4, 1.6);
  } else if (type === 'wz7') {   // 连翼中间是空的
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(.4, s * 1.5); ctx.lineTo(-4.2, s * 8.4); ctx.lineTo(-7.4, s * 2.4); ctx.stroke(); }
  } else if (type === 'j20') {   // 外倾双垂尾
    for (const s of [-1, 1]) seg(-6, s * 1.9, -9.6, s * 3);
  } else if (type === 'j35' || type === 'f35' || type === 'j15') {   // 双垂尾
    for (const s of [-1, 1]) seg(-5.6, s * 1.6, -9.2, s * 2.3);
  } else if (type === 'f22') {   // 外倾双垂尾 + 进气口
    for (const s of [-1, 1]) seg(-4.6, s * 2.1, -8.4, s * 3.4, 3.4, s * 1.9, 1.4, s * 2.5);
  } else if (type === 'j36') {   // 背部进气口 + 三台发动机的扁平喷口，翼尖开裂式方向舵，无垂尾
    ctx.strokeRect(-.6, -1, 3.4, 2);
    for (const y of [-1.7, 0, 1.7]) ctx.strokeRect(-12, y - .5, 1.5, 1);
    for (const s of [-1, 1]) seg(-6.2, s * 9.4, -7.4, s * 9.4);
  } else if (type === 'h6k') {   // 翼根两台发动机
    for (const s of [-1, 1]) ctx.strokeRect(-1.8, s * 3.2 - .9, 6, 1.8);
  } else if (type === 'a10') {   // 尾部背负双发 + 双垂尾
    for (const s of [-1, 1]) { ctx.strokeRect(-6.4, s * 2.6 - .9, 3.6, 1.8); seg(-9.4, s * 4.8, -10.6, s * 4.8); }
  } else if (type === 'gj2') {   // V 形尾翼
    for (const s of [-1, 1]) seg(-8.2, s * .4, -10.2, s * 3.6);
  } else if (type === 'gj11') {   // 背部进气口
    ctx.strokeRect(1, -1, 3, 2);
  } else if (type === 'heli' || type === 'uh60') {   // 主旋翼 + 短翼挂架（黑鹰是外挂架）
    seg(-.5, type === 'uh60' ? -5 : -4.2, -.5, type === 'uh60' ? 5 : 4.2);
    ctx.setLineDash([2.2, 1.6]); ctx.beginPath(); ctx.arc(1.5, 0, 9.5, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  } else if (type === 'transport') {   // 运-20：四台发动机
    for (const s of [-1, 1]) for (const y of [4.2, 8]) ctx.strokeRect(1.4, s * y - .8, 3.2, 1.6);
  }
  if (bombs) {
    ctx.fillStyle = rgba(COL.amber, alpha);
    for (const s of [-1, 0, 1]) { ctx.beginPath(); ctx.ellipse(-1.5 + Math.abs(s) * .5, s * 4.6, 1.6, .8, 0, 0, 7); ctx.fill(); }
  }
  ctx.restore();
}

function drawCarrier(time) {
  if (!S || !S.cv) return;
  drawCarrier1(time);
  for (const x of S.cvx || []) withCV(x, () => drawCarrier1(time));
}
function drawCarrier1(time) {
  const c = S && S.cv, h = cvHome(c);
  if (!c || !R.ctx || !isFinite(c.x) || !isFinite(c.y)) return;
  const ctx = R.ctx, k = cvScale(), lw = n => px(n) / k, dead = c.hp <= 0, det = CV_LEN * k * R.s;
  const col = dead ? COL.amber : COL.g, hit = S.t - (c.hitT ?? -99) < .35, sel = !h && typeof isSel === 'function' && isSel('CV');
  const wing = S.air ? S.air.wing.filter(w => cvHome(w) === h && !airLandW(w)) : [], deckPl = S.planes.filter(p => !p.dead && cvHome(p) === h && (p.phase === 'cat' || p.phase === 'roll'));
  if (c.moving && !dead) {   // 航向指示
    ctx.strokeStyle = rgba(COL.sel, sel ? .6 : .25); ctx.lineWidth = px(1); ctx.setLineDash([px(4), px(4)]);
    ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.tx, c.ty); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(c.tx, c.ty, px(5), 0, 7); ctx.stroke();
  }
  ctx.save();
  ctx.translate(c.x, c.y); ctx.rotate(c.heading); ctx.scale(k, k);
  if (c.moving && !dead) {   // 舰尾 V 形尾流与舰首浪
    for (const s of [-1, 1]) {
      const g = ctx.createLinearGradient(-77, 0, -190, 0);
      g.addColorStop(0, rgba(COL.intel, .35)); g.addColorStop(1, rgba(COL.intel, 0));
      ctx.strokeStyle = g; ctx.lineWidth = lw(1.4);
      ctx.beginPath(); ctx.moveTo(-74, s * 9); ctx.lineTo(-190, s * (30 + 4 * Math.sin(time * 2 + s))); ctx.stroke();
    }
    const g = ctx.createLinearGradient(-77, 0, -150, 0);
    g.addColorStop(0, rgba('#d4fff0', .1)); g.addColorStop(1, rgba('#d4fff0', 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-76, -6); ctx.lineTo(-150, -10); ctx.lineTo(-150, 10); ctx.lineTo(-76, 6); ctx.fill();
    ctx.strokeStyle = rgba('#d4fff0', .35); ctx.lineWidth = lw(1.2);
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(79, 0); ctx.quadraticCurveTo(70, s * 12, 52, s * 19); ctx.stroke(); }
  }
  // 舰体投影与飞行甲板
  ctx.save(); ctx.translate(4 * Math.sin(c.heading) + 3 * Math.cos(c.heading), 4 * Math.cos(c.heading) - 3 * Math.sin(c.heading));
  cvPath(ctx, CVG.deck); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill(); ctx.restore();
  cvPath(ctx, CVG.deck);
  ctx.fillStyle = 'rgba(2,10,6,.9)'; ctx.fill();
  ctx.strokeStyle = hit ? rgba('#ffffff', .95) : rgba(col, dead ? .65 : .95); ctx.lineWidth = lw(hit ? 2.6 : 1.6); ctx.stroke();
  const L = CVG.land, nx = -(L.v1 - L.v0) / CV_LLEN, ny = (L.u1 - L.u0) / CV_LLEN;
  if (det >= 70) {
    // 斜角着舰区：两侧边线、中线虚线、拦阻索
    ctx.strokeStyle = rgba(col, .35); ctx.lineWidth = lw(1);
    ctx.beginPath();
    for (const s of [-8, 8]) { ctx.moveTo(L.u0 + nx * s, L.v0 + ny * s); ctx.lineTo(L.u1 + nx * s, L.v1 + ny * s); }
    ctx.stroke();
    ctx.setLineDash([lw(5), lw(4)]); ctx.strokeStyle = rgba(STRUCT, .45);
    ctx.beginPath(); ctx.moveTo(L.u0, L.v0); ctx.lineTo(L.u1, L.v1); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = rgba(STRUCT, .3);
    ctx.beginPath();
    for (const t of [.1, .14, .18, .22]) { const u = lerp(L.u0, L.u1, t), v = lerp(L.v0, L.v1, t); ctx.moveTo(u + nx * 6, v + ny * 6); ctx.lineTo(u - nx * 6, v - ny * 6); }
    ctx.stroke();
    // 舰首轴向中线
    ctx.setLineDash([lw(4), lw(4)]); ctx.strokeStyle = rgba(STRUCT, .25);
    ctx.beginPath(); ctx.moveTo(-74, 6); ctx.lineTo(-30, 6); ctx.stroke(); ctx.setLineDash([]);
  }
  // 弹射器：有飞机待射或滑跑时发光
  for (let i = 0; i < 2; i++) {
    const [u0, v0, u1] = CVG.cats[i], on = deckPl.find(p => (p.cat || 0) === i && (p.phase === 'roll' || p.wait < 1.2));
    ctx.strokeStyle = on ? rgba(COL.amber, .55 + .4 * Math.sin(time * 14)) : rgba(STRUCT, det >= 70 ? .3 : .18);
    ctx.lineWidth = lw(on ? 2.2 : 1);
    ctx.beginPath(); ctx.moveTo(u0, v0); ctx.lineTo(u1 - 2, v0); ctx.stroke();
    if (on && on.phase === 'roll') {   // 弹射蒸汽
      const g = ctx.createLinearGradient(u0, v0, on.lu, v0);
      g.addColorStop(0, rgba('#d4fff0', 0)); g.addColorStop(1, rgba('#d4fff0', .5));
      ctx.strokeStyle = g; ctx.lineWidth = lw(4); ctx.beginPath(); ctx.moveTo(u0, v0); ctx.lineTo(on.lu, v0); ctx.stroke();
    }
  }
  if (det >= 160) {   // 升降机
    ctx.strokeStyle = rgba(STRUCT, .22); ctx.lineWidth = lw(1);
    ctx.strokeRect(-62, 9.5, 10, 5); ctx.strokeRect(22, -14.5, 9, 5);
  }
  // 舰岛：右舷上层建筑、烟囱、桅杆与旋转雷达
  ctx.fillStyle = 'rgba(2,10,6,1)'; ctx.strokeStyle = rgba(STRUCT, dead ? .5 : .85); ctx.lineWidth = lw(1.3);
  ctx.beginPath(); ctx.moveTo(-4, 11); ctx.lineTo(18, 11); ctx.lineTo(21, 13.5); ctx.lineTo(18, 17); ctx.lineTo(-4, 17); ctx.closePath(); ctx.fill(); ctx.stroke();
  if (det >= 70) {
    ctx.lineWidth = lw(1); ctx.strokeRect(5, 12.3, 5, 3.4);
    const ra = dead ? 0 : time * 3;
    ctx.beginPath(); ctx.moveTo(14 - Math.cos(ra) * 3, 14 - Math.sin(ra) * 3); ctx.lineTo(14 + Math.cos(ra) * 3, 14 + Math.sin(ra) * 3); ctx.stroke();
    ctx.fillStyle = rgba(dead ? COL.enemy : COL.g, .5 + .5 * Math.sin(time * 4)); ctx.beginPath(); ctx.arc(1, 14, lw(1.6), 0, 7); ctx.fill();
  }
  // 甲板停机：待命（青）、整备中（琥珀 + 进度）、空位（机位原主出击中 ＋、已损失 ×）；机库里的飞机不画，只在舰下状态点里
  const park = cvPark(c, wing), slotOf = new Map([...park].map(([id, j]) => [j, id]));
  for (let j = 0; j < Math.min(CVG.slots.length, wing.length); j++) {
    const [u, v, r] = CVG.slots[j], id = slotOf.get(j), w = id != null ? wing.find(o => o.id === id) : null;
    if (w) {
      const rearm = w.state === 'rearm', cl = rearm ? COL.amber : COL.intel;
      if (det < 80) { ctx.fillStyle = rgba(cl, rearm ? .55 : .9); ctx.fillRect(u - 2.6, v - 2.6, 5.2, 5.2); continue; }
      drawAircraft(ctx, u, v, r, airSilKey(w.type, w.v), w.type === 'bomber' ? 10.5 : 8.5, cl, rearm ? .7 : 1, 0, lw(1.1), w.type === 'bomber' && !rearm);
      if (rearm && det >= 160) {
        ctx.strokeStyle = rgba(COL.amber, .8); ctx.lineWidth = lw(1.4);
        ctx.beginPath(); ctx.arc(u, v, 5.6, -1.57, -1.57 + (1 - clamp(w.rearmT / AIR_REARM, 0, 1)) * 6.283); ctx.stroke();
      }
    } else if (det >= 160) {
      const lost = wing[j].state === 'lost';
      ctx.strokeStyle = rgba(lost ? COL.enemy : STRUCT, .22); ctx.lineWidth = lw(1);
      ctx.beginPath();
      if (lost) { ctx.moveTo(u - 2.5, v - 2.5); ctx.lineTo(u + 2.5, v + 2.5); ctx.moveTo(u + 2.5, v - 2.5); ctx.lineTo(u - 2.5, v + 2.5); }
      else { ctx.moveTo(u - 3, v); ctx.lineTo(u + 3, v); ctx.moveTo(u, v - 2); ctx.lineTo(u, v + 2); }
      ctx.stroke();
    }
  }
  if (dead) {   // 甲板火灾
    CVG.fires.forEach(([u, v], i) => {
      const r = 7 + 2.5 * Math.sin(time * 9 + i * 1.7), g = ctx.createRadialGradient(u, v, 0, u, v, r);
      g.addColorStop(0, rgba('#fff3d6', .85)); g.addColorStop(.35, rgba(COL.amber, .7)); g.addColorStop(1, rgba(COL.enemy, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(u, v, r, 0, 7); ctx.fill();
    });
  }
  if (S.t < (c.exposedUntil || 0) && !dead && c.y - coastAt(c.x) < 760) {   // 起降作业暴露（处于岸防炮可及海域）
    ctx.strokeStyle = rgba(COL.enemy, .35 + .35 * Math.sin(time * 10)); ctx.lineWidth = lw(1.5); ctx.setLineDash([lw(5), lw(4)]);
    ctx.beginPath(); ctx.ellipse(0, 0, 96, 32, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  }
  if (sel) {   // 选中：四角括线
    ctx.strokeStyle = COL.sel; ctx.lineWidth = lw(2.2);
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.beginPath(); ctx.moveTo(su * 84, sv * 13); ctx.lineTo(su * 84, sv * 23); ctx.lineTo(su * 70, sv * 23); ctx.stroke();
    }
  }
  ctx.restore();
  if (dead) {   // 黑烟向东北飘散
    for (let i = 0; i < 6; i++) {
      const ph = (time * .25 + i / 6) % 1, sx = c.x + 20 + ph * 140, sy = c.y - 10 - ph * 70, r = (10 + ph * 34) * Math.max(1, k * .7);
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, rgba(COL.smoke, .22 * (1 - ph))); g.addColorStop(1, rgba(COL.smoke, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill();
    }
  }
  // 舰体下方：甲板耐久条 + 联队状态点（侦察 ○、攻击 △、对地支援 ◇）
  const ey = (78 * Math.abs(Math.sin(c.heading)) + 19 * Math.abs(Math.cos(c.heading))) * k;
  const bw = clamp(100 * k, px(46), px(130)), by = c.y + ey + px(7), f = clamp(c.hp / c.maxhp, 0, 1);
  ctx.fillStyle = rgba(col, .2); ctx.fillRect(c.x - bw / 2, by, bw, px(3));
  ctx.fillStyle = f > .5 ? COL.g : f > .25 ? COL.amber : COL.enemy; ctx.fillRect(c.x - bw / 2, by, bw * f, px(3));
  const gap = px(6.5), list = AIR_TYPES.flatMap(t => wing.filter(w => w.type === t)), tw = list.length * gap + px(5) * 2;
  let x = c.x - tw / 2 + gap / 2, prev = null;
  const yy = by + px(9), r = px(2.3);
  for (const w of list) {
    if (prev && prev !== w.type) x += px(5);
    prev = w.type;
    const st = w.state, cl = st === 'deck' ? (dead ? COL.amber : COL.intel) : st === 'rearm' ? COL.amber : st === 'lost' ? COL.enemy : COL.intel;
    ctx.strokeStyle = rgba(cl, st === 'lost' ? .4 : .95); ctx.fillStyle = rgba(cl, .95); ctx.lineWidth = px(1.1);
    if (st === 'lost') { ctx.beginPath(); ctx.moveTo(x - r, yy - r); ctx.lineTo(x + r, yy + r); ctx.moveTo(x + r, yy - r); ctx.lineTo(x - r, yy + r); ctx.stroke(); }
    else {
      ctx.beginPath();
      if (w.type === 'recon') ctx.arc(x, yy, r, 0, 7);
      else if (w.type === 'strike') { ctx.moveTo(x, yy - r * 1.2); ctx.lineTo(x + r * 1.1, yy + r * .9); ctx.lineTo(x - r * 1.1, yy + r * .9); ctx.closePath(); }
      else if (w.type === 'bomber') ctx.rect(x - r * 1.1, yy - r * 1.1, r * 2.2, r * 2.2);
      else if (w.type === 'fighter') { ctx.moveTo(x - r * 1.2, yy - r * .9); ctx.lineTo(x, yy + r * 1.1); ctx.lineTo(x + r * 1.2, yy - r * .9); ctx.lineTo(x, yy - r * .2); ctx.closePath(); }   // 战斗机：V 形
      else { ctx.moveTo(x, yy - r * 1.25); ctx.lineTo(x + r * 1.1, yy); ctx.lineTo(x, yy + r * 1.25); ctx.lineTo(x - r * 1.1, yy); ctx.closePath(); }
      if (st === 'deck') ctx.fill(); else ctx.stroke();
      if (st === 'rearm') { ctx.save(); ctx.clip(); const p = 1 - clamp(w.rearmT / AIR_REARM, 0, 1); ctx.fillRect(x - r * 1.3, yy + r * 1.3 - p * r * 2.6, r * 2.6, p * r * 2.6); ctx.restore(); }
    }
    x += gap;
  }
  const g = !h && typeof groupOf === 'function' ? groupOf('CV') : 0;
  if (g && typeof pips === 'function') pips(ctx, g, c.x, yy + px(7), COL.sel);
}

function drawPlanes(time) {
  const ctx = R.ctx, c = S.cv, k = c ? cvScale() : 1, big = n => Math.max(n, px(20));
  ctx.fillStyle = rgba(COL.intel, .16);
  for (const r of S.recon) ctx.fillRect(r.x - 1, r.y - 1, 2, 2);
  if (AIR_TRAILS.size) { const ids = new Set(S.planes.map(p => p.id)); for (const id of [...AIR_TRAILS.keys()]) if (!ids.has(id)) AIR_TRAILS.delete(id); }
  // 被击落：翻滚、拖着黑烟坠落
  for (const w of (S.air && S.air.wrecks) || []) {
    const age = S.t - w.t, u = clamp(age / 2.2, 0, 1);
    if (age < 0 || age > 2.2) continue;
    for (let j = 1; j <= 6; j++) {
      const a2 = age - j * .09;
      if (a2 < 0) break;
      const [sx, sy] = airWreckPos(w, a2);
      ctx.fillStyle = rgba(COL.smoke, .3 * (1 - j / 7)); ctx.beginPath(); ctx.arc(sx, sy, px(2) + j * 1.2, 0, 7); ctx.fill();
    }
    const [x, y] = airWreckPos(w, age);
    drawAircraft(ctx, x, y, w.h + age * 5, airSilKey(w.kind, w.v), big(airSpec(w.kind, w.v).size) * (1 - u * .55), COL.amber, 1 - u * .6, Math.sin(age * 9), px(1.3), false);
  }
  for (const p of S.planes) {
    if (p.dead) continue;
    const sp = airSpec(p.kind, p.v), onDeck = p.phase === 'cat' || p.phase === 'roll' || p.phase === 'trap';
    const air = clamp((p.alt || 0) * 1.6, 0, 1), size = lerp(8.5 * k, big(sp.size), air);
    let x = p.x, y = p.y;
    if (onDeck && c && k > 1) { const cc = cvOf(cvHome(p)) || c, [u, v] = cvL(p.x, p.y, cc); [x, y] = cvW(u * k, v * k, cc); }
    if (!isFinite(x) || !isFinite(y)) continue;
    // 任务标记
    if (p.phase === 'loiter' && p.kind !== 'fighter') {   // 战斗机的巡逻圈在 airwar.js 画
      ctx.strokeStyle = rgba(COL.intel, .4); ctx.lineWidth = px(1.2); ctx.setLineDash([px(3), px(5)]); ctx.lineDashOffset = -time * 20 * (p.odir || 1);
      ctx.beginPath(); ctx.arc(p.cx, p.cy, 110, 0, 7); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      ctx.strokeStyle = rgba(COL.intel, .7); ctx.lineWidth = px(2);
      ctx.beginPath(); ctx.arc(p.cx, p.cy, 118, -1.57, -1.57 + clamp(p.loiterT / 40, 0, 1) * 6.283); ctx.stroke();
      ctx.strokeStyle = rgba(COL.intel, .12); ctx.lineWidth = px(1); ctx.beginPath(); ctx.arc(p.cx, p.cy, 160, 0, 7); ctx.stroke();
    } else if (p.phase === 'out' && p.kind === 'recon') {
      const e = p.wp[p.wp.length - 1];
      ctx.strokeStyle = rgba(COL.intel, .3); ctx.lineWidth = px(1); ctx.setLineDash([px(2), px(6)]);
      ctx.beginPath(); ctx.moveTo(x, y); for (let i = Math.min(p.leg, p.wp.length - 1); i < p.wp.length; i++) ctx.lineTo(p.wp[i].x, p.wp[i].y); ctx.stroke();
      ctx.beginPath(); ctx.arc(e.x, e.y, px(4), 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 100, time * 2, time * 2 + 4.5); ctx.stroke(); ctx.setLineDash([]);
    } else if (p.phase === 'out' && p.kind === 'strike' && !p.dropped) {
      ctx.strokeStyle = rgba(COL.amber, .55 + .3 * Math.sin(time * 6)); ctx.lineWidth = px(1.2); ctx.setLineDash([px(3), px(3)]);
      ctx.beginPath(); ctx.arc(p.tx, p.ty, POWER.bomb.R, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(p.tx - px(6), p.ty); ctx.lineTo(p.tx + px(6), p.ty); ctx.moveTo(p.tx, p.ty - px(6)); ctx.lineTo(p.tx, p.ty + px(6)); ctx.stroke();
    } else if (p.phase === 'out' && p.kind === 'cas') {
      ctx.strokeStyle = rgba(COL.intel, .25); ctx.lineWidth = px(1); ctx.setLineDash([px(3), px(5)]);
      ctx.beginPath(); ctx.arc(p.tx, p.ty, 110, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
    // 尾迹（只在空中）
    if (air > .5) {
      let tr = AIR_TRAILS.get(p.id);
      if (!tr) AIR_TRAILS.set(p.id, tr = []);
      const l = tr[tr.length - 1];
      if (!l || dist(l[0], l[1], x, y) > 6) { tr.push([x, y]); if (tr.length > 26) tr.shift(); }
      ctx.lineWidth = px(1.3);
      for (let i = 1; i < tr.length; i++) {
        ctx.strokeStyle = rgba(COL.intel, .16 * i / tr.length * air);
        ctx.beginPath(); ctx.moveTo(tr[i - 1][0], tr[i - 1][1]); ctx.lineTo(tr[i][0], tr[i][1]); ctx.stroke();
      }
    }
    // 地面投影：高度越高偏得越远
    if (air > .05) {
      const o = size * .9 * air, sc = size / 21;
      ctx.save(); ctx.translate(x + o * .7, y + o); ctx.rotate(p.heading); ctx.scale(sc, sc * (1 - .32 * Math.min(1, Math.abs(p.bank || 0))));
      airShape(ctx, airSilKey(p.kind, p.v)); ctx.fillStyle = `rgba(0,0,0,${.38 * air})`; ctx.fill(); ctx.restore();
    }
    drawAircraft(ctx, x, y, p.heading, airSilKey(p.kind, p.v), size, COL.intel, 1, p.bank, px(1.4), p.kind === 'bomber' && !p.dropped);   // 歼-35 内埋弹舱：不画外挂炸弹
    if (p.gunT > 0) {   // 机炮口焰
      const nx = x + Math.cos(p.heading) * size * .55, ny = y + Math.sin(p.heading) * size * .55;
      ctx.fillStyle = rgba('#fff3d6', .5 + .5 * Math.sin(time * 60)); ctx.beginPath(); ctx.arc(nx, ny, size * .14, 0, 7); ctx.fill();
    }
  }
}

function arrowAir(ctx, x, y, a, col) {
  const l = px(14);
  ctx.strokeStyle = col; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l); ctx.lineTo(x, y);
  ctx.moveTo(x - Math.cos(a - .5) * l * .6, y - Math.sin(a - .5) * l * .6); ctx.lineTo(x, y); ctx.lineTo(x - Math.cos(a + .5) * l * .6, y - Math.sin(a + .5) * l * .6); ctx.stroke();
}

// 出击工具预览（render3.js drawTool 调用）：侦察航带、三连弹落点、盘旋圈；无可用飞机时显示为红色
function drawAirTool(time) {
  const t = U.tool, m = U.mouse;
  if (!m || (t !== 'recon' && t !== 'strike' && t !== 'cas' && t !== 'bomber' && t !== 'fighter')) return false;
  const land = S.air && S.air.wing.some(w => w.type === t && w.state === 'deck' && airLandW(w));   // 陆基飞机不需要航母
  const ctx = R.ctx, c = cvAll().filter(o => o.hp > 0).sort((a, b) => dist(a.x, a.y, m.x, m.y) - dist(b.x, b.y, m.x, m.y))[0] || S.cv, ok = !!(S.assets && S.assets[t] > 0 && (land || (c && c.hp > 0))), col = ok ? COL.intel : COL.enemy;
  const ox = land || !c || !(c.hp > 0) ? m.x : c.x, oy = land || !c || !(c.hp > 0) ? H : c.y, a = Math.atan2(m.y - oy, m.x - ox);
  ctx.lineWidth = px(1.2); ctx.strokeStyle = rgba(col, .35); ctx.setLineDash([px(3), px(5)]);
  ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(m.x, m.y); ctx.stroke();
  if (t === 'recon') {
    const [bx, by] = airRay(m.x, m.y, a, 700), nx = -Math.sin(a) * 100, ny = Math.cos(a) * 100;
    ctx.fillStyle = rgba(col, .08);
    ctx.beginPath(); ctx.moveTo(m.x + nx, m.y + ny); ctx.lineTo(bx + nx, by + ny); ctx.lineTo(bx - nx, by - ny); ctx.lineTo(m.x - nx, m.y - ny); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba(col, .55); ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(bx, by); ctx.stroke();
    ctx.strokeStyle = rgba(col, .38); ctx.beginPath(); ctx.moveTo(m.x + nx, m.y + ny); ctx.lineTo(bx + nx, by + ny); ctx.moveTo(m.x - nx, m.y - ny); ctx.lineTo(bx - nx, by - ny); ctx.stroke();
  } else if (t === 'bomber') {   // 会出击的变体：点目标 → 俯冲轰炸机（单个小圈）；其余 → 重型轰炸机（六弹地毯）
    const pt = S.enemies.some(e => !e.dead && e.kx != null && dist(e.kx, e.ky, m.x, m.y) < 40), has = v => S.air.wing.some(w => w.type === 'bomber' && w.state === 'deck' && (w.v || 'heavy') === v);
    const dive = pt ? has('dive') || !has('heavy') : !has('heavy') && has('dive');
    ctx.strokeStyle = rgba(ok ? COL.amber : COL.enemy, .9); ctx.lineWidth = px(1.7);
    const offs = dive ? [0] : [-2.5, -1.5, -.5, .5, 1.5, 2.5].map(i => i * 26);
    for (const o of offs) {
      const bx = m.x + Math.cos(a) * o, by = m.y + Math.sin(a) * o;
      ctx.setLineDash([px(3), px(4)]); ctx.beginPath(); ctx.arc(bx, by, dive ? 14 : POWER.bomb.R, 0, 7); ctx.stroke();
      ctx.setLineDash([]); ctx.beginPath(); ctx.arc(bx, by, px(2.5), 0, 7); ctx.stroke();
    }
    arrowAir(ctx, m.x - Math.cos(a) * 110, m.y - Math.sin(a) * 110, a, rgba(ok ? COL.amber : COL.enemy, .9));
  } else if (t === 'strike' && (() => { const w = S.air && S.air.wing.find(o => o.type === 'strike' && o.state === 'deck'); return airMdl('strike', w ? w.v : null).std; })()) {   // 歼-35：精确制导，防区外投放
    const w = S.air.wing.find(o => o.type === 'strike' && o.state === 'deck'), M = airMdl('strike', w ? w.v : null);
    ctx.strokeStyle = rgba(ok ? COL.amber : COL.enemy, .9); ctx.lineWidth = px(1.7);
    ctx.setLineDash([]); ctx.beginPath(); ctx.arc(m.x, m.y, 10, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(m.x - 14, m.y); ctx.lineTo(m.x + 14, m.y); ctx.moveTo(m.x, m.y - 14); ctx.lineTo(m.x, m.y + 14); ctx.stroke();
    ctx.setLineDash([px(4), px(4)]); ctx.beginPath(); ctx.arc(m.x, m.y, M.std, a + Math.PI - .5, a + Math.PI + .5); ctx.stroke();   // 投放线：飞机在这里投弹后掉头
    arrowAir(ctx, m.x - Math.cos(a) * (M.std + 40), m.y - Math.sin(a) * (M.std + 40), a, rgba(ok ? COL.amber : COL.enemy, .9));
  } else if (t === 'strike') {
    ctx.strokeStyle = rgba(ok ? COL.amber : COL.enemy, .9); ctx.lineWidth = px(1.7);
    for (let i = 0; i < 3; i++) {
      const o = (i - 1) * 34, bx = m.x + Math.cos(a) * o, by = m.y + Math.sin(a) * o;
      ctx.setLineDash([px(3), px(4)]); ctx.beginPath(); ctx.arc(bx, by, POWER.bomb.R, 0, 7); ctx.stroke();
      ctx.setLineDash([]); ctx.beginPath(); ctx.arc(bx, by, px(2.5), 0, 7); ctx.stroke();
    }
    arrowAir(ctx, m.x - Math.cos(a) * 90, m.y - Math.sin(a) * 90, a, rgba(ok ? COL.amber : COL.enemy, .9));
  } else if (t === 'fighter') {   // 战斗机：巡逻圈与拦截搜索范围（airwar.js）
    ctx.strokeStyle = rgba(col, .7); ctx.lineDashOffset = -time * 14;
    ctx.beginPath(); ctx.arc(m.x, m.y, typeof AW_CAP === 'number' ? AW_CAP : 160, 0, 7); ctx.stroke(); ctx.lineDashOffset = 0;
    ctx.strokeStyle = rgba(col, .18); ctx.beginPath(); ctx.arc(m.x, m.y, typeof AW_RNG === 'number' ? AW_RNG : 700, 0, 7); ctx.stroke();
  } else {
    ctx.strokeStyle = rgba(col, .6); ctx.lineDashOffset = -time * 20;
    ctx.beginPath(); ctx.arc(m.x, m.y, 110, 0, 7); ctx.stroke(); ctx.lineDashOffset = 0;
    ctx.strokeStyle = rgba(col, .2); ctx.beginPath(); ctx.arc(m.x, m.y, 160, 0, 7); ctx.stroke();
  }
  ctx.setLineDash([]);
  return true;
}
