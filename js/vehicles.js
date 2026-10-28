'use strict';
// 装甲车辆：轻/中/重型坦克、两栖坦克、装甲运兵车、自行火炮、坦克歼击车、自行高炮、弹炮防空车、侦察车、喷火坦克、扫雷坦克（双方通用）
// 存档数据全在 S 里：S.veh 车辆 · S.vshots 直瞄炮弹与火焰；渲染缓存（平滑航向、履带印）在 VEHV，不进 S
// 推演部分（本文件上半）不碰 DOM，可在 Node 无头运行；绘制与界面函数只在浏览器里被调用

// armor 0–3：能伤到它的东西（≥1 轻武器无效，只压制乘员）；gun.ap 为穿深（对照 armor），he 为榴弹威力；speed 世界单位/秒；turn 弧度/秒
// 剪影：len 车长、wid 车宽、tur 炮塔半径（0 = 无炮塔/固定战斗室）、bar 炮管长；crew 车组人数（计入兵力、伤亡）；fuel 满油行程（世界单位，约够一场战斗来回两趟；泅渡耗油加倍，ZTD-05 只多两成）
const VEH_SPEC = {
  lt_tank: { crew: 3, fuel: 5800, name: '轻型坦克', code: 'LT', hp: 26, armor: 1, speed: 25, turn: 2.2, gun: { range: 200, rof: 3.2, he: 1, ap: 1.5 }, mg: { range: 170, n: 3 }, sight: 165, amph: false, carry: 0, len: 14, wid: 8, tur: 3.2, bar: 7, ammo: 40 },
  tank: { crew: 4, fuel: 5000, name: '中型坦克', code: 'MT', hp: 40, armor: 2, speed: 20, turn: 1.7, gun: { range: 230, rof: 4, he: 1.5, ap: 2.3 }, mg: { range: 170, n: 3 }, sight: 160, amph: false, carry: 0, len: 17, wid: 9.5, tur: 4, bar: 9, ammo: 40 },
  hv_tank: { crew: 4, fuel: 4000, name: '重型坦克', code: 'HT', hp: 62, armor: 3, speed: 16, turn: 1.2, gun: { range: 250, rof: 5.4, he: 2, ap: 3.2 }, mg: { range: 170, n: 3 }, sight: 150, amph: false, carry: 0, len: 20, wid: 11, tur: 4.8, bar: 11, ammo: 36 },
  amtank: { crew: 4, fuel: 4300, swimK: 1.25, name: '两栖坦克', code: 'AM', hp: 24, armor: 1, speed: 19, turn: 1.8, gun: { range: 180, rof: 3.6, he: 1.1, ap: 1.3 }, mg: { range: 160, n: 2 }, sight: 150, amph: true, carry: 0, len: 15, wid: 9, tur: 3.4, bar: 6.5, ammo: 34 },
  apc: { crew: 2, fuel: 6300, name: '装甲运兵车', code: 'AP', hp: 24, armor: 1, speed: 25, turn: 2.2, gun: null, mg: { range: 180, n: 5 }, sight: 150, amph: false, carry: 2, len: 15, wid: 8, tur: 0, bar: 0, ammo: 0 },
  spg: { crew: 4, fuel: 4700, name: '自行火炮', code: 'SP', hp: 22, armor: 1, speed: 16, turn: 1.4, gun: { range: 620, min: 110, rof: 7.5, he: 2.2, ap: 0, ind: true }, mg: null, sight: 130, amph: false, carry: 0, len: 17, wid: 9, tur: 0, bar: 10, ammo: 30 },
  td: { crew: 4, fuel: 5000, name: '坦克歼击车', code: 'TD', hp: 34, armor: 2, speed: 20, turn: 1.6, gun: { range: 270, rof: 4.6, he: .9, ap: 3.6, arc: .45 }, mg: null, sight: 160, amph: false, carry: 0, len: 17, wid: 9.5, tur: 0, bar: 12, ammo: 36 },
  aa_veh: { crew: 3, fuel: 5400, name: '自行高炮', code: 'AA', hp: 20, armor: 1, speed: 22, turn: 2, gun: null, mg: { range: 200, n: 8, quad: true }, aa: 230, sight: 170, amph: false, carry: 0, len: 14, wid: 8.5, tur: 3.6, bar: 5, ammo: 0 },
  // 弹炮防空车：双联装机关炮（对空 aa、对地 mg）+ 近程防空导弹 sam（射程、载弹、两发间隔、每枚补装秒数），能拦截来袭导弹（vehSam）
  sam_veh: { crew: 3, fuel: 5400, name: '弹炮防空车', code: 'SA', hp: 22, armor: 1, speed: 22, turn: 2, gun: null, mg: { range: 200, n: 4, quad: true }, aa: 260, sam: { range: 520, n: 8, cd: 2.5, regen: 30, icp: 450 }, sight: 200, amph: false, carry: 0, len: 15, wid: 9, tur: 3.8, bar: 5, ammo: 0 },
  recon: { crew: 3, fuel: 8100, name: '侦察车', code: 'RC', hp: 14, armor: 1, speed: 34, turn: 2.6, gun: null, mg: { range: 160, n: 2 }, sight: 285, amph: false, carry: 0, wheel: true, len: 12, wid: 6.5, tur: 2.4, bar: 3, ammo: 0 },
  flame_tank: { crew: 4, fuel: 4300, name: '喷火坦克', code: 'FL', hp: 40, armor: 2, speed: 18, turn: 1.6, gun: { range: 95, rof: 1.1, he: 0, ap: 0, flame: true }, mg: { range: 150, n: 2 }, sight: 150, amph: false, carry: 0, len: 17, wid: 9.5, tur: 3.8, bar: 6, ammo: 40 },
  mine_tank: { crew: 4, fuel: 4000, name: '扫雷坦克', code: 'MC', hp: 40, armor: 2, speed: 15, turn: 1.4, gun: { range: 200, rof: 4.6, he: 1.3, ap: 2 }, mg: { range: 150, n: 2 }, sight: 150, amph: false, carry: 0, flail: true, len: 17, wid: 10, tur: 3.8, bar: 8, ammo: 30 },
  // 伞兵战车（空降兵重装空投，abn.js）：轻、快，30 毫米机关炮能打轻装甲，挡不住坦克炮
  abv: { crew: 3, fuel: 6000, name: '伞兵战车', code: 'AB', hp: 18, armor: 1, speed: 30, turn: 2.4, gun: { range: 210, rof: 1.1, he: .8, ap: 1.3 }, mg: { range: 170, n: 3 }, sight: 170, amph: false, carry: 1, len: 13, wid: 7.5, tur: 2.8, bar: 6, ammo: 40 }
};
// 各地形的车速系数（下标同 T）：道路最快，林地、沼泽、礁岸很慢；深海/浅滩只对两栖坦克有意义（泅渡 60%）
const VEH_TSP = [.6, .6, 0, .75, .3, 0, 1, .4, .75, 0, .25, .25, 1, 1.3, .7, .45];   // 河流：涉水两成五（两栖车辆六成，vehMove）
const VEH_ORDER = { move: '机动', amove: '攻击前进', hold: '坚守', retreat: '后撤', clear: '扫雷开路' };
// HUD 单位卡图标（侧视，按进攻方型号，icons.js）；hud.js 以 'v_' + 类型 合入 ICON
const VEH_ICONS = typeof WI === 'object' ? { lt_tank: WI.ztq15, tank: WI.ztz96b, hv_tank: WI.ztz99a, amtank: WI.ztd05, apc: WI.zbd05, spg: WI.plz07, td: WI.ptl02,
  aa_veh: WI.pgz07, sam_veh: WI.pgl625, recon: WI.zbl08, flame_tank: WI.zbd04a, mine_tank: WI.ztz96m, abv: WI.zbd05 } : {};

// —— 创建与查询 ——
// 只在本步内有效的分方缓存，供 combat.js 每个小组每步查询（避免反复 filter）
const VEHC = { t: -1, S: null, p: [], e: [] };
function vehCache() {
  if (VEHC.t === S.t && VEHC.S === S) return VEHC;
  VEHC.t = S.t; VEHC.S = S; VEHC.p = []; VEHC.e = [];
  for (const v of S.veh || []) if (!v.dead) (v.side === 'e' ? VEHC.e : VEHC.p).push(v);
  return VEHC;
}
// side 方的敌对车辆（活着的）
const vehFoes = side => !S || !S.veh ? [] : vehCache()[side === 'e' ? 'p' : 'e'];
const vehById = id => (S && S.veh && S.veh.find(v => v.id === id)) || null;
// 寻路类：我方两栖坦克只在泅渡、或目标/所在格是水面时用 'amph'（海陆全图流场较贵），上岸后与其他车辆共用 'veh' 流场
const vehCls = (v, x, y) => !VEH_SPEC[v.type].amph ? (v.side === 'e' ? 'vehe' : 'veh') : v.side === 'e' || v.swim || vehWater(v.x, v.y) || (x != null && vehWater(x, y)) ? 'amph' : 'veh';
const vehSp = v => VEH_SPEC[v.type] || VEH_SPEC.tank;
// 型号：进攻方按解放军装备、守方按美军装备；沙盒按目录条目（同一车型可有改型）
const VEH_MODEL = {
  p: { lt_tank: 'ZTQ-15 轻型坦克', tank: 'ZTZ-96B 主战坦克', hv_tank: 'ZTZ-99A 主战坦克', amtank: 'ZTD-05 两栖突击车', apc: 'ZBD-05 两栖步兵战车', spg: 'PLZ-07 自行榴弹炮', td: 'PTL-02 突击炮',
    aa_veh: 'PGZ-07 自行高炮', sam_veh: 'PGL-625 弹炮防空车', recon: '08 式侦察车', flame_tank: 'ZBD-04A 温压火箭突击车', mine_tank: '96 式扫雷坦克', abv: 'ZBD-03 伞兵战车' },
  e: { lt_tank: 'M10 布克轻型坦克', tank: 'M1A1 艾布拉姆斯', hv_tank: 'M1A2 SEPv3 艾布拉姆斯', amtank: 'AAV-7 两栖突击车', apc: 'M2A3 布雷德利', spg: 'M109A7 帕拉丁', td: 'M1134 斯特赖克反坦克车',
    aa_veh: 'M163 火神自行高炮', sam_veh: 'M-SHORAD 防空车', recon: 'M1127 斯特赖克侦察车', flame_tank: 'M1150 突击破障车', mine_tank: 'M1150 突击破障车（扫雷）' }
};
const vehModel = v => { if (v.mdl) return v.mdl; const c = v.sbxV && typeof catalogById === 'function' && catalogById(v.sbxV); return (c && c.name) || (VEH_MODEL[v.side] || VEH_MODEL.p)[v.type] || vehSp(v).name; };   // mdl：个别车辆的型号名（空投的 JLTV、复仇者等）
const vehName = v => (v.side === 'e' ? '敌' : '') + vehModel(v) + (v.side === 'p' && v.label ? ' ' + v.label : '');
// 车组人数：坦克也算人数（在场兵力、态势报告、双方兵力估计与兵力比都计入）
const vehCrew = v => (VEH_SPEC[v.type] || VEH_SPEC.tank).crew || 3;
const vehCrewOf = (side, f) => (S && S.veh || []).reduce((a, v) => a + (v.side === side && !v.dead && !v.lst && (!f || f(v)) ? vehCrew(v) : 0), 0);
const vehWater = (x, y) => isWater(typeAt(x, y));
const vehPass = (x, y, cls) => stepCost(ci(x, y), cls) < Infinity;
const vehAng = a => Math.atan2(Math.sin(a), Math.cos(a));

function addVehicle(side, type, x, y, extra) {
  if (!S.veh) S.veh = [];
  if (!VEH_SPEC[type]) type = 'tank';
  const sp = VEH_SPEC[type], cls = side === 'e' ? (sp.amph ? 'amph' : 'vehe') : sp.amph ? 'amph' : 'veh';
  if (TER && !vehPass(x, y, cls)) { const j = nearestPassable(ci(x, y), cls); if (j >= 0) { x = cellCX(j); y = cellCY(j); } }
  const n = S.veh.filter(o => o.side === side && o.type === type).length + 1, face = side === 'e' ? SOUTH : NORTH;
  const v = {
    id: S.nid++, side, type, x, y, heading: face, aim: face, hp: sp.hp, maxhp: sp.hp, armor: sp.armor, order: { t: 'hold' }, auto: side === 'e',
    dead: false, cd: 1 + Math.random() * 2, mcd: Math.random(), sup: 0, ammo: sp.ammo, label: sp.code + '-' + n, movedT: -99, fireT: -99, hitT: -99,
    immob: false, burn: 0, plan: null, think: Math.random() * 1.5, odo: 0, fuel: 1, swim: false, ride: [], kx: null, ky: null, kh: null, seen: -99, ...extra
  };
  if (extra && extra.mod) v.mod = { ...extra.mod };
  S.veh.push(v);
  VEHC.t = -1;
  return v;
}

// —— 伤害：穿深对装甲；轻武器只压制乘员；残骸留作掩体；乘员有机会弃车逃生 ——
const vehPenMul = (pen, armor) => pen >= armor ? 1 : pen >= armor - 1 ? .3 + .7 * (pen - armor + 1) : .06;
function vehDamage(v, dmg, pen, sx, sy, src) {
  if (!v || v.dead || !(dmg > 0)) return 0;
  const M = v.mod || {}, top = src === 'atgm' || src === 'top', hull = !top && v.order.t === 'hold' && S.t - v.movedT > 4 && !v.swim ? .75 : 1;   // 坚守：车体半埋（hull-down）；攻顶的反坦克导弹不吃这个
  const d = dmg * vehPenMul(pen, v.armor) * hull / (M.arm || 1);
  v.hp -= d; v.hitT = S.t; v.sup = Math.min(100, v.sup + 12 + d * 3);
  if (src === 'mine' || (d > 5 && Math.random() < .12)) {
    if (!v.immob && !vehSp(v).wheel && !v.swim && Math.random() < (src === 'mine' ? .65 : .5)) {
      v.immob = true; v.immobT = S.t;
      if (v.side === 'p' && v.hp > 0) log(`${vehName(v)}履带被打断，无法机动`, 'bad', 'vimm' + v.id, 20, v);
    }
  }
  if (v.hp > 0 && v.hp < v.maxhp * .3 && !v.burn && d > 2 && Math.random() < .3) v.burn = 6 + Math.random() * 8;   // 起火
  if (v.hp <= 0) vehKill(v, src);
  return d;
}

function vehKill(v, src) {
  if (v.dead) return;
  Object.assign(v, { hp: 0, dead: true, deadT: S.t, moving: false, burn: 0, kx: v.x, ky: v.y, kh: v.heading });
  VEHC.t = -1;
  S.fx.push({ kind: 'boom', x: v.x, y: v.y, r: 22, life: 0, max: 1.3, side: v.side });
  if (!v.swim) addCrater(v.x, v.y, 9);   // 残骸：留作掩体（弹坑格提供掩护）
  vehDropRiders(v, true);
  // 乘员弃车：陆上约一半机会（两人逃出），泅渡中沉没则全员损失；伤亡按车组人数计
  const bail = !v.swim && Math.random() < .5 && passInf(v.x, v.y), cw = vehCrew(v);
  if (v.side === 'p') {
    S.stats.lost += bail ? Math.max(0, cw - 2) : cw;
    log(`${vehName(v)}被击毁${v.swim ? '，沉入海中' : bail ? '，乘员弃车' : ''}`, 'bad', null, 0, v);
    if (bail) {
      const u = addUnit('p', 'inf', { ship: v.label, emblem: 'crew', face: v.heading, auto: true });
      addTeam('p', v.x - Math.cos(v.heading) * 10, v.y - Math.sin(v.heading) * 10, ['radio', 'rifle'], { unit: v.label, u: u.id, ammo: 30, sup: 60, hitT: S.t });
    }
  } else {
    S.stats.killed += bail ? Math.max(0, cw - 2) : cw; S.stats.structs++;
    log(inVision(v.x, v.y) ? `击毁${vehModel(v)}` : `远处殉爆，疑似敌${vehModel(v)}被毁`, 'good', null, 0, v);
    if (bail) {   // 敌乘员编入最近据点的预备队
      const p = vehNearPt(v.x, v.y), u = p && typeof aiUnitFor === 'function' ? aiUnitFor(p.key) : null;
      addTeam('e', v.x - Math.cos(v.heading) * 10, v.y - Math.sin(v.heading) * 10, ['rifle', 'rifle'], { role: 'reserve', obj: p && p.key, u: u && u.id, sup: 60, hitT: S.t });
    }
  }
}

// 轻武器：只压制乘员（射速、命中下降），armor 0 才会受伤；带反坦克手段（mod.at）的小组能造成伤害
function vehSmallArms(v, q, acc) {
  const M = modOf(q);
  for (const m of q.men) {
    if (m === 'eng') continue;
    v.sup = Math.min(100, v.sup + (m === 'mg' ? 5 : 2.5) * (M.sup || 1));
    if (v.armor < 1 && Math.random() < (m === 'mg' ? .25 : .12) * acc) vehDamage(v, 1, 0, q.x, q.y, 'small');
  }
  if (M.at && Math.random() < .35 * acc * Math.min(2, M.at)) vehDamage(v, ((M.atPen || 0) >= 3.4 ? 22 : 13) * M.at, M.atPen || 2.4, q.x, q.y, (M.atPen || 0) >= 3.4 ? 'top' : 'at');   // atPen：攻顶的红箭-12 / 标枪 3.4，打得穿主战坦克顶甲
  v.hitT = S.t;
}
// 碉堡机枪：对轻装甲（armor ≤ 1）有小概率造成损伤；反坦克炮位（mod.at）是真正的威胁
function vehBunkerHit(v, e, D) {
  const M = modOf(e);
  v.sup = Math.min(100, v.sup + 9); v.hitT = S.t;
  if (v.armor <= 1 && Math.random() < .1 * D.acc * (M.pow || 1)) vehDamage(v, 2.5, 1, e.x, e.y, 'mg');
  if (M.at && Math.random() < .4 * D.acc) vehDamage(v, ((M.atPen || 0) >= 3.4 ? 22 : 15) * M.at, M.atPen || 2.6, e.x, e.y, (M.atPen || 0) >= 3.4 ? 'top' : 'at');
}

// 爆炸（impact 钩子）：舰炮、岸防炮、榴弹炮、炸弹、地雷伤及一切车辆；本方车炮榴弹不误伤本方车辆
function vehImpact(x, y, R0, pw, side) {
  if (!S || !S.veh || !S.veh.length || !pw) return;
  const base = pw.vb != null ? pw.vb : (pw.struct || (pw.ship || 0) * 3);
  if (!(base > 0)) return;
  const pen = pw.pen != null ? pw.pen : pw.struct >= 7 || pw.ship >= 3 ? 3 : pw.ship >= 1.5 ? 2 : 1, r = (R0 || pw.R || 20) + 6;
  for (const v of S.veh) {
    if (v.dead || (pw.veh && v.side === side)) continue;
    const d = dist(x, y, v.x, v.y);
    if (d >= r) continue;
    v.sup = Math.min(100, v.sup + 30 * (1 - d / r));
    vehDamage(v, base * (1 - d / r * .6) * (d < r * .35 ? 1.3 : 1), d < r * .35 ? pen : pen - 1, x, y, 'he');   // 近炸 / 直接命中更狠
  }
}
HOOK.impact.push(vehImpact);

// 车炮榴弹的威力（供 impact 使用）：对碉堡伤害大，杀伤半径中等
const vehPW = (he, side) => ({ men: .5 + .2 * he, ship: .5 * he, struct: 2.4 * he, seg: false, R: 11 + 5 * he, veh: true, pen: 1, side });   // 坦克榴弹：中型坦克杀伤半径约 18，每人基础杀伤 0.8
// 自行火炮的间瞄炮弹走通用炮弹结算（support.js updateShells → POWER[kind]）
if (typeof POWER === 'object' && POWER && !POWER.spg) POWER.spg = { men: .42, ship: 1.5, struct: 4, seg: false, R: 24 };
const vehNearPt = (x, y) => { let b = null, bd = Infinity; for (const p of S.points) { const d = dist(p.x, p.y, x, y); if (d < bd) { bd = d; b = p; } } return b; };

// —— 机动：直线畅通时直驶，否则沿流场（目标量化到 20 格减少流场重算）；转向有角速度，大角度时原地转向；近距离后撤时倒车 ——
// 直线是否畅通：途经格均可通行且不慢（避开林地/沼泽，避开已知雷区）
function vehLine(x0, y0, x1, y1, cls) {
  const n = Math.ceil(dist(x0, y0, x1, y1) / 8);
  const lim = cls === 'amph' ? 1.75 : 1.6;   // 两栖：海面泅渡也算畅通
  for (let s = 1; s <= n; s++) if (!(stepCost(ci(lerp(x0, x1, s / n), lerp(y0, y1, s / n)), cls) <= lim)) return false;
  return true;
}
// 沿流场往前看两格（更顺滑的转向）；两格外的点直线过去会擦过不可通行的格（河、悬崖的拐角）就只看一格——免得车顶着拐角原地打转
function vehLook(f, x, y, cls) {
  const a = nextStep(f, x, y);
  if (!a) return null;
  const b = nextStep(f, a[0], a[1]);
  if (!b) return a;
  return !cls || vehClear(x, y, b[0], b[1], cls) ? b : a;
}
const vehClear = (x0, y0, x1, y1, cls) => { const n = Math.ceil(dist(x0, y0, x1, y1) / 4); for (let k = 1; k <= n; k++) if (stepCost(ci(lerp(x0, x1, k / n), lerp(y0, y1, k / n)), cls) === Infinity) return false; return true; };
// 远距离寻路用量化的目标点（>60 量化到 30，>240 量化到 80）：多辆车、多次下令共用流场缓存（每张流场要整图算一遍）；量化点不通时退回精确目标
function vehField(v, x, y, cls) {
  const i = ci(v.x, v.y), d = dist(v.x, v.y, x, y);
  if (d > 60) { const q = d > 240 ? 80 : 30, f = field(Math.round(x / q) * q, Math.round(y / q) * q, cls); if (f && isFinite(f[i])) return f; }
  return field(x, y, cls);
}
// 下令：检查可达（车辆所在格与目标同属一片连通区域，grid.js reachable——不为判断可达整图算流场）
const vehReach = (v, x, y) => reachable(v.x, v.y, x, y, vehCls(v, x, y));
// 近距离绕行（100 以内、直线不畅）：小窗口局部流场取前方两格，0.6 秒更新一次；窗口里不通返回 null（改用全图流场）
function vehLocalStep(v, o, cls) {
  const c = v.lp;
  if (c && c.ox === o.x && c.oy === o.y && S.t - c.t < .6 && dist(v.x, v.y, c.x, c.y) > 4) return [c.x, c.y];
  const L = localField(v.x, v.y, o.x, o.y, cls);
  if (!L || !isFinite(localAt(L, v.x, v.y))) { v.lp = null; return null; }
  let a = localNext(L, v.x, v.y);
  if (!a) { v.lp = null; return null; }
  const b = localNext(L, a[0], a[1]);
  if (b && vehLine(v.x, v.y, b[0], b[1], cls)) a = b;
  v.lp = { x: a[0], y: a[1], t: S.t, ox: o.x, oy: o.y };
  return a;
}
function vehSetOrder(v, t, x, y, face) {
  if (t === 'hold' || x == null) { v.order = { t: 'hold', face: face ?? v.order.face }; return true; }
  const rx = x, ry = y;
  x = clamp(x, 8, W - 8); y = clamp(y, 8, H - 8);
  const cls = vehCls(v, x, y);
  if (!vehPass(x, y, cls)) { const j = nearestPassable(ci(x, y), cls); if (j < 0) return false; x = cellCX(j); y = cellCY(j); }
  if ((v.auto || v.side === 'e') && t !== 'clear') [x, y] = vehFreeSpot(v, x, y, cls);
  v.order = { t, x, y, face, rx, ry }; v.pathT = -9; v.stuckT = 0;
  return true;
}
// 自动车辆不扎堆：去向 22 以内已有本方车辆停着、或别的车正开往那里，就在周围 26 / 40 / 54 的环上找最近的空位
function vehFreeSpot(v, x, y, cls) {
  const taken = (px, py) => S.veh.some(o => o !== v && !o.dead && o.side === v.side && !o.lst &&
    ((o.order.x != null && o.order.t !== 'hold' ? dist(o.order.x, o.order.y, px, py) : dist(o.x, o.y, px, py)) < 22));
  if (!taken(x, y)) return [x, y];
  for (const r of [26, 40, 54]) for (let k = 0; k < 8; k++) {
    const a = (k + (v.id % 8) * .5) * Math.PI / 4, px = clamp(x + Math.cos(a) * r, 8, W - 8), py = clamp(y + Math.sin(a) * r, 8, H - 8);
    if (vehPass(px, py, cls) && !taken(px, py)) return [px, py];
  }
  return [x, y];
}

function vehDrive(v, dt, mul) {
  const o = v.order, sp = vehSp(v);
  v.moving = false;
  if (v.immob || v.lst || v.fixed) return;   // fixed：机场等固定阵地上的防空装备，不机动
  if (o.t === 'hold' || o.x == null) {   // 停车：转向指定朝向（坚守时车体正对威胁）
    if (o.face != null) v.heading += clamp(vehAng(o.face - v.heading), -sp.turn * .6 * dt, sp.turn * .6 * dt);
    vehSpread(v, dt);
    return;
  }
  const d = dist(v.x, v.y, o.x, o.y), cls = vehCls(v, o.x, o.y);
  if (d < 5) { v.order = { t: 'hold', face: o.face, was: o.t }; v.arrT = S.t; return true; }
  // 目标点已被本方别的车停着占了：到了附近就算到位（不绕着别人的车打转）
  if (d < 32 && S.veh.some(o2 => o2 !== v && !o2.dead && o2.side === v.side && !o2.lst && o2.order.t === 'hold' && dist(o2.x, o2.y, o.x, o.y) < (sp.len + vehSp(o2).len) * .5 + 6)) { v.order = { t: 'hold', face: o.face, was: o.t }; v.arrT = S.t; v8Stat('vehArrOcc'); return true; }
  // 进展看门狗：6 秒内离目标没近 6 以上（又不是在等敌步兵、撞障碍、没油）——近的就地停下，远的换条路
  const PG = v.pg && v.pg.ox === o.x && v.pg.oy === o.y ? v.pg : (v.pg = { ox: o.x, oy: o.y, d, t: S.t });
  if (d < PG.d - 6) { PG.d = d; PG.t = S.t; }
  else if (S.t - PG.t > 6 && !v.blk && S.t >= (v.stallT || 0) && (v.fuel ?? 1) > 0) {
    PG.d = d; PG.t = S.t; v8Stat('vehNoProg');
    if (d < 70) { v.order = { t: 'hold', face: o.face, was: o.t }; v.arrT = S.t; return true; }
    v.pathT = -9; v.direct = false; v.fpth = null; v.sideT = S.t + 2.5; v.sideS = v.id % 2 ? 1 : -1;   // 换路：先侧向让开 2.5 秒
  }
  if (S.t < (v.stallT || 0)) return;
  if ((v.fuel ?? 1) <= 0) { if (v.side === 'p') log(`${vehName(v)}油料耗尽，原地停车待补`, 'bad', 'vfuel' + v.id, 30, v); return; }   // 油尽：能打不能走
  if (d > 20 && vehBlocked(v, o)) return;   // 前方是没被压住的敌步兵：停车以火力解决
  if (S.t - (v.pathT ?? -9) > 1) { v.pathT = S.t; v.direct = vehLine(v.x, v.y, o.x, o.y, cls); }
  let tx = o.x, ty = o.y;
  const ln = !v.direct && d > 14 && d <= 100 ? vehLocalStep(v, o, cls) : null;
  if (ln) [tx, ty] = ln;
  else if (!v.direct && d > 14) {   // 沿路点走（grid.js pathStep：取一次流场管 50 格，不每帧查整图流场）
    const r = pathStep(v, o.x, o.y, cls, () => vehField(v, o.x, o.y, cls), (x0, y0, x1, y1) => vehClear(x0, y0, x1, y1, cls));
    if (r && r.no && vehPass(v.x, v.y, cls)) { v.order = { t: 'hold', face: o.face }; if (v.side === 'p' && !v.auto) log(`${vehName(v)}无法到达目标位置`, 'warn', 'vunr', 3, v); return; }
    if (r && r.x != null) [tx, ty] = [r.x, r.y];
  }
  let want = Math.atan2(ty - v.y, tx - v.x);
  if (S.t < (v.sideT ?? 0)) want += v.sideS * 1.1;   // 侧向让开（看门狗 / 前方有本方车辆）
  // 与本方车辆保持间距：前方有车就转向绕开、靠得太近就减速停车让行——车只沿车头方向走，不横着平移（以前侧推车身，看着像滑步）
  let slow = 1, park = null;
  { const fx = Math.cos(v.heading), fy = Math.sin(v.heading);
    for (const o2 of S.veh) {
      if (o2 === v || o2.dead || o2.side !== v.side || o2.lst) continue;
      const dx = o2.x - v.x, dy = o2.y - v.y, d2 = Math.hypot(dx, dy), m = (sp.len + vehSp(o2).len) * .5 + 6;
      if (d2 > m + 12 || d2 < .01) continue;
      const along = (dx * fx + dy * fy) / d2, lat = (dy * fx - dx * fy) / d2;
      if (along < .25) continue;   // 在侧后方：由对方让
      want -= (Math.abs(lat) < .15 ? 1 : Math.sign(lat)) * clamp((m + 12 - d2) / 12, 0, 1) * along * .9;   // 正前方偏哪边就往另一边转；正对着一律右转错开
      // 让行：编号小的先走；停着的车只让真正停下的（自己也在让行的不算——两车互相等就谁也走不了）
      const parked = !o2.moving && !(o2.yieldT > 0) && (o2.order.t === 'hold' || o2.order.x == null);
      if (d2 < m && (v.id > o2.id || parked)) { slow = Math.min(slow, clamp((d2 - m * .55) / (m * .45), 0, 1)); if (parked && along > .6) park = o2; }
    } }
  // 倒车：后撤且距离近，或目标就在身后不远
  let da = vehAng(want - v.heading), dir = 1;
  if ((o.t === 'retreat' && d < 110 && Math.abs(da) > 1.6) || (Math.abs(da) > 2.5 && d < 45)) { dir = -1; da = vehAng(want + Math.PI - v.heading); }
  const turn = sp.turn * (v.swim ? .6 : 1) * dt;
  v.heading += clamp(da, -turn, turn);
  const t = TER.type[ci(v.x, v.y)], climb = v.climbT != null && S.t - v.climbT < 2.5 ? .5 : 1;
  const tk = sp.swimK && isWater(t) ? (v.side === 'e' ? .6 : sp.swimK) : t === T.RIVER ? (sp.amph ? RIVER_WADE.amph : RIVER_WADE.veh) : VEH_TSP[t];   // 水上：ZTD-05 滑行艇体，航速与登陆艇相当；守方 AAV-7 只有约一半
  let vel = sp.speed * (tk || .4) * climb * (v.sup > 60 ? .75 : 1) * ((v.mod && v.mod.spd) || 1) * mul * (dir < 0 ? .45 : 1);
  vel *= Math.abs(da) > 1 ? .12 : 1 - Math.abs(da) * .55;   // 大角度时原地转向
  if (v.cmd && v.cmd.cap && S.t < (v.cmd.until ?? 0)) vel = Math.min(vel, v.cmd.cap);   // 营的队形整体移动：车速跟锚点（hq.js regOrder）
  if (slow < 1 && dir > 0) {   // 前车挡着：让行，等太久就侧绕
    v.yieldT = (v.yieldT || 0) + dt;
    if (park && v.yieldT > 1.5) vehGiveWay(park, v);
    if (v.yieldT > 3 && S.t >= (v.sideT ?? 0)) { v.sideT = S.t + 1.5; v.sideS = v.id % 2 ? 1 : -1; v.yieldT = 0; }
  } else v.yieldT = 0;
  const step = Math.min(vel * dt * (dir > 0 ? slow : 1), d);
  const nx = v.x + Math.cos(v.heading) * dir * step, ny = v.y + Math.sin(v.heading) * dir * step;
  const here = vehPass(v.x, v.y, cls);
  const axis = (x, y) => { v.heading += clamp(vehAng(Math.atan2((y - v.y) * dir, (x - v.x) * dir) - v.heading), -turn, turn); v.x = x; v.y = y; };   // 沿墙滑过时车头跟着转向实际走的方向
  if (vehPass(nx, ny, cls) || !here) { v.x = nx; v.y = ny; }
  else if (vehPass(nx, v.y, cls)) axis(nx, v.y);   // 斜穿格角受阻时沿单轴滑过
  else if (vehPass(v.x, ny, cls)) axis(v.x, ny);
  else {   // 正前方被格角挡住（寻路的前瞻点斜着过墙角）：依次试左右偏 30° / 60° / 90°，哪边能走先从哪边绕过去
    const st2 = Math.max(step, sp.speed * .25 * dt), sg = v.id % 2 ? 1 : -1;
    let ok = false;
    for (const a2 of [.52, -.52, 1.05, -1.05, 1.57, -1.57]) {
      const h2 = v.heading + a2 * sg, mx = v.x + Math.cos(h2) * dir * st2, my = v.y + Math.sin(h2) * dir * st2;
      if (vehPass(mx, my, cls)) { v.x = mx; v.y = my; v.heading += clamp(a2 * sg, -turn, turn); ok = true; break; }
    }
    if (!ok) { v.stuckT = (v.stuckT || 0) + dt; if (v.stuckT > 4) { v.pathT = -9; v.direct = false; v.stuckT = 0; } return; }
    v8Stat('vehSlide');
  }
  v.heading = vehAng(v.heading);
  v.moving = step > .01; v.movedT = S.t; v.odo += step * dir;
  v.fuel = Math.max(0, (v.fuel ?? 1) - step * (v.swim ? (sp.swimK ? 1.2 : 2) : 1) / (sp.fuel || 5000));   // 泅渡耗油：ZTD-05 喷水推进 1.2 倍，其余 2 倍
  return false;
}

// 让路：停着的自动车辆挡住了本方行进中的车，往对方去路的侧面挪开 30（滩头出口、路口不再堵成一团）；玩家亲自下令停着的车不动
function vehGiveWay(o, v) {
  if (!o.auto || o.man || o.fixed || o.immob || o.lst || S.t < (o.gwT ?? -99)) return;
  o.gwT = S.t + 6;
  const fx = Math.cos(v.heading), fy = Math.sin(v.heading), s = Math.sign((o.y - v.y) * fx - (o.x - v.x) * fy) || (o.id % 2 ? 1 : -1), cls = vehCls(o);
  for (const k of [30, 45, -30]) {
    const x = o.x - fy * k * s + fx * 6, y = o.y + fx * k * s + fy * 6;
    if (vehPass(x, y, cls)) { vehSetOrder(o, 'move', x, y, o.order.face ?? o.heading); v8Stat('vehGiveWay'); return; }
  }
}
// 车身重叠（中心距不到两车半长之和的 0.8）：各自沿连线挪开，每秒最多 10——挤在一起的车不会叠成一团、互相卡死
function vehSep(v, dt) {
  if (v.lst || v.ramp || v.swim || v.immob || v.fixed) return;
  const sp = vehSp(v), cls = vehCls(v);
  let px = 0, py = 0;
  for (const o of S.veh) {
    if (o === v || o.dead || o.side !== v.side || o.lst || o.ramp) continue;
    const dx = v.x - o.x, dy = v.y - o.y;
    if (Math.abs(dx) > 30 || Math.abs(dy) > 30) continue;
    const d = Math.hypot(dx, dy), m = (sp.len + vehSp(o).len) * .4;
    if (d >= m) continue;
    const a = d > .3 ? Math.atan2(dy, dx) : v.id * 2.4;
    px += Math.cos(a) * (m - d) * .5; py += Math.sin(a) * (m - d) * .5;
  }
  const l = Math.hypot(px, py);
  if (l < .05) return;
  const k = Math.min(l, 10 * dt) / l, nx = v.x + px * k, ny = v.y + py * k;
  if (vehPass(nx, ny, cls)) { v.x = nx; v.y = ny; }
}
// 停着的车与本方车辆贴得太近（车身间隙不足 4）：编号大的那辆每秒挪开 6，把已经挤成一团的慢慢摊开
function vehSpread(v, dt) {
  if (v.immob || v.lst || v.swim) return;
  const sp = vehSp(v), cls = vehCls(v);
  for (const o of S.veh) {
    if (o === v || o.dead || o.side !== v.side || o.lst || o.id > v.id) continue;
    const d = dist(v.x, v.y, o.x, o.y), m = (sp.len + vehSp(o).len) * .5 + 4;
    if (d >= m) continue;
    // 只沿车身前后挪（倒车或前进），对方正好在侧面时先原地转一点车头——不横着平移
    const a = d > .5 ? Math.atan2(v.y - o.y, v.x - o.x) : v.id * 2.4, s = Math.cos(a - v.heading);
    if (Math.abs(s) < .35) { v.heading = vehAng(v.heading + sp.turn * .5 * dt * (Math.sin(a - v.heading) > 0 ? -1 : 1)); return; }
    const st = Math.min(m - d, 6 * dt) * Math.sign(s), nx = v.x + Math.cos(v.heading) * st, ny = v.y + Math.sin(v.heading) * st;
    if (vehPass(nx, ny, cls)) { v.x = nx; v.y = ny; v.moving = true; v.odo += Math.abs(st); }
    return;
  }
}
// 不冲进步兵堆：自动车辆（守方全部）前方 70 以内（反坦克组 110）有看得见、没被压住（压制 < 60）的敌步兵，
// 身边 40 以内又没有本方步兵掩护时，停车以火力解决，敌人被压住、打散或步兵跟上再走；后撤不受限。每 0.5 秒判一次
function vehBlocked(v, o) {
  if (o.t === 'retreat' || o.t === 'clear' || !(v.auto || v.side === 'e') || v.swim) return false;
  if (S.t < (v.blkN ?? 0)) return !!v.blk;
  v.blkN = S.t + .5; v.blk = false;
  if (S.teams.some(q => q.side === v.side && q.men.length && !q.ride && dist(q.x, q.y, v.x, v.y) < 40)) return false;
  const want = Math.atan2(o.y - v.y, o.x - v.x), dO = dist(v.x, v.y, o.x, o.y), foe = v.side === 'p' ? 'e' : 'p';
  for (const q of S.teams) {
    if (q.side !== foe || !q.men.length || q.ride || q.sup >= 60) continue;
    const d = dist(q.x, q.y, v.x, v.y);
    if (d > (modOf(q).at ? 110 : 70) || !vehSees(v, q.x, q.y, d)) continue;
    if (angDiff(Math.atan2(q.y - v.y, q.x - v.x), want) < 1.2 && dist(q.x, q.y, o.x, o.y) < dO + 30) { v.blk = true; v.blkQ = q.id; v8Stat('vehBlk'); break; }
  }
  return v.blk;
}

// 地形后果：泅渡/上岸、碾过铁丝网、撞上未发现的障碍、反坦克地雷；扫雷坦克连枷引爆地雷
function vehTerrain(v, dt) {
  const i = ci(v.x, v.y), t = TER.type[i], sp = vehSp(v), water = isWater(t);
  if (v.swim && !water) { v.climbT = S.t; if (v.side === 'p') log(`${vehName(v)}爬上滩头`, 'good', 'vclimb', 6, v); }
  v.swim = water;
  if (!v.moving || i === v.cell) { v.cell = i; return; }
  v.cell = i;
  if (WIREC[i] && !sp.wheel) for (const w of S.wire) if (!w.cut && segDist(v.x, v.y, w.x0, w.y0, w.x1, w.y1) < 7) {
    w.cut = true; w.known = true; rebuildForts();
    if (v.side === 'p') log(`${vehName(v)}碾开一段铁丝网`, 'good', 'vwire', 6, v);
  }
  if (OBSC[i] === 1) for (const o of S.obst) if (!o.dead && dist(o.x, o.y, v.x, v.y) < 9) {
    o.known = true; rebuildForts(); v.stallT = S.t + 2; vehDamage(v, 1.5, 3, o.x, o.y, 'obst');
    if (v.side === 'p') log(`${vehName(v)}被反登陆障碍卡住`, 'warn', 'vobst', 6, v);
  }
  if (!MINEC[i]) return;
  const m = S.mines.find(m => m.clr < 1 && dist(m.x, m.y, v.x, v.y) < m.r);
  if (!m) return;
  if (sp.flail) {   // 连枷扫雷：沿途引爆，逐步清空雷区
    m.clr = Math.min(1, m.clr + .1); if (!m.known) { m.known = true; }
    if (Math.random() < .5) S.fx.push({ kind: 'boom', x: v.x + Math.cos(v.heading) * 12 + gauss() * 3, y: v.y + Math.sin(v.heading) * 12 + gauss() * 3, r: 7, life: 0, max: .5, side: v.side });
    if (m.clr >= 1) log('扫雷坦克清出一条通路，雷区已清除', 'good', null, 0, m);
    rebuildForts();
    return;
  }
  const known = MINEC[i] === 2, p = (v.side === 'e' ? .02 : .12) * (1 - m.clr);
  if (Math.random() >= p) return;
  S.fx.push({ kind: 'boom', x: v.x, y: v.y, r: 14, life: 0, max: .8, side: 'e' });
  m.clr = Math.min(1, m.clr + .05);
  if (!m.known) { m.known = true; rebuildForts(); }
  if (v.side === 'p') log(`${vehName(v)}触发反坦克地雷${known ? '' : '，雷区已标定'}`, 'bad', 'vmine' + v.id, 6, v);
  vehDamage(v, 16 + Math.random() * 14, 3, v.x, v.y, 'mine');
}

// —— 火力：主炮（直瞄榴弹/穿甲、间瞄、火焰）与并列/高射机枪 ——
const vehSees = (v, x, y, d) => d < 45 || (v.side === 'p' ? PV : EV)[ci(x, y)] === 1;
// 主炮目标评分：威胁 / 价值，除以距离；穿甲炮偏好装甲，喷火偏好碉堡与战壕
function vehGunTarget(v) {
  const sp = vehSp(v), g = sp.gun;
  if (!g || v.ammo <= 0) return null;
  const M = v.mod || {}, R0 = g.range * (M.rng || 1), foe = v.side === 'p' ? 'e' : 'p', at = g.ap >= 3;
  // 坦克优先打坦克：射程内看得见的敌方有炮车辆（坦克、坦克歼击车、自行火炮）与守军装甲车压倒一切目标；
  // 打不穿的（穿深远不及装甲，如轻型坦克对重型坦克）不算，留给反坦克火力
  if (!g.flame && !g.ind) {
    let arm = null, as = 0;
    const armor = (t, k, x, y, a, w) => {
      const d = dist(v.x, v.y, x, y);
      if (d > R0 || !vehSees(v, x, y, d) || vehPenMul(g.ap * (M.pow || 1), a) < .25) return;
      const s = w / (1 + d / R0);
      if (s > as) { as = s; arm = { t, k, x, y, d }; }
    };
    for (const o of vehFoes(v.side)) if (vehSp(o).gun && !o.lst) armor(o, 'veh', o.x, o.y, o.armor, o.type === 'hv_tank' || o.type === 'td' ? 1.3 : 1);
    if (v.side === 'p' && S.armor) for (const a of S.armor) if (!a.dead) armor(a, 'car', a.x, a.y, 1, .9);
    if (arm) return arm;
  }
  let best = null, bs = 0;
  const consider = (t, k, x, y, val) => {
    const d = dist(v.x, v.y, x, y);
    if (d > R0 || (g.min && d < g.min)) return;
    if (!g.ind && !vehSees(v, x, y, d)) return;
    const eng = v.esc && v.esc.eng && S.t < v.esc.eng.until && dist(x, y, v.esc.eng.x, v.esc.eng.y) < 25;   // 步坦协同：优先打压制伙伴步兵的火力点
    const s = val / (1 + d / R0) * (eng ? 2.2 : 1);
    if (s > bs) { bs = s; best = { t, k, x, y, d }; }
  };
  if (!g.flame) {
    for (const o of vehFoes(v.side)) consider(o, 'veh', o.x, o.y, (vehSp(o).gun ? 3.2 : 2) * (at ? 2 : 1));
    if (v.side === 'p' && S.armor) for (const a of S.armor) if (!a.dead) consider(a, 'car', a.x, a.y, 2.6 * (at ? 1.6 : 1));
  }
  if (v.side === 'p') for (const e of S.enemies) {
    if (e.dead) continue;
    if (g.ind) { if (e.kx != null) consider(e, 'st', e.kx, e.ky, ({ arty: 3, mortar: 3, coastal: 2.6, bunker: 2.2, aa: 1.6 })[e.kind] || 1.5); continue; }
    let val = ({ bunker: 3, coastal: 2.4, mortar: 2, arty: 2, aa: 1.4 })[e.kind] || 1.5;
    if (e.kind === 'bunker' && S.teams.some(q => q.side === 'p' && q.sup > 40 && dist(q.x, q.y, e.x, e.y) < 180)) val += 2;   // 正在压制我方步兵的碉堡
    consider(e, 'st', e.x, e.y, val * (g.flame ? 1.6 : at ? .7 : 1));
  }
  if (!g.ind && typeof afgList === 'function') for (const a of afgList(v.side)) consider(a, 'ac', a.x, a.y, a.k === 'has' ? 1.2 : 2.2);   // 机场上停放的敌机（afgnd.js）
  if (!(at && v.type === 'td') || g.ind) for (const q of S.teams) if (q.side === foe && q.men.length && !q.ride) {   // 重型坦克也用榴弹打步兵，只有坦克歼击车专打装甲
    if (g.ind && !(q.side === 'e' ? inVision(q.x, q.y) : spotted(q.x, q.y))) continue;
    if (v.cons && !g.ind && dist(v.x, v.y, q.x, q.y) > 80) continue;   // 节约弹药：主炮只打车辆、工事与贴近的步兵，远处的步兵交给机枪
    let near = 0;   // 一发榴弹能罩住的人数：成堆的步兵优先
    for (const o of S.teams) if (o !== q && o.side === foe && o.men.length && !o.ride && dist(o.x, o.y, q.x, q.y) < 22) near += o.men.length;
    consider(q, 'tm', q.x, q.y, (1 + q.men.length * .2 + near * .12) * (g.flame && q.inTrench ? 2.4 : 1) * (g.ind ? .6 : 1) * (at ? .8 : 1));
  }
  return best;
}
// 机枪目标：射程内最近的可见敌小组（贴近 60 以内的优先）
function vehMgTarget(v) {
  const sp = vehSp(v);
  if (!sp.mg) return null;
  const foe = v.side === 'p' ? 'e' : 'p', R0 = sp.mg.range * ((v.mod && v.mod.rng) || 1);
  let best = null, bd = R0;
  for (const q of S.teams) if (q.side === foe && q.men.length && !q.ride) {
    const d = dist(v.x, v.y, q.x, q.y);
    if (d < bd && vehSees(v, q.x, q.y, d)) { bd = d; best = { t: q, k: 'tm', x: q.x, y: q.y, d }; }
  }
  return best;
}
// 友军离落点太近（危险近距）就不打榴弹
const vehDanger = (v, x, y, r) => S.teams.some(q => q.side === v.side && q.men.length && !q.ride && dist(q.x, q.y, x, y) < r);

function vehShoot(v, tg) {
  const sp = vehSp(v), g = sp.gun, M = v.mod || {}, D = aiD();
  const moving = S.t - v.movedT < .4;
  v.cd = g.rof * (1 + v.sup / 120) / (M.rof || 1) * (.9 + Math.random() * .2) * (v.cons ? 1.4 : 1);   // 节约弹药时放慢射速
  v.ammo--; v.fireT = S.t; v.aimT = S.t;
  if (v.side === 'p') S.stats.shots++;
  const mx = v.x + Math.cos(v.aim) * (sp.bar + sp.len * .1), my = v.y + Math.sin(v.aim) * (sp.bar + sp.len * .1);
  if (!S.vshots) S.vshots = [];
  if (g.flame) {   // 火焰：无视掩体，对碉堡与战壕毁灭性
    S.vshots.push({ k: 'flame', x0: mx, y0: my, x1: tg.x, y1: tg.y, t: 0, dur: .7, side: v.side });
    if (tg.k === 'st') { damageEnemy(tg.t, 3.2 * (M.pow || 1)); tg.t.sup = 100; }
    else if (tg.k === 'tm') {
      const q = tg.t;
      suppress(q, 45, v.x, v.y);
      for (let k = q.men.length; k > 0; k--) if (Math.random() < .3 * (q.inTrench ? 1.4 : 1) * (M.pow || 1)) killMan(q);
      for (const o of S.teams) if (o !== q && o.side === q.side && o.men.length && dist(o.x, o.y, tg.x, tg.y) < 16) { suppress(o, 30, v.x, v.y); if (Math.random() < .2) killMan(o); }
    } else if (tg.k === 'veh') vehDamage(tg.t, 4, 1, v.x, v.y, 'flame');
    else if (tg.k === 'ac' && typeof afgFlame === 'function') afgFlame(tg.t);
    return;
  }
  if (g.ind) {   // 间瞄：落点散布随距离增大
    const sc = 12 + tg.d * .05, pt = safeAim(v.side, tg.x, tg.y, sc, POWER.spg.R);
    if (!pt) return;   // 危险近距：自己人在落区附近，不开火
    fireShell(mx, my, pt[0], pt[1], v.side, 'spg', 1.6 + tg.d / 400, false);
    S.fx.push({ kind: 'flash', x: mx, y: my, r: 12, life: 0, max: .4, side: v.side });
    return;
  }
  const sz = tg.k === 'st' ? .85 : tg.k === 'tm' ? .7 : (tg.t.moving ? .65 : .9);
  let ph = .82 * (1 - tg.d / g.range * .45) * (moving ? .45 : 1) * (v.swim ? .4 : 1) * (1 - v.sup / 160) * sz * (M.pow || 1) * (v.side === 'e' ? D.acc : 1);
  if (tg.k === 'tm') ph *= SMOKE[ci(tg.x, tg.y)] ? .5 : 1;
  const hit = Math.random() < ph, ap = tg.k === 'veh' || tg.k === 'car';
  const miss = 6 + tg.d * .07, x1 = hit ? tg.x + gauss() * 2 : tg.x + gauss() * miss, y1 = hit ? tg.y + gauss() * 2 : tg.y + gauss() * miss;
  S.vshots.push({ k: ap ? 'ap' : 'he', x0: mx, y0: my, x1, y1, t: 0, dur: Math.max(.08, tg.d / 1100), side: v.side, hit, he: g.he, ap: g.ap, tg: ap ? tg.t.id : null, tk: tg.k, src: v.id });
  S.fx.push({ kind: 'flash', x: mx, y: my, r: 8, life: 0, max: .3, side: v.side });
}

// 炮弹飞行与命中结算
function vehShots(dt) {
  if (!S.vshots || !S.vshots.length) return;
  for (const s of S.vshots) {
    if ((s.t += dt) < s.dur) continue;
    s.done = true;
    if (s.k === 'flame') continue;
    if (s.k === 'he') { impact(s.x1, s.y1, s.hit && s.tk === 'tm' ? { ...vehPW(s.he, s.side), direct: { x: s.x1, y: s.y1 } } : vehPW(s.he, s.side), s.side); continue; }   // 正中小组：掩体只按开方减免（combat.js impact）
    // 穿甲弹：命中则按穿深计算伤害，未命中只在地面溅起尘土
    S.fx.push({ kind: 'flash', x: s.x1, y: s.y1, r: s.hit ? 9 : 5, life: 0, max: .35, side: s.side });
    if (!s.hit) continue;
    const dmg = 12 + s.ap * 7;   // 穿甲弹：主战坦克两发、重型坦克两到三发
    if (s.tk === 'car') { const a = (S.armor || []).find(a => a.id === s.tg); if (a) damageArmor(a, dmg); }
    else { const o = vehById(s.tg); if (o) vehDamage(o, dmg, s.ap, s.x0, s.y0, 'ap'); }
  }
  S.vshots = S.vshots.filter(s => !s.done || (s.k === 'flame' && s.t < s.dur));
}

// 机枪：与小组机枪手相同的压制/杀伤模型；四联高射机枪火力更猛
function vehMg(v, tg) {
  const sp = vehSp(v), m = sp.mg, M = v.mod || {}, D = aiD(), q = tg.t;
  v.mcd = (m.quad ? 1 : 1.2) * (1 + v.sup / 150) / (M.rof || 1);
  v.mgT = S.t;
  const moving = S.t - v.movedT < .4, acc = (1 - tg.d / m.range * .5) * (moving ? .6 : 1) * (1 - v.sup / 140) * (M.pow || 1) * (v.side === 'e' ? D.acc : 1);
  const def = coverAt(q.x, q.y) * shelter(q, v.x, v.y) * (SMOKE[ci(q.x, q.y)] ? .4 : 1);
  if (q.side === 'e') q.hitT = S.t;
  for (let s = 0; s < m.n; s++) {
    suppress(q, (m.quad ? 9 : 8.5) * (M.sup || 1), v.x, v.y);
    if (q.men.length && Math.random() < (m.quad ? .1 : .11) * acc * def) killMan(q, v.side === 'e' && Math.random() < D.radio ? 'radio' : null);
  }
  const vis = v.side === 'p' || inVision(v.x, v.y);
  tracer(v.x, v.y, q.x + gauss() * 5, q.y + gauss() * 5, v.side, vis);
  if (m.n > 3) tracer(v.x, v.y, q.x + gauss() * 8, q.y + gauss() * 8, v.side, vis);
}

// 守军的自行高炮射击我方飞机（我方自行高炮只在出现敌机时开火——本作敌方没有空军）
function vehAA(v, dt) {
  const sp = vehSp(v);
  if (!sp.aa || v.side !== 'e' || !S.planes || !S.planes.length || (v.aaT = (v.aaT || 0) - dt) > 0) return;
  v.aaT = .6;
  for (const p of S.planes) {
    if (p.dead || !(p.alt > .4) || (typeof eaHigh === 'function' && (eaHigh(p) || eaHighUav(p))) || dist(v.x, v.y, p.x, p.y) > sp.aa) continue;   // 巡逻高度上的战斗机、中空的无人机够不着
    tracer(v.x, v.y, p.x + gauss() * 14, p.y + gauss() * 14, 'e', inVision(v.x, v.y));
    v.aim = Math.atan2(p.y - v.y, p.x - v.x); v.mgT = S.t;
    if (Math.random() < .12 * (1 - v.sup / 130) * (typeof airStealth === 'function' ? (1 + airStealth(p)) / 2 : 1) && typeof airLost === 'function') { airLost(p, `${typeof airName === 'function' ? airName(p.kind, p.v) : '我机'}被敌${vehModel(v)}击落`); break; }
  }
}

// 弹炮防空车的防空导弹（每 cd 秒至少间隔一发，载弹 n、每 regen 秒补装一枚；被压制到 80 以上不发射）：
// 先拦来袭导弹——落点在 icp 以内、已过半程的敌战术弹道导弹，或飞到 icp 以内的敌岸舰导弹，每车对每枚导弹只拦一次；
// 再打 range 以内的敌机（每架同时只挂一枚本方导弹）。守方发射会暴露位置
function vehSam(v, dt) {
  const M0 = vehSp(v).sam, M = M0 && v.samX ? { ...M0, ...v.samX } : M0;   // samX：个别车辆的加强（第 101 空降师的复仇者防空车：备弹多、装填快、射程远）
  if (!M || typeof msLaunch !== 'function' || v.lst || v.swim) return;
  if (v.samN == null) v.samN = M.n;
  if (v.samN < M.n && (v.samR = (v.samR || 0) + dt) >= M.regen) { v.samR = 0; v.samN++; }
  if ((v.samCd = (v.samCd || 0) - dt) > 0 || v.samN <= 0 || v.sup >= 80) return;
  const foe = v.side === 'e' ? 'p' : 'e', mine = (k, id) => S.missiles.some(m => m.kind === 'sam' && !m.done && m.side === v.side && m.tgt && m.tgt.k === k && m.tgt.id === id);
  let tg = null, k = null, bd = Infinity;
  for (const m of S.missiles || []) {
    if (m.done || m.t < 0 || m.side !== foe || (m.svTry && m.svTry.includes(v.id))) continue;
    if (m.kind === 'tbm') { if (m.t / m.dur < .5 || dist(v.x, v.y, m.tx, m.ty) > M.icp) continue; }
    else if (m.kind === 'pgm') { const W0 = typeof MS_PGM === 'object' && MS_PGM[m.w]; if (!W0 || !W0.icp || dist(v.x, v.y, m.x, m.y) > M.icp) continue; }   // 巡航导弹（亚音速好打，超音速、高超音速难打）；空地导弹飞行时间太短，来不及
    else if (m.kind !== 'asm' || dist(v.x, v.y, m.x, m.y) > M.icp) continue;
    const d = dist(v.x, v.y, m.x, m.y);
    if (d < bd) { bd = d; tg = m; k = 'msl'; }
  }
  if (tg) (tg.svTry || (tg.svTry = [])).push(v.id);
  else {
    const air = v.side === 'p' ? (S.eair && S.eair.fly || []).filter(a => !a.dead && a.alt > .1) : (S.planes || []).filter(p => !p.dead && p.alt > .25 && !['cat', 'roll', 'trap', 'final'].includes(p.phase));
    for (const a of air) { const d = dist(v.x, v.y, a.x, a.y), st = v.side === 'e' && typeof airStealth === 'function' ? airStealth(a) : 1, rr = M.range * (M.hi ? Math.min(1, st * 1.2) : (1 + st) / 2);   // 隐身：雷达制导（爱国者）发现距离按隐身系数打折，红外制导（毒刺）打折一半
      if (d < rr && d < bd && !(!M.hi && typeof eaHigh === 'function' && eaHigh(a)) && !mine(v.side === 'p' ? 'eair' : 'plane', a.id)) { bd = d; tg = a; } }   // 近程红外弹够不着巡逻高度上的战斗机（hi：爱国者等中远程防空够得着）
    if (!tg) return;
    k = v.side === 'p' ? 'eair' : 'plane';
  }
  msLaunch('sam', v.side, v.x, v.y, { x: tg.x, y: tg.y }, { tgt: { k, id: tg.id }, src: 'samv', spd: 620, dur: 3, pk: (k === 'msl' ? (tg.kind === 'tbm' ? (tg.nuke ? .2 : .5) : tg.kind === 'pgm' ? MS_PGM[tg.w].icp : .55) : .6) * (M.pkK || 1), sup: v.sup });
  v.samN--; v.samCd = M.cd; v.aim = Math.atan2(tg.y - v.y, tg.x - v.x); v.samT = S.t;
  S.fx.push({ kind: 'flash', x: v.x, y: v.y, r: 8, life: 0, max: .4, side: v.side });
  if (v.side === 'e') { v.kx = v.x; v.ky = v.y; v.kh = v.heading; v.seen = S.t; }   // 导弹尾焰暴露发射车
  if (typeof msStat === 'function') msStat(k === 'msl' ? 'samvIcp' : 'samvAir');
}

// —— 每步更新（HOOK.step）——
function updateVehicles(dt) {
  if (!S || S.phase !== 'battle') return;
  vehSelFix();
  for (const s of S.ships) if (s.kind === 'lst') vehLSTTick(s, dt);
  if (!S.veh || !S.veh.length) { vehShots(dt); return; }
  VEHC.t = -1;
  for (const v of S.veh) {
    if (v.dead) continue;
    vehTick(v, dt);
  }
  vehShots(dt);
}
HOOK.step.push(updateVehicles);

function vehTick(v, dt) {
  const sp = vehSp(v), D = aiD();
  if (S.t - v.hitT > 2) v.sup = Math.max(0, v.sup - 14 * dt);
  if (v.burn > 0) { v.burn -= dt; v.sup = Math.min(100, v.sup + 20 * dt); vehDamage(v, .55 * dt, 9, v.x, v.y, 'fire'); if (v.dead) return; }
  if (v.immob && S.t - v.hitT > 25 && S.t - v.immobT > 30) { v.immob = false; if (v.side === 'p') log(`${vehName(v)}乘员抢修好履带`, 'good', 'vfix' + v.id, 10, v); }
  if (v.ramp) { vehRampTick(v, dt); return; }   // 正在开下跳板：不寻路、不开火
  vehDepotTick(v, dt);
  vehRiders(v);
  if (v.pick) vehBoard(v);
  if (!v.auto && sp.flail && v.clearAt && v.order.t === 'hold') vehSweep(v, false);
  // 思考：自动车辆的 AI（守军车辆始终自动）
  if (v.auto && (v.think -= dt) <= 0) { v.think = 1.4 + Math.random() * .4; v.side === 'e' ? vehThinkE(v) : vehThinkP(v); }
  // 索敌（每 0.4 秒）
  if ((v.acqT = (v.acqT || 0) - dt) <= 0) { v.acqT = .4; v.tg = vehGunTarget(v); v.mtg = vehMgTarget(v); }
  const g = sp.gun;
  let tg = v.tg;
  if (tg && (tg.t.dead || (tg.t.men && !tg.t.men.length))) { tg = v.tg = null; v.acqT = 0; }
  if (tg && tg.k !== 'veh' && tg.k !== 'car' && !g.flame && !g.ind && vehDanger(v, tg.x, tg.y, tg.k === 'st' ? 26 : 20)) tg = null;   // 危险近距：改用机枪
  if (tg && tg.k !== 'st') { tg.x = tg.t.x; tg.y = tg.t.y; }
  // 炮塔/车体指向：有目标指向目标，否则缓慢回正；无炮塔车辆停车时整车转向目标
  const aimTo = tg ? Math.atan2(tg.y - v.y, tg.x - v.x) : v.mtg && !sp.tur ? null : v.mtg ? Math.atan2(v.mtg.y - v.y, v.mtg.x - v.x) : S.t - v.aimT > 3 ? v.heading : null;
  let ready = false;
  if (aimTo != null) {
    if (sp.tur) { const da = vehAng(aimTo - v.aim); v.aim += clamp(da, -2.4 * dt, 2.4 * dt); ready = Math.abs(da) < .12; }
    else {
      const arc = (g && g.arc) || .12, da = vehAng(aimTo - v.heading);
      if (tg && !v.moving && Math.abs(da) > arc && !v.immob) v.heading += clamp(da, -sp.turn * dt, sp.turn * dt);
      v.aim = v.heading + clamp(vehAng(aimTo - v.heading), -arc, arc);
      ready = Math.abs(vehAng(aimTo - v.aim)) < .1;
    }
  } else if (!sp.tur) v.aim = v.heading;
  v.aim = vehAng(v.aim);
  if (tg) v.aimT = S.t;
  // 开火：无炮塔车辆与间瞄火炮须停车射击
  if ((v.cd -= dt) <= 0 && tg && (ready || g.ind) && !(v.moving && (!sp.tur || g.ind)) && !v.lst) vehShoot(v, tg);
  if ((v.mcd -= dt) <= 0 && v.mtg && !v.lst) {
    const m = v.mtg;
    if (m.t.men && m.t.men.length && dist(v.x, v.y, m.t.x, m.t.y) < sp.mg.range * 1.1) vehMg(v, { ...m, x: m.t.x, y: m.t.y, d: dist(v.x, v.y, m.t.x, m.t.y) });
    else v.mcd = .3;
  }
  vehAA(v, dt);
  vehSam(v, dt);
  // 机动：攻击前进遇到主炮目标即停车射击
  const o = v.order, hold = o.t === 'amove' && ((tg && (!g || tg.d < g.range * .92)) || (!g && v.mtg && sp.mg && v.mtg.d < sp.mg.range * .8));
  if (!hold) vehDrive(v, dt, o.t === 'retreat' ? 1.1 : 1); else v.moving = false;
  vehSep(v, dt);
  vehTerrain(v, dt);
  if (v.side === 'e') { if (PV[ci(v.x, v.y)]) { if (v.seen < 0) log(`发现敌${vehModel(v)}`, 'warn', null, 0, v); v.kx = v.x; v.ky = v.y; v.kh = v.heading; v.seen = S.t; } else if (v.kx != null && dist(v.kx, v.ky, v.x, v.y) > 20 && PV[ci(v.kx, v.ky)]) v.kx = v.ky = v.kh = null; }
}

// 近战反坦克：步兵（工兵同样）对开到 28 以内的敌车辆——守军装甲车也算——投掷集束手榴弹 / 炸药包。步兵不会为此扑上去，
// 只在车自己开到跟前时才扔。每组约 6 秒一枚，飞行 0.6 秒；静止的车命中率 75%、行进中 45%，车旁 40 以内有护卫步兵时减半；
// 命中：车辆 9 点、穿深 2.2（中型坦克吃满，重型坦克只吃四成多），装甲车 6 点。状态：S.gren 飞行中的手榴弹
const GREN = { r: 28, cd: 6, fly: .6, dmg: 9, pen: 2.2, car: 6 };
function vehGrenades(dt) {
  if (!Array.isArray(S.gren)) S.gren = [];
  const cars = S.armor && S.armor.length ? S.armor.filter(a => !a.dead) : [];
  if (vehCache().p.length + vehCache().e.length + cars.length) for (const q of S.teams) {
    if (!q.men.length || q.ride || q.sup >= 85 || q.order.t === 'retreat' || (q.gT || 0) > S.t) continue;
    let tg = null, bd = GREN.r, k = 'veh';
    for (const v of vehFoes(q.side)) { if (v.swim || v.lst) continue; const d = dist(q.x, q.y, v.x, v.y); if (d < bd) { bd = d; tg = v; } }
    if (q.side === 'p') for (const a of cars) { const d = dist(q.x, q.y, a.x, a.y); if (d < bd) { bd = d; tg = a; k = 'car'; } }
    if (!tg) continue;
    q.gT = S.t + GREN.cd * (.8 + Math.random() * .4); q.cd = Math.max(q.cd, .8);   // 投弹这一下不开枪
    q.heading = Math.atan2(tg.y - q.y, tg.x - q.x);
    const cover = S.teams.some(o => o.side !== q.side && o.men.length && !o.ride && dist(o.x, o.y, tg.x, tg.y) < 40);
    const moving = k === 'veh' ? S.t - tg.movedT < .5 : !!tg.moving;
    const p = (moving ? .45 : .75) * (cover ? .5 : 1) * (1 - q.sup / 140);
    S.gren.push({ x0: q.x, y0: q.y, x1: tg.x + gauss() * 3, y1: tg.y + gauss() * 3, t: 0, dur: GREN.fly, side: q.side, k, id: tg.id, hit: Math.random() < p });
    v8Stat('grenT');
    if (k === 'veh' && tg.side === 'p') log(`${vehName(tg)}遭敌步兵抵近投掷集束手榴弹${cover ? '' : '，缺少步兵掩护'}`, 'bad', 'vmel' + tg.id, 15, tg);
  }
  for (const g of S.gren) {
    if ((g.t += dt) < g.dur) continue;
    g.done = true;
    S.fx.push({ kind: 'flash', x: g.x1, y: g.y1, r: g.hit ? 8 : 6, life: 0, max: .4, side: g.side });
    if (!g.hit) continue;
    v8Stat('grenH');
    if (g.k === 'car') { const a = cars.find(o => o.id === g.id); if (a && typeof damageArmor === 'function') damageArmor(a, GREN.car); }
    else { const v = vehById(g.id); if (v && !v.dead) vehDamage(v, GREN.dmg, GREN.pen, g.x0, g.y0, 'gren'); }
  }
  if (S.gren.length) S.gren = S.gren.filter(g => !g.done);
}
HOOK.step.push(dt => { if (S && S.phase === 'battle') vehGrenades(dt); });

// 补给点（滩头补给站与陆上补给网节点）：停车抢修与补充弹药
function vehDepots() {
  if (typeof supplyPoints === 'function') return supplyPoints(true).filter(p => p.stock == null || p.stock > .03);   // 存量见底的前沿点不去
  return S.supply.filter(L => L.connected).map(L => ({ x: L.x, y: L.y }));
}
function vehDepot(v) { const av = v.repAvoid && S.t - v.repAvoid.t < 60 ? v.repAvoid : null; let b = null, bd = Infinity; for (const p of vehDepots()) { if (av && dist(p.x, p.y, av.x, av.y) < 30) continue; const d = dist(p.x, p.y, v.x, v.y); if (d < bd) { bd = d; b = p; } } return b; }   // repAvoid：刚在那里等不到补给的点，60 秒内不再去
// 我方在补给点（含空投补给点）90 以内停车：抢修、补炮弹（每秒 2 发）、加油（20 秒加满）；油尽的车：400 以内有接通的补给点就派油罐车送油（每秒 1%）
// 守方依托己方据点 150 以内或出发位置补给（守军有预置的弹药与油料）
function vehDepotTick(v, dt) {
  if (v.lst || (v.depT = (v.depT || 0) - dt) > 0) return;
  v.depT = 1;
  const sp = vehSp(v);
  if (v.side === 'e') {
    if (v.moving || !(S.points.some(p => p.owner === 'e' && dist(p.x, p.y, v.x, v.y) < 150) || (v.hx != null && dist(v.hx, v.hy, v.x, v.y) < 80))) return;
    if (v.ammo < sp.ammo) v.ammo = Math.min(sp.ammo, v.ammo + 1);
    v.fuel = Math.min(1, (v.fuel ?? 1) + .04);
    return;
  }
  const p = vehDepot(v), d = p ? dist(p.x, p.y, v.x, v.y) : Infinity;
  // 油尽：有补给卡车时由卡车送油（trucks.js）；没有卡车时 400 以内有接通的补给点就靠人力送一点油，够开回去
  if (!(typeof trkAny === 'function' && trkAny())) {
    if ((v.fuel ?? 1) <= 0 && d < 400) { v.fuel = .01; log(`补给分队向油尽的${vehName(v)}人力送油`, 'info', 'vtank' + v.id, 30, v); }
    else if ((v.fuel ?? 1) < .2 && d < 400 && !v.moving && d > 90) v.fuel = Math.min(.2, v.fuel + .01);
  }
  if (v.moving || d > 90) return;
  if (v.hp < v.maxhp * .8 && S.t - v.hitT > 6) v.hp = Math.min(v.maxhp * .8, v.hp + 1.2);
  const a0 = v.ammo, f0 = v.fuel ?? 1;
  if (v.ammo < sp.ammo) v.ammo = Math.min(sp.ammo, v.ammo + 2);
  v.fuel = Math.min(1, (v.fuel ?? 1) + .05);
  if (p.kind === 'node') { const n = snById(p.id); if (n) n.stock = Math.max(0, (n.stock ?? 1) - (v.ammo - a0) * .006 - (v.fuel - f0) * .25); }   // 前沿点的存量：一车炮弹约 0.25、加满油 0.25
  if (v.immob && S.t - v.hitT > 8) { v.immob = false; log(`${vehName(v)}在补给点修复履带`, 'good', 'vfix' + v.id, 10, v); }
}
// 同排（同一伙伴排 / 同一进攻目标）的车辆
const vehMates = v => (S.veh || []).filter(o => o !== v && !o.dead && o.side === v.side && !o.lst && ((v.buddy != null && o.buddy === v.buddy) || (v.sk != null && o.sk === v.sk)));
// 弹药（主炮占满载的比例）与油料
const vehAmmoF = v => { const sp = vehSp(v); return sp.gun && !sp.gun.flame && sp.ammo ? v.ammo / sp.ammo : 1; };

// 车辆视野（并入 PV/EV）；开火暴露自己：枪口焰让敌方看见车辆所在格
HOOK.visionP.push(() => (S && S.veh || []).filter(v => !v.dead && v.side === 'p' && !v.lst).map(v => ({ x: v.x, y: v.y, r: vehSp(v).sight * (v.swim ? .7 : 1) * (v.sup > 70 ? .7 : 1), h: .5 })));
HOOK.visionE.push(() => {
  const out = [];
  for (const v of S && S.veh || []) {
    if (v.dead || v.lst) continue;
    if (v.side === 'e') out.push({ x: v.x, y: v.y, r: vehSp(v).sight, h: .5 });
    else if (S.t - v.fireT < 3 || S.t - (v.mgT ?? -99) < 2) out.push({ x: v.x, y: v.y, r: 12, h: 1.5 });
  }
  return out;
});

// —— 装甲运兵车：搭载的小组随车移动、不能射击；车毁时紧急下车 ——
function vehRiders(v) {
  if (!v.ride || !v.ride.length) return;
  v.ride = v.ride.filter(id => S.teams.some(q => q.id === id && q.men.length));
  v.ride.forEach((id, k) => {
    const q = S.teams.find(q => q.id === id), c = Math.cos(v.heading), s = Math.sin(v.heading), off = (k - .5) * 3;
    q.x = v.x - c * 2 - s * off; q.y = v.y - s * 2 + c * off; q.cd = Math.max(q.cd, .5); q.movedT = S.t - 1; q.heading = v.heading; q.ride = v.id;
  });
}
function vehDropRiders(v, hurt) {
  if (!v.ride || !v.ride.length) return;
  v.ride.forEach((id, k) => {
    const q = S.teams.find(q => q.id === id);
    if (!q) return;
    q.ride = null;
    const a = v.heading + Math.PI + (k - .5) * 1.2, x = v.x + Math.cos(a) * 12, y = v.y + Math.sin(a) * 12;
    if (passInf(x, y)) { q.x = x; q.y = y; }
    if (hurt) { q.sup = 100; q.hitT = S.t; if (q.men.length && Math.random() < .5) killMan(q); }
    q.pathT = -9;
  });
  v.ride = [];
}

// step() 末尾清理空小组时会把不认识的选中 id 丢掉：本钩子先行清理，并保留车辆 id
function vehSelFix() {
  if (!S.teams.some(q => !q.men.length)) return;
  S.teams = S.teams.filter(q => q.men.length);
  S.sel = S.sel.filter(id => id === 'DD' || id === 'CV' || S.units.some(u => u.id === id) || S.ships.some(s => s.id === id) || (S.veh || []).some(v => v.id === id && !v.dead));
}

// —— 自动车辆 AI（我方）：跟随自动步兵的进攻（落后步兵前沿 40–80）、敲掉压制步兵的碉堡、绝不单车冲进步兵前方的镇子；
// 运兵车把滩头的步兵送往前线后改作机枪支援；扫雷坦克清理我方进攻路线上的已知雷区；受损 / 弹尽时回补给点抢修 ——
const VEH_BACK = { lt_tank: 50, tank: 55, hv_tank: 45, amtank: 55, apc: 75, spg: 300, td: 95, aa_veh: 85, sam_veh: 110, recon: 70, flame_tank: 40, mine_tank: 50 };
// 下令（量化目标、与现有命令相近时不重下，减少流场重算）
function vehGo(v, x, y, t, face) {
  x = Math.round(x / 10) * 10; y = Math.round(y / 10) * 10;
  const o = v.order;
  if (o.x != null && o.t === t && dist(o.rx ?? o.x, o.ry ?? o.y, x, y) < 22) return true;   // 与原请求点比较（去向可能被错开过）
  if (o.t === 'hold' && dist(v.x, v.y, x, y) < 18) return true;
  if (o.t === 'hold' && o.was && S.t - (v.arrT ?? -99) < 10 && v.pg && dist(v.pg.ox, v.pg.oy, x, y) < 25 && dist(v.x, v.y, x, y) < 75) return true;   // 刚因目标被占 / 没进展停下：同一去向 10 秒内不再硬挤
  if (!vehReach(v, x, y)) return false;
  return vehSetOrder(v, t, x, y, face);
}

function vehThinkP(v) {
  const sp = vehSp(v);
  if (v.lst) return;
  // 指挥官指令（commander.js 可写入）：v.cmd = {t, x, y, face, until}
  if (v.cmd && S.t < (v.cmd.until ?? Infinity) && v.cmd.x != null) { vehGo(v, v.cmd.x, v.cmd.y, v.cmd.t || 'move', v.cmd.face); return; }
  if (v.immob) { v.order = { t: 'hold' }; return; }
  // 补给：轮流下去吃补给——弹药不足四成、油料不足三成或受损过半时，同排没有别的车在补给才轮到自己撤下（其余车辆留在原地掩护）；
  // 弹药不足一成、油料不足一成二或重创则不等，立即撤。补满（弹药、油料八成五，车体七成二）才归建
  v.cons = vehAmmoF(v) < .5 && (() => { const d = vehDepot(v); return !d || dist(d.x, d.y, v.x, v.y) > 500; })();   // 补给远 / 断：节约弹药（vehGunTarget / vehShoot）
  const am = vehAmmoF(v), fu = v.fuel ?? 1, crit = v.hp < v.maxhp * .35 || am <= .1 || fu <= .12, want = am < .4 || fu < .3 || v.hp < v.maxhp * .5;
  if ((crit || (want && !vehMates(v).some(o => o.ai === 'repair') && S.t - (v.repSkip ?? -99) > 60)) && !v.swim && v.ai !== 'repair') {   // 刚从等不到补给的点回来：60 秒内不为轮换补给再下去
    const p = vehDepot(v);
    if (p) {
      const why = am <= .4 ? '弹药不足' : fu < .3 ? '油料不足' : '受损';
      log(`${vehName(v)}${why}，${crit ? '立即' : '轮换'}撤回补给点${crit ? '' : '，同排其余车辆留在原地掩护'}`, 'warn', 'vrep' + v.id, 30, v);
      v.ai = 'repair'; v.pick = null; v8Stat(crit ? 'vRepCrit' : 'vRepTurn');
      if (v.ride && v.ride.length) { vehDropRiders(v, false); v.ferT = S.t; }   // 先放下搭载的步兵再回去抢修
    }
  }
  if (v.ai === 'repair') {
    const p = vehDepot(v);
    // 在补给点干等：20 秒没补上多少（点上没存货、卡车还没到）——够打就先回去打，不够就换去更后面的补给站
    const lvl = am + fu + v.hp / v.maxhp;
    if (p && dist(p.x, p.y, v.x, v.y) <= 45) { if (!v.repW || lvl > v.repW.l + .06) v.repW = { l: lvl, t: S.t }; } else v.repW = null;
    const stale = v.repW && S.t - v.repW.t > 20;
    if (v.hp >= v.maxhp * .72 && am >= .85 && fu >= .85) { v.ai = null; v.repW = null; }
    else if (!p) v.ai = null;   // 补给点没了：带着剩下的弹药继续打
    else if (stale && am >= .3 && fu >= .25 && v.hp >= v.maxhp * .4) { v.ai = null; v.repW = null; v.repSkip = S.t; v8Stat('vRepStale'); log(`${vehName(v)}在补给点等不到补给，带着现有弹药回到战斗`, 'warn', 'vrepst' + v.id, 60, v); }
    else if (stale) { const far = vehDepots().filter(o => dist(o.x, o.y, p.x, p.y) > 60 && (o.stock == null || o.stock > .2)).sort((a, b) => dist(a.x, a.y, v.x, v.y) - dist(b.x, b.y, v.x, v.y))[0]; if (far) { v.repAvoid = { x: p.x, y: p.y, t: S.t }; vehGo(v, far.x, far.y + 12, 'retreat'); v.repW = null; return; } v.order = { t: 'hold' }; return; }
    else { if (dist(p.x, p.y, v.x, v.y) > 45) vehGo(v, p.x, p.y + 12, 'retreat'); else v.order = { t: 'hold' }; return; }
  }
  if (v.swim || vehWater(v.x, v.y)) { vehLanding(v); return; }
  if (sp.carry && vehFerry(v)) return;
  if (sp.flail && vehSweep(v, true)) return;
  if (v.buddy != null && v.esc && typeof tfOn === 'function' && tfOn() && typeof vehEscort === 'function' && vehEscort(v)) return;   // v7 步坦协同（tf.js）
  vehSupport(v);
}

// 泅渡中的两栖坦克：驶向友舰抢滩处旁边的滩头（玩家预定了上陆点则照计划）
function vehLanding(v) {
  const o = v.order, g = typeof cmdAmphTask === 'function' ? cmdAmphTask(v) : null;   // 受指挥官掌握：侦察期间待命，按决心的出发时刻驶向指定上陆点
  if (g && g.hold) { if (o.t !== 'hold') v.order = { t: 'hold' }; return; }
  if (g && isFinite(g.x)) {
    // 离上陆点横向较远：先在集结海域（深水）里横向机动到滩头正南，再向北泅渡——不贴着海岸走，免得半路爬上别的岬角、单车上岸
    if (Math.abs(v.x - g.x) > 90 && v.y > STAGING_Y - 80) { vehGo(v, g.x, clamp(v.y, STAGING_Y + 15, H - 30), 'move'); return; }
    if (!vehGo(v, g.x, coastAt(g.x) - 40, 'move')) vehGo(v, g.x, coastAt(g.x) - 20, 'move');
    return;
  }
  if (o.x != null && o.t !== 'hold' && !vehWater(o.x, o.y)) return;
  let best = null, bd = Infinity;
  for (const s of S.ships) if (alive(s) && s.land && s.bx != null && (s.state === 'move' || s.state === 'unloading' || s.state === 'beached')) {
    const d = Math.abs(s.bx - v.x) + Math.abs(s.by - v.y) * .3;
    if (d < bd) { bd = d; best = { x: s.bx, y: s.by }; }
  }
  if (!best) for (const b of TER.beaches) { const d = Math.abs(b.cx - v.x); if (d < bd) { bd = d; best = { x: b.cx, y: coastAt(b.cx) }; } }
  if (!best) return;
  const side = (v.id % 2 ? 1 : -1) * (24 + (v.id % 3) * 10), x = clamp(best.x + side, 20, W - 20);
  if (!vehGo(v, x, coastAt(x) - 40, 'move')) vehGo(v, best.x, best.y - 30, 'move');
}

// 按目标据点归组的自动步兵进攻（集结 / 待命 / 攻击中）
function vehAttacks() {
  const P = S.autoPlan && S.autoPlan.u, out = {};
  if (!P) return out;
  for (const u of S.units) {
    if (u.side !== 'p' || u.kind !== 'inf' || u.state === 'rout' || u.x == null) continue;
    const pl = P[u.id];
    if (!pl || !pl.obj || !['stage', 'wait', 'go'].includes(pl.ph)) continue;
    const ts = teamsOf(u).filter(q => !q.ride && q.men.length);
    if (ts.length) (out[pl.obj] || (out[pl.obj] = [])).push(...ts);
  }
  return out;
}

function vehSupport(v) {
  const sp = vehSp(v), A = vehAttacks();
  let key = null, bs = -Infinity;
  for (const k in A) {
    const ts = A[k], cx = ts.reduce((a, q) => a + q.x, 0) / ts.length, cy = ts.reduce((a, q) => a + q.y, 0) / ts.length;
    const others = S.veh.filter(o => o !== v && !o.dead && o.side === 'p' && o.auto && o.sk === k).length;
    const s = -dist(v.x, v.y, cx, cy) - others * 160 + (v.sk === k ? 120 : 0) + ts.length * 8;
    if (s > bs) { bs = s; key = k; }
  }
  v.sk = key;
  const p = key && S.points.find(p => p.key === key);
  if (!p) return vehFollow(v);
  const ts = A[key];
  let front = ts[0], fd = Infinity;
  for (const q of ts) { const d = dist(q.x, q.y, p.x, p.y); if (d < fd) { fd = d; front = q; } }
  const cx = ts.reduce((a, q) => a + q.x, 0) / ts.length, cy = ts.reduce((a, q) => a + q.y, 0) / ts.length;
  let dx = cx - p.x, dy = cy - p.y, l = Math.hypot(dx, dy) || 1;
  dx /= l; dy /= l;
  // 同组车辆编成坦克排，按敌情取队形（tf.js tfVForm / tfVSlot：纵队、楔形、一字横队、梯队）
  const mates = S.veh.filter(o => !o.dead && o.side === 'p' && o.auto && o.sk === key).sort((a, b) => a.id - b.id), k = mates.indexOf(v);
  const form = mates.length > 1 && typeof tfVForm === 'function' ? tfVForm('p', mates.reduce((a, o) => a + o.x, 0) / mates.length, mates.reduce((a, o) => a + o.y, 0) / mates.length, -dx, -dy) : 'line';
  const [lat0, fb] = typeof tfVSlot === 'function' ? tfVSlot(form, k, mates.length) : [(k % 2 ? 1 : -1) * (Math.floor(k / 2) * 30 + 16), 0], lat = -lat0;
  v.vform = form; v.vslot = [lat, fb];
  let back = (VEH_BACK[v.type] ?? 55) + fb, tx = p.x + dx * (fd + back) - dy * lat, ty = p.y + dy * (fd + back) + dx * lat;
  // 步兵被压制：找压制他们的已知火力点，抵近到步兵前沿一线、主炮射程以内
  const pinned = ts.filter(q => q.sup > 45).length >= Math.max(1, ts.length * .3);
  if (pinned && sp.gun && !sp.gun.ind) {
    let b = null, bd = 240;
    for (const e of S.enemies) if (!e.dead && e.kx != null && (e.kind === 'bunker' || e.kind === 'mortar' || e.kind === 'aa')) { const d = dist(e.kx, e.ky, front.x, front.y); if (d < bd) { bd = d; b = e; } }
    for (const q of S.teams) if (q.side === 'e' && q.men.length && inVision(q.x, q.y)) { const d = dist(q.x, q.y, front.x, front.y) + 40; if (d < bd) { bd = d; b = q; } }
    if (b) {
      const bx = b.kx ?? b.x, by = b.ky ?? b.y, rr = sp.gun.flame ? 50 : Math.min(sp.gun.range * .75, Math.max(bd - 5, 70));
      let ex = cx - bx, ey = cy - by, el = Math.hypot(ex, ey) || 1;
      const nx = bx + ex / el * rr - ey / el * lat * .6, ny = by + ey / el * rr + ex / el * lat * .6;
      if (dist(nx, ny, p.x, p.y) >= fd - 15 || sp.gun.flame) { tx = nx; ty = ny; v.ai = 'engage'; }
    }
  } else v.ai = 'support';
  // 绝不单车冲进步兵前方：离目标据点的距离不小于步兵前沿
  if (dist(tx, ty, p.x, p.y) < fd - 15 && !(sp.gun && sp.gun.flame && pinned)) { tx = p.x + dx * (fd + 10); ty = p.y + dy * (fd + 10); }
  if (!vehGo(v, tx, ty, 'move', Math.atan2(p.y - ty, p.x - tx))) vehGo(v, cx + dx * back, cy + dy * back, 'move');
}

// 没有自动进攻可支援：跟在最近的我方步兵排后面（离最近的敌占据点的反方向 60）
function vehFollow(v) {
  let u = null, bd = Infinity;
  for (const o of S.units) if (o.side === 'p' && o.kind === 'inf' && o.x != null && teamsOf(o).length) { const d = dist(o.x, o.y, v.x, v.y); if (d < bd) { bd = d; u = o; } }
  if (!u) { v.ai = 'idle'; return; }
  let q = null, qd = Infinity;
  for (const p of S.points) if (p.owner !== 'p') { const d = dist(p.x, p.y, u.x, u.y); if (d < qd) { qd = d; q = p; } }
  const a = q ? Math.atan2(u.y - q.y, u.x - q.x) : SOUTH, back = VEH_BACK[v.type] ?? 55;
  v.ai = 'follow';
  vehGo(v, u.x + Math.cos(a) * back, u.y + Math.sin(a) * back, 'move', a + Math.PI);
}

// 运兵车：接走滩头附近、目标还很远的自动步兵（最多 carry 个小组），送到他们的目的地附近或敌情出现前下车
function vehFerry(v) {
  const sp = vehSp(v), P = S.autoPlan && S.autoPlan.u;
  if (v.ride.length) {
    const q = S.teams.find(q => q.id === v.ride[0]), o = q && q.order;
    const foe = S.teams.some(e => e.side === 'e' && e.men.length && inVision(e.x, e.y) && dist(e.x, e.y, v.x, v.y) < 110) ||
      S.enemies.some(e => !e.dead && e.kx != null && e.kind === 'bunker' && dist(e.kx, e.ky, v.x, v.y) < 150);
    if (!o || o.x == null || o.t === 'hold' || dist(o.x, o.y, v.x, v.y) < 40 || foe || v.hp < v.maxhp * .5) {
      vehDropRiders(v, false); v.ferT = S.t; v.ai = 'mg';
      log(`${vehName(v)}放下搭载的步兵`, 'info', 'vdrop' + v.id, 20, v);
      return false;
    }
    if (S.t - (v.carryT ?? S.t) > 70 || !vehGo(v, o.x, o.y, 'move')) { vehDropRiders(v, false); v.ferT = S.t; v.ai = 'mg'; return false; }   // 车开不过去或耽搁太久：就地下车
    v.ai = 'carry';
    return true;
  }
  if (v.pick && v.pick.length) {   // 正去接人
    const ts = v.pick.map(id => S.teams.find(q => q.id === id && q.men.length && !q.ride)).filter(Boolean);
    if (!ts.length || S.t - v.pickT > 25) { v.pick = null; return false; }
    vehGo(v, ts[0].x, ts[0].y, 'move'); v.ai = 'pick';
    return true;
  }
  if (!P || S.t - (v.ferT ?? -99) < 35) return false;
  let best = null, bs = -Infinity;
  for (const u of S.units) {
    const pl = P[u.id];
    if (u.side !== 'p' || u.kind !== 'inf' || u.state === 'rout' || !u.auto || !pl || !pl.obj || (pl.ph !== 'stage' && pl.ph !== 'go')) continue;
    const p = S.points.find(p => p.key === pl.obj), d = dist(u.x, u.y, v.x, v.y);
    if (!p || d > 280 || dist(u.x, u.y, p.x, p.y) < 320) continue;
    const s = dist(u.x, u.y, p.x, p.y) / 100 - d / 80;
    if (s > bs) { bs = s; best = u; }
  }
  if (!best) return false;
  const ts = teamsOf(best).filter(q => !q.ride && q.order.x != null).sort((a, b) => dist(a.x, a.y, v.x, v.y) - dist(b.x, b.y, v.x, v.y)).slice(0, sp.carry);
  if (!ts.length) return false;
  v.pick = ts.map(q => q.id); v.pickT = S.t;
  vehGo(v, ts[0].x, ts[0].y, 'move'); v.ai = 'pick';
  return true;
}
// 接人：贴近 18 以内即登车
function vehBoard(v) {
  if (!v.pick || !v.pick.length) return;
  for (const id of v.pick.slice()) {
    const q = S.teams.find(q => q.id === id);
    if (!q || !q.men.length || q.ride) { v.pick = v.pick.filter(i => i !== id); continue; }
    if (dist(q.x, q.y, v.x, v.y) < 18 && v.ride.length < vehSp(v).carry) { v.ride.push(q.id); q.ride = v.id; v.pick = v.pick.filter(i => i !== id); }
  }
  if (!v.pick.length) { v.pick = null; if (v.ride.length) { v.think = 0; v.carryT = S.t; log(`${vehName(v)}载上 ${v.ride.length} 个小组驶向前线`, 'info', 'vride' + v.id, 20, v); } }
}

// 扫雷坦克：找我方步兵附近（或手动指定地点附近）的已知雷区，驶入后来回碾压直到清除
function vehSweep(v, auto) {
  const ref = auto ? null : v.clearAt;
  if (!auto && !ref) return false;
  let m = null, bd = auto ? 650 : 120;
  for (const o of S.mines) if (o.known && o.clr < 1) {
    if (!ref && !S.teams.some(q => q.side === 'p' && q.kind === 'inf' && q.men.length && dist(q.x, q.y, o.x, o.y) < 400)) continue;
    const d = ref ? dist(o.x, o.y, ref.x, ref.y) : dist(o.x, o.y, v.x, v.y);
    if (d < bd) { bd = d; m = o; }
  }
  if (!m) { if (!auto && v.clearAt) { v.clearAt = null; log(`${vehName(v)}附近没有待清除的已知雷区`, 'info', 'vsw' + v.id, 10, v); } return false; }
  v.ai = 'sweep';
  if (dist(v.x, v.y, m.x, m.y) > m.r) { if (v.order.t !== 'clear' || dist(v.order.x, v.order.y, m.x, m.y) > m.r) vehSetOrder(v, 'clear', m.x, m.y); return true; }
  if (v.order.t === 'clear' && dist(v.order.x, v.order.y, v.x, v.y) > 6) return true;
  const a = Math.random() * 6.283, r = m.r * (.35 + Math.random() * .55);
  vehSetOrder(v, 'clear', m.x + Math.cos(a) * r, m.y + Math.sin(a) * r);
  return true;
}

// —— 守军车辆 AI：机动预备队停在镇子；附近据点受威胁且有步兵在场时反击，否则在据点后方车体半埋坚守 ——
function vehThinkE(v) {
  if (!v.home) {
    const ks = ['T1', 'T2', 'T3', 'HQ'].map(k => S.points.find(p => p.key === k)).filter(Boolean);
    let h = null, bd = Infinity;
    for (const p of ks.length ? ks : S.points) { const d = dist(p.x, p.y, v.x, v.y); if (d < bd) { bd = d; h = p; } }
    v.home = h ? h.key : null; v.hx = v.x; v.hy = v.y;
  }
  if (v.immob) { v.order = { t: 'hold', face: SOUTH }; return; }
  if (v.hp < v.maxhp * .3) { v.ai = 'back'; vehGo(v, v.hx, v.hy, 'retreat', SOUTH); return; }
  // 弹药不足两成五或油料不足两成：同排没有别的车在补给才回出发位置补（弹药耗尽 / 油料一成以下不等）；补到八成再出动
  const am = vehAmmoF(v), fu = v.fuel ?? 1;
  if (v.ai === 'resup' && am >= .8 && fu >= .8) v.ai = null;
  if (v.ai === 'resup' || ((am < .25 || fu < .2) && (am <= .02 || fu < .1 || !vehMates(v).some(o => o.ai === 'resup')))) { v.ai = 'resup'; vehGo(v, v.hx, v.hy, 'retreat', SOUTH); return; }
  if (v.cmd && S.t < (v.cmd.until ?? 0) && v.cmd.x != null) { v.ai = v.cmd.ai || 'cmd'; vehGo(v, v.cmd.x, v.cmd.y, v.cmd.t || 'move', v.cmd.face); return; }   // 守方指挥（ai4.js）：防空车随支队掩护
  if (v.buddy != null && v.esc && typeof a4On === 'function' && a4On() && typeof vehEscort === 'function' && vehEscort(v)) return;   // v7：随步兵行动（ai4.js 绑定）
  let best = null, bs = -Infinity;
  for (const p of S.points) {
    const d = dist(v.x, v.y, p.x, p.y), lost = p.owner === 'p';
    if (d > 700 || !(lost || p.prog > .2 || p.contested)) continue;
    const s = p.vp * 2 + (lost ? 1 : 0) + (p.contested ? 1.5 : 0) - d / 300;
    if (s > bs) { bs = s; best = p; }
  }
  if (!best) { v.ai = 'reserve'; vehGo(v, v.hx, v.hy, 'move', SOUTH); return; }
  const inf = S.teams.filter(q => q.side === 'e' && q.men.length && dist(q.x, q.y, best.x, best.y) < 220).length;
  if ((inf >= 2 || best.key === 'HQ') && !vehSp(v).aa) { v.ai = 'counter'; vehGo(v, best.x + gauss() * 15, best.y - 55, 'amove', SOUTH); }   // 防空车不打反冲击，只在后方掩护
  else { v.ai = 'cover'; vehGo(v, best.x, best.y - 150, 'move', SOUTH); }
}

// 地狱难度：守军另有一辆中型坦克、一辆轻型坦克作机动预备队，停在镇子背面（沙盘模式由玩家自行摆放）
HOOK.newGame.push(opts => {
  if (!S || (opts && opts.sandbox) || S.mode === 'sandbox' || S.level !== 'hell') return;
  const ks = ['T1', 'T2', 'T3', 'HQ'].map(k => S.points.find(p => p.key === k)).filter(Boolean);
  [['tank', 0], ['lt_tank', 1]].forEach(([t, i]) => {
    const p = ks[i % ks.length]; if (!p) return;
    const sp = typeof a3Park === 'function' && Array.isArray(S.armor) ? a3Park(p) : { x: p.x, y: p.y - 40 };
    addVehicle('e', t, sp.x, sp.y, { auto: true });
  });
});

// —— 坦克登陆舰（LST）——
// 每步：沉没时舰上车辆损失；自动 LST 等第一波站稳滩头后选滩抢滩（指挥官可设 S.autoPlan.holdLST 暂缓）
function vehLSTTick(s, dt) {
  const L = s.load || (s.load = { teams: 0, eng: 0 });
  if (!alive(s)) {
    if (s.vn) { S.stats.lost += s.vn * 3; log(`${s.label} 被击沉，舰上 ${s.vn} 辆车辆随舰沉没`, 'bad', null, 0, s); s.vn = 0; }
    return;
  }
  if (L.veh === undefined && !s.vinit) L.veh = ((SHIP_SPEC.lst && SHIP_SPEC.lst.veh) || []).slice();   // 未写载荷时用默认编成
  s.vinit = true;
  s.vn = (L.veh || []).length;
  if (s.auto !== true || s.state !== 'idle' || !s.vn || (S.autoPlan && S.autoPlan.holdLST)) return;
  if ((s.lstT = (s.lstT ?? 0) - dt) > 0) return;
  s.lstT = 2;
  if (!S.ships.some(o => o.kind === 'assault' && (o.state === 'beached' || o.state === 'unloading')) && S.t < 120) return;
  let best = null, bs = -Infinity, bi = -1, bfr = 0;
  TER.beaches.forEach((b, i) => {
    const ex = b.cx, ey = coastAt(b.cx) - 60;
    let fr = 0, def = 0;
    for (const q of S.teams) if (q.side === 'p' && q.kind === 'inf' && !q.ride && dist(q.x, q.y, ex, ey) < 280) fr += q.men.length;
    for (const e of S.enemies) if (!e.dead && e.kx != null && dist(e.kx, e.ky, ex, ey) < (e.kind === 'coastal' ? 600 : 250)) def += e.kind === 'coastal' ? 4 : e.kind === 'bunker' ? 3 : 1;
    const lst = S.ships.filter(o => o !== s && o.kind === 'lst' && o.land && o.bx >= b.x0 - 30 && o.bx <= b.x1 + 30).length;
    const sc = Math.min(fr, 40) * .4 - def * 1.5 - lst * 4 - Math.abs(b.cx - s.x) / 400 + (b.x1 - b.x0) / 200;
    if (sc > bs) { bs = sc; best = b; bi = i; bfr = fr; }
  });
  if (!best || (bfr < 8 && S.t < 150)) return;   // 滩头尚未站稳：继续待命
  const x = clamp(best.cx + (s.id % 3 - 1) * 30, best.x0 + 14, best.x1 - 14);
  if (orderShips([s], x, coastAt(x) - 20)) {
    if (S.autoPlan && S.autoPlan.s) S.autoPlan.s[s.id] = { b: bi, x };
    log(`${s.label} 驶向${best.name || '滩头'}：装甲第二波上陆`, 'info', 'lstgo' + s.id, 30, { x, y: coastAt(x) });
  }
}

// 抢滩后（units.js updateShips 调用）：艏门打开、跳板放下，车辆逐辆驶下，全部下完转入搁滩状态
function vehUnload(s, dt) {
  const L = s.load;
  if (L.veh === undefined) L.veh = ((SHIP_SPEC.lst && SHIP_SPEC.lst.veh) || []).slice();
  s.vinit = true;
  s.ut = (s.ut || 0) + dt;
  if (!L.veh.length) { if (s.ut >= 1.5) disembark(s); return; }
  if (s.ut < (s.vk ? 1.5 : 2.6)) return;   // 首辆等艏门放下；之后至少间隔 1.5 秒
  // 一辆一辆下：上一辆走完跳板、离开跳板口一个车长以上，下一辆才出舱（被挡住超过 12 秒就不再等）
  const p = s.lastV != null && S.veh.find(o => o.id === s.lastV);
  if (p && !p.dead && s.ut < 12 && (p.ramp || dist(p.x, p.y, p.rx ?? p.x, p.ry ?? p.y) < vehSp(p).len + 8)) return;
  s.ut = 0;
  s.lastV = vehOffload(s, L.veh.shift(), (s.vk = (s.vk || 0) + 1) - 1).id;
}
// 车辆下船：先出现在舰内车辆甲板上，沿船首方向开下跳板（v.ramp，期间不寻路、不开火），上滩后开到滩头集结位置（vehStageSpot）
function vehOffload(s, type, k) {
  const bx = s.bx ?? s.x, by = s.by ?? s.y, h = Math.atan2(by - s.y, bx - s.x), L = ((typeof SHIP_DIM === 'object' && SHIP_DIM[s.kind]) || [48])[0];
  const c = Math.cos(h), n = Math.sin(h), bowX = s.x + c * L * .45, bowY = s.y + n * L * .45, x0 = s.x - c * L * .1, y0 = s.y - n * L * .1;
  const ahead = (bx - bowX) * c + (by - bowY) * n;
  const off = ((k % 3) - 1) * 5;   // 跳板终点按车序左右错开，前后两辆不压在同一点
  let x1 = (ahead > 6 ? bx + c * 6 : bowX + c * 18) - n * off, y1 = (ahead > 6 ? by + n * 6 : bowY + n * 18) + c * off;
  // 跳板终点要落在车辆能走的陆地上（滩头障碍、浅滩格往前找；找不到就取最近的可通行格）
  let ok = false;
  for (let d = 0; d <= 48 && !ok; d += 4) { const x = x1 + c * d, y = y1 + n * d; if (isLand(x, y) && vehPass(x, y, 'veh')) { x1 = x; y1 = y; ok = true; } }
  if (!ok) { const j = nearestPassable(ci(x1, y1), 'veh'); if (j >= 0) { x1 = cellCX(j); y1 = cellCY(j); } }
  const v = addVehicle('p', type, x0, y0, { auto: s.unitAuto !== false, heading: h, aim: h, ship: s.label });
  v.x = x0; v.y = y0;   // addVehicle 会把落在水里的车挪到可通行格：这里要的就是舰内位置
  v.ramp = { t0: S.t, x0, y0, x1, y1, h, k, dur: clamp(dist(x0, y0, x1, y1) / 20, 1.8, 3) };
  v.rx = x1; v.ry = y1;
  v.climbT = S.t; v.movedT = S.t; v.order = { t: 'hold' };
  log(`${s.label} 放下跳板：${vehSp(v).name}驶下跳板`, 'good', 'lstv' + s.id, 2, v);
  return v;
}
function vehRampTick(v, dt) {
  const R = v.ramp, u = clamp((S.t - R.t0) / R.dur, 0, 1), e = u * u * (3 - 2 * u);
  const px = v.x, py = v.y;
  v.x = lerp(R.x0, R.x1, e); v.y = lerp(R.y0, R.y1, e); v.heading = v.aim = Math.atan2(R.y1 - R.y0, R.x1 - R.x0); v.movedT = S.t; v.moving = u < 1;
  v.odo = (v.odo || 0) + dist(px, py, v.x, v.y);   // 履带随行驶滚动
  if (u < 1) return;
  v.ramp = null; v.climbT = S.t;
  const p = vehStageSpot(v, R);
  vehSetOrder(v, 'move', p.x, p.y);
}
// 滩头集结位置：上滩点向内陆 70–130、掩蔽好、不和已下船的车挤在一起、避开已知雷区与敌反坦克火力；同一艘船的车左右错开
function vehStageSpot(v, R) {
  const c = Math.cos(R.h), n = Math.sin(R.h), px = -n, py = c, pref = ((R.k % 3) - 1) * 45;
  const ats = S.teams.filter(q => q.side === 'e' && q.men.length && inVision(q.x, q.y) && (q.men.includes('at') || (q.mod && q.mod.at)));
  const evs = (S.veh || []).filter(o => o.side === 'e' && !o.dead && inVision(o.x, o.y) && vehSp(o).gun && !vehSp(o).gun.ind);
  let best = null, bs = -Infinity;
  for (const d of [70, 90, 110, 130, 150]) for (const lat of [-100, -75, -50, -25, 0, 25, 50, 75, 100]) {
    const x = clamp(R.x1 + c * d + px * lat, 10, W - 10), y = clamp(R.y1 + n * d + py * lat, 10, H - 10), i = ci(x, y);
    if (!isLand(x, y) || !vehPass(x, y, 'veh') || (typeof MINEC !== 'undefined' && MINEC[i] === 2)) continue;
    let sc = coverAt(x, y) * 3 - Math.abs(lat - pref) / 50 - Math.abs(d - 95) / 60;
    // 摊开：离别的车（含其去向）40 以内重扣、60 以内轻扣，几艘船的车在滩头排成间隔 40 左右的横队
    for (const o of S.veh) if (o !== v && o.side === 'p' && !o.dead) {
      const ox = o.order && o.order.x != null ? o.order.x : o.x, oy = o.order && o.order.y != null ? o.order.y : o.y, dd = Math.min(dist(ox, oy, x, y), dist(o.x, o.y, x, y));
      if (dd < 40) sc -= 4 - dd / 20; else if (dd < 60) sc -= 1.2;
    }
    for (const q of ats) { const dd = dist(q.x, q.y, x, y); if (dd < 260) sc -= (260 - dd) / 60; }
    for (const o of evs) { const dd = dist(o.x, o.y, x, y); if (dd < 420) sc -= (420 - dd) / 140; }
    if (sc > bs) { bs = sc; best = { x, y }; }
  }
  return best || { x: R.x1 + c * 60, y: R.y1 + n * 60 };
}
// 直接下船（disembark 时仍有车辆在舱内）：一次全部放下
function vehDisembark(s) {
  const L = s.load;
  while (L.veh && L.veh.length) vehOffload(s, L.veh.shift(), (s.vk = (s.vk || 0) + 1) - 1);
}

// —— 指令（ui.js 调用；也可无头调用）——
const selVehs = () => !S || !S.veh ? [] : S.sel.map(id => S.veh.find(v => v.id === id)).filter(v => v && !v.dead && v.side === 'p' && !v.lst);
// 部署阶段：在集结海域内点击 = 重新布位（两栖车辆），否则 = 预定上陆点
function vehDeployOrder(vs, x, y) {
  const zone = y >= STAGING_Y && typeAt(x, y) === T.DEEP;
  vs.forEach((v, i) => {
    const k = (i - (vs.length - 1) / 2) * 22;
    if (zone && vehWater(v.x, v.y)) {
      const nx = clamp(x + k, 15, W - 15), ny = clamp(y - 12 + (i % 2) * 12, STAGING_Y + 10, H - 12);
      if (typeAt(nx, ny) === T.DEEP) Object.assign(v, { x: nx, y: ny, plan: null });
    } else if (!zone) v.plan = { x: clamp(x + k, 8, W - 8), y };
  });
}
function vehStartBattle() {
  for (const v of S.veh || []) if (v.plan && !v.dead) { vehSetOrder(v, 'move', v.plan.x, v.plan.y); v.plan = null; }
}
// 战斗中：沿垂直于前进方向的横线展开（face 来自右键拖拽）
function vehOrder(vs, x, y, t, face) {
  if (!vs.length) return 0;
  if (t === 'hold' || t === 'retreat') return vehOrderAll(vs, t);
  const cx = vs.reduce((a, v) => a + v.x, 0) / vs.length, cy = vs.reduce((a, v) => a + v.y, 0) / vs.length;
  const ang = face ?? Math.atan2(y - cy, x - cx), lx = -Math.sin(ang), ly = Math.cos(ang);
  const key = v => v.x * lx + v.y * ly, srt = vs.slice().sort((a, b) => key(a) - key(b));
  let n = 0, bad = 0;
  srt.forEach((v, i) => {
    const k = (i - (srt.length - 1) / 2) * 26, tx = x + lx * k, ty = y + ly * k;
    v.auto = false; v.man = true; v.ai = null; v.cmd = null; v.clearAt = t === 'clear' && vehSp(v).flail ? { x: tx, y: ty } : null;
    if (vehReach(v, tx, ty) || vehReach(v, x, y)) { vehSetOrder(v, t === 'clear' ? (vehSp(v).flail ? 'clear' : 'move') : t, tx, ty, face); n++; } else bad++;
  });
  if (bad) log(`${bad} 辆车辆无法到达该位置`, 'warn', 'vunreach', 2);
  return n;
}
// 与步兵一同下令：车辆落在步兵队形后方 55（人多时分到两翼）
function vehOrderWith(vs, units, x, y, face, t) {
  if (!vs.length) return 0;
  const cx = units.reduce((a, u) => a + u.x, 0) / units.length, cy = units.reduce((a, u) => a + u.y, 0) / units.length;
  const f = face ?? Math.atan2(y - cy, x - cx), back = t === 'amove' ? 45 : 55;
  return vehOrder(vs, x - Math.cos(f) * back, y - Math.sin(f) * back, t === 'charge' ? 'amove' : t, f);
}
// 坚守 / 后撤（后撤到最近的补给点或搁滩舰船，近距离倒车）
function vehOrderAll(vs, t) {
  for (const v of vs) {
    v.auto = false; v.man = true; v.ai = null; v.cmd = null; v.clearAt = null;
    if (t === 'hold') { v.order = { t: 'hold', face: v.heading }; continue; }
    const p = vehDepot(v), bh = S.ships.filter(s => s.state === 'beached').sort((a, b) => dist(a.bx, a.by, v.x, v.y) - dist(b.bx, b.by, v.x, v.y))[0];
    const g = p && (!bh || dist(p.x, p.y, v.x, v.y) < dist(bh.bx, bh.by, v.x, v.y) + 100) ? { x: p.x, y: p.y + 15 } : bh ? { x: bh.bx, y: bh.by - 30 } : { x: v.x, y: Math.min(v.y + 120, coastAt(v.x) - 20) };
    vehSetOrder(v, 'retreat', g.x, g.y, v.heading);
  }
  if (vs.length) log(t === 'hold' ? `${vs.length} 辆车辆就地坚守` : `${vs.length} 辆车辆后撤`, t === 'hold' ? 'info' : 'warn', 'vord', 1);
  return vs.length;
}

// ———————————————— 绘制（只在浏览器里调用）————————————————
// 俯视剪影：履带（带滚动的履带纹）、车体、炮塔随 aim 转动、炮管后坐、炮口焰、行进扬尘、泅渡尾浪、受损冒烟起火、残骸
// 我方绿色、敌方红色（只在看得见时画，看不见时在最后标定位置画虚线轮廓）；全图时剪影至少约 13px，放大后显示细节
const VEHV = { S: null, trail: {} };
const VEH_DARK = 'rgba(2,10,6,.9)', VEH_DARKE = 'rgba(28,4,10,.92)';
const vehK = v => Math.max(1, px(13) / vehSp(v).len);
function vehVSync() { if (VEHV.S !== S) { VEHV.S = S; VEHV.trail = {}; } }

// 履带印（渲染缓存）：最近 25 秒的轨迹点
function vehTrail(v) {
  const tr = VEHV.trail[v.id] || (VEHV.trail[v.id] = []), l = tr[tr.length - 1];
  if (l && (l.t > S.t || dist(l.x, l.y, v.x, v.y) > 60)) tr.length = 0;
  const e = tr[tr.length - 1];
  if (!v.dead && !v.swim && (!e || dist(e.x, e.y, v.x, v.y) > 3.5)) tr.push({ x: v.x, y: v.y, h: v.heading, t: S.t });
  while (tr.length && (S.t - tr[0].t > 25 || tr.length > 90)) tr.shift();
  return tr;
}

function vehDrawUnder(time) {
  if (!S || !S.veh || !S.veh.length) return;
  vehVSync();
  const ctx = R.ctx;
  for (const v of S.veh) {
    const tr = vehTrail(v);
    if (v.side === 'e' && !inVision(v.x, v.y)) continue;
    if (R.zr > 1.6 && tr.length > 1 && inView(v.x, v.y, 300)) {   // 履带印：两条淡线
      const o = vehSp(v).wid * .36;
      ctx.lineWidth = px(.8);
      for (let i = 1; i < tr.length; i++) {
        const p0 = tr[i - 1], p1 = tr[i], f = clamp(1 - (S.t - p1.t) / 25, 0, 1);
        if (dist(p0.x, p0.y, p1.x, p1.y) > 12) continue;
        ctx.strokeStyle = rgba(COL.smoke, .13 * f);
        const s0 = Math.sin(p0.h), c0 = Math.cos(p0.h), s1 = Math.sin(p1.h), c1 = Math.cos(p1.h);
        ctx.beginPath();
        ctx.moveTo(p0.x - s0 * o, p0.y + c0 * o); ctx.lineTo(p1.x - s1 * o, p1.y + c1 * o);
        ctx.moveTo(p0.x + s0 * o, p0.y - c0 * o); ctx.lineTo(p1.x + s1 * o, p1.y - c1 * o);
        ctx.stroke();
      }
    }
    if (v.dead && inView(v.x, v.y, 40) && !v.swim) vehWreck(ctx, v, time);
  }
}

function vehDrawOver(time) {
  if (!S) return;
  vehVSync();
  const ctx = R.ctx;
  if (!R.fx3d) for (const s of S.vshots || []) vehDrawShot(ctx, s);   // 3D 时立体画（v3fx.js）
  for (const g of S.gren || []) vehDrawGren(ctx, g);
  if (!S.veh || !S.veh.length) return;
  vehDrawPlatoons(ctx);
  const agg = typeof hqAggHide === 'function';
  for (const v of S.veh) {
    if (v.dead || v.lst) continue;
    if (agg && !isSel(v.id) && hqAggHide('v', v.id)) continue;   // 远看：编进营的车画成排符号（hq.js）
    const vis = v.side === 'p' || inVision(v.x, v.y);
    if (!vis && v.kx == null) continue;
    const x = vis ? v.x : v.kx, y = vis ? v.y : v.ky;
    if (!inView(x, y, 60)) continue;
    const sel = v.side === 'p' && isSel(v.id);
    if (sel) vehDrawOrder(ctx, v, time);
    if (R.m3d && vis && typeof rlModelOf === 'function') { const M = rlModelOf(v); if (M && RLM[M.key]) continue; }   // 3D：车是立体模型（v3units.js）
    vehDraw(ctx, v, x, y, vis ? v.heading : v.kh ?? v.heading, vis ? v.aim : v.kh ?? v.heading, vis, time, sel);
  }
  if (S.phase === 'deploy' && typeof arrow === 'function') for (const v of S.veh) if (v.plan && !v.dead) arrow(ctx, v.x, v.y, v.plan.x, v.plan.y, rgba(isSel(v.id) ? COL.sel : COL.g, .75));
}
HOOK.drawUnder.push(vehDrawUnder);
HOOK.drawOver.push(vehDrawOver);

// 选中车辆：去向虚线、射程淡圈
function vehDrawOrder(ctx, v, time) {
  const o = v.order, sp = vehSp(v);
  if (o.x != null && o.t !== 'hold' && dist(v.x, v.y, o.x, o.y) > 8) {
    const col = o.t === 'amove' ? COL.enemy : o.t === 'retreat' ? COL.amber : COL.sel;
    ctx.strokeStyle = rgba(col, .55); ctx.lineWidth = px(1); ctx.setLineDash([px(3), px(5)]);
    ctx.beginPath(); ctx.moveTo(v.x, v.y); ctx.lineTo(o.x, o.y); ctx.stroke(); ctx.setLineDash([]);
    const d = Math.max(px(2.5), 1.5);
    ctx.fillStyle = rgba(col, .7); ctx.fillRect(o.x - d / 2, o.y - d / 2, d, d);
  }
  const g = sp.gun || sp.mg;
  if (g) {
    ctx.strokeStyle = rgba(COL.g, .12); ctx.lineWidth = px(1); ctx.setLineDash([px(3), px(6)]);
    ctx.beginPath(); ctx.arc(v.x, v.y, g.range * ((v.mod && v.mod.rng) || 1), 0, 7); ctx.stroke(); ctx.setLineDash([]);
  }
}

// 直瞄炮弹：一小段沿弹道飞行的亮线；火焰：琥珀色锥形喷流
function vehDrawShot(ctx, s) {
  const u = clamp(s.t / s.dur, 0, 1);
  if (!inView(s.x1, s.y1, 80) && !inView(s.x0, s.y0, 80)) return;
  if (s.k === 'flame') {
    const len = dist(s.x0, s.y0, s.x1, s.y1), a = Math.atan2(s.y1 - s.y0, s.x1 - s.x0), f = Math.min(1, u * 3) * (1 - u);
    ctx.save(); ctx.translate(s.x0, s.y0); ctx.rotate(a);
    const gr = ctx.createLinearGradient(0, 0, len, 0);
    gr.addColorStop(0, rgba('#fff3d6', .9 * f)); gr.addColorStop(.35, rgba(COL.amber, .75 * f)); gr.addColorStop(1, rgba(COL.enemy, .15 * f));
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.moveTo(0, -1); ctx.quadraticCurveTo(len * .6, -len * .1, len, -len * .16); ctx.lineTo(len, len * .16); ctx.quadraticCurveTo(len * .6, len * .1, 0, 1); ctx.closePath(); ctx.fill();
    ctx.restore();
    return;
  }
  const col = s.side === 'e' ? COL.enemy : s.k === 'ap' ? '#e9fff2' : COL.amber, x = lerp(s.x0, s.x1, u), y = lerp(s.y0, s.y1, u), b = Math.max(0, u - .35);
  ctx.strokeStyle = rgba(col, .9); ctx.lineWidth = px(1.3);
  ctx.beginPath(); ctx.moveTo(lerp(s.x0, s.x1, b), lerp(s.y0, s.y1, b)); ctx.lineTo(x, y); ctx.stroke();
}

// 坦克排队形示意：同一伙伴排（或同一进攻目标）的两辆以上车辆，按队形槽位的横向 / 纵深顺序排一条淡虚线（横队、楔形、纵队、梯队一眼看得出）；
// 守方的只在观战时画
function vehDrawPlatoons(ctx) {
  const G = {};
  for (const v of S.veh) {
    if (v.dead || v.lst || v.swim || (v.side === 'e' && !specAll())) continue;
    const k = v.buddy != null && v.esc ? 'b' + v.buddy : v.side === 'p' && v.sk != null && v.auto ? 's' + v.sk : null;
    if (k) (G[v.side + k] || (G[v.side + k] = [])).push(v);
  }
  ctx.lineWidth = px(1.1); ctx.setLineDash([px(4), px(4)]);
  for (const k in G) {
    const vs = G[k];
    if (vs.length < 2) continue;
    const form = vs[0].esc ? vs[0].esc.form : vs[0].vform, key = o => { const sl = o.esc ? [o.esc.lat || 0, o.esc.fb || 0] : o.vslot || [0, 0]; return form === 'column' ? sl[1] : sl[0]; };
    vs.sort((a, b) => key(a) - key(b) || a.id - b.id);
    if (!vs.some(o => inView(o.x, o.y, 60))) continue;
    ctx.strokeStyle = rgba(vs[0].side === 'e' ? COL.enemy : COL.g, .28);
    ctx.beginPath(); vs.forEach((o, i) => i ? ctx.lineTo(o.x, o.y) : ctx.moveTo(o.x, o.y)); ctx.stroke();
  }
  ctx.setLineDash([]);
}

// 手榴弹：亮点沿抛物线（最高约 10）飞向目标；守方的只在视野内画
function vehDrawGren(ctx, g) {
  const u = clamp(g.t / g.dur, 0, 1), x = lerp(g.x0, g.x1, u), y = lerp(g.y0, g.y1, u) - Math.sin(Math.PI * u) * 10;
  if (!inView(x, y, 20) || (g.side === 'e' && !specAll() && !inVision(x, y))) return;
  ctx.fillStyle = rgba(g.side === 'e' ? COL.enemy : '#e9fff2', .95);
  ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, px(1.8)), 0, 7); ctx.fill();
}

// 车体（局部坐标，车头 +x，单位：世界长度）
function vehHullPath(ctx, v) {
  const sp = vehSp(v), hl = sp.len / 2, hb = sp.wid / 2, t = v.type;
  ctx.beginPath();
  if (t === 'amtank') {   // 浮箱式车体：圆弧船艏
    ctx.moveTo(-hl, -hb * .86); ctx.lineTo(hl * .45, -hb * .86); ctx.quadraticCurveTo(hl * 1.05, -hb * .8, hl * 1.05, 0); ctx.quadraticCurveTo(hl * 1.05, hb * .8, hl * .45, hb * .86); ctx.lineTo(-hl, hb * .86);
  } else if (t === 'recon') {   // 轮式车：楔形车头
    ctx.moveTo(-hl, -hb * .62); ctx.lineTo(hl * .55, -hb * .62); ctx.lineTo(hl, -hb * .3); ctx.lineTo(hl, hb * .3); ctx.lineTo(hl * .55, hb * .62); ctx.lineTo(-hl, hb * .62);
  } else if (t === 'td') {   // 低矮战斗室，前装甲大倾角
    ctx.moveTo(-hl * .92, -hb * .7); ctx.lineTo(hl * .35, -hb * .7); ctx.lineTo(hl * .95, -hb * .4); ctx.lineTo(hl * .95, hb * .4); ctx.lineTo(hl * .35, hb * .7); ctx.lineTo(-hl * .92, hb * .7);
  } else {
    const f = t === 'apc' ? .7 : .78;
    ctx.moveTo(-hl * .94, -hb * .7); ctx.lineTo(hl * f, -hb * .7); ctx.lineTo(hl * .97, -hb * .5); ctx.lineTo(hl * .97, hb * .5); ctx.lineTo(hl * f, hb * .7); ctx.lineTo(-hl * .94, hb * .7);
  }
  ctx.closePath();
}

function vehBody(ctx, v, col, a, det, lw, time, vis, enemy) {
  const sp = vehSp(v), L = sp.len, B = sp.wid, hl = L / 2, hb = B / 2, t = v.type, dark = enemy ? VEH_DARKE : VEH_DARK;
  const fillA = vis ? (det ? 1 : 0) : -1;   // -1：虚线轮廓（失去接触）
  ctx.lineWidth = lw(1.1); ctx.strokeStyle = rgba(col, a);
  // 行走机构
  if (sp.wheel) {
    for (const wx of [-hl * .58, hl * .5]) for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.rect(wx - L * .1, s * hb * .82 - B * .14, L * .2, B * .28);
      if (fillA >= 0) { ctx.fillStyle = det ? 'rgba(4,8,6,.95)' : rgba(col, .5 * a); ctx.fill(); }
      ctx.stroke();
    }
  } else {
    const tw = B * (t === 'amtank' ? .2 : .26);
    for (const s of [-1, 1]) {
      const y0 = s < 0 ? -hb : hb - tw;
      ctx.beginPath(); ctx.rect(-hl, y0, L, tw);
      if (fillA >= 0) { ctx.fillStyle = det ? 'rgba(4,8,6,.95)' : rgba(col, .5 * a); ctx.fill(); }
      ctx.stroke();
      if (det && fillA >= 0) {   // 履带纹：随里程滚动
        ctx.beginPath();
        const g = 1.5, off = ((v.odo || 0) % g + g) % g;
        for (let x = -hl + off; x < hl; x += g) { ctx.moveTo(x, y0 + .25); ctx.lineTo(x, y0 + tw - .25); }
        ctx.strokeStyle = rgba(col, .35 * a); ctx.lineWidth = lw(.5); ctx.stroke();
        ctx.strokeStyle = rgba(col, a); ctx.lineWidth = lw(1.1);
      }
    }
  }
  // 车体
  vehHullPath(ctx, v);
  ctx.fillStyle = fillA > 0 ? dark : fillA === 0 ? rgba(col, .3 * a) : rgba(col, .06); ctx.fill();
  ctx.lineWidth = lw(det ? 1.1 : 1.4); ctx.stroke();
  if (det && vis) vehDeck(ctx, v, col, a, lw, time);
}

// 近看细节：发动机格栅、舱盖、工具箱等
function vehDeck(ctx, v, col, a, lw, time) {
  const sp = vehSp(v), L = sp.len, B = sp.wid, hl = L / 2, hb = B / 2, t = v.type;
  ctx.strokeStyle = rgba(col, .45 * a); ctx.lineWidth = lw(.55);
  ctx.beginPath();
  for (let x = -hl * .86; x < -hl * .52; x += .9) { ctx.moveTo(x, -hb * .42); ctx.lineTo(x, hb * .42); }   // 发动机格栅
  ctx.stroke();
  if (t === 'apc' || t === 'spg') {   // 敞开的载员舱 / 战斗室
    const x0 = t === 'apc' ? -hl * .45 : -hl * .5, w = t === 'apc' ? L * .58 : L * .48;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x0, -hb * .5, w, B * .5 * 2);
    ctx.strokeStyle = rgba(col, .6 * a); ctx.lineWidth = lw(.7); ctx.strokeRect(x0, -hb * .5, w, B * .5 * 2);
    if (t === 'apc') {   // 搭载的步兵
      const n = (v.ride || []).reduce((s, id) => { const q = S.teams.find(q => q.id === id); return s + (q ? q.men.length : 0); }, 0);
      ctx.fillStyle = rgba(col, .9 * a);
      for (let i = 0; i < n; i++) { ctx.beginPath(); ctx.arc(x0 + 1.3 + Math.floor(i / 2) * 2.6, (i % 2 ? 1 : -1) * hb * .24, .7, 0, 7); ctx.fill(); }
    }
  }
  if (t === 'flame_tank') {   // 车尾燃料罐
    ctx.strokeStyle = rgba(col, .7 * a); ctx.lineWidth = lw(.7);
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(-hl * .78, s * hb * .3, B * .14, 0, 7); ctx.stroke(); }
  }
  if (t === 'mine_tank') {   // 连枷扫雷器：两根悬臂 + 旋转滚筒 + 铁链
    const dx = hl + 4.6, spin = v.moving ? time * 14 : 0;
    ctx.strokeStyle = rgba(col, .9 * a); ctx.lineWidth = lw(.9);
    ctx.beginPath(); ctx.moveTo(hl * .6, -hb * .82); ctx.lineTo(dx, -hb * .82); ctx.moveTo(hl * .6, hb * .82); ctx.lineTo(dx, hb * .82); ctx.stroke();
  }
}

// 炮塔 / 战斗室 / 炮管（随 aim 转动；开火后短暂后坐 + 炮口焰）
function vehTurret(ctx, v, col, a, det, lw, vis, enemy, time) {
  const real = vis && typeof realLook === 'function' && realLook();   // 写实：炮塔用涂装、炮管与边线用深色金属
  if (real) col = RL_EDGE;
  const sp = vehSp(v), L = sp.len, B = sp.wid, hl = L / 2, hb = B / 2, t = v.type, dark = real ? rlPal(v.side).tur : enemy ? 'rgba(44,6,16,.96)' : 'rgba(4,18,10,.96)';
  const since = S.t - v.fireT, rec = vis && since < .25 ? (1 - since / .25) * 1.6 : 0, ra = vehAng(v.aim - v.heading);
  ctx.strokeStyle = rgba(col, a);
  const barrel = (x0, len, w) => {
    ctx.lineWidth = lw(w); ctx.beginPath(); ctx.moveTo(x0 - rec, 0); ctx.lineTo(x0 + len - rec, 0); ctx.stroke();
    if (det && vis && (t === 'tank' || t === 'hv_tank' || t === 'td')) { ctx.lineWidth = lw(w * 1.6); ctx.beginPath(); ctx.moveTo(x0 + len - rec - 1, 0); ctx.lineTo(x0 + len - rec, 0); ctx.stroke(); }   // 炮口制退器
    if (vis && since < .12 && !(sp.gun && sp.gun.flame)) {
      const u = since / .12;
      ctx.fillStyle = rgba(COL.amber, (1 - u) * .9);
      ctx.beginPath(); ctx.moveTo(x0 + len, -1.2); ctx.lineTo(x0 + len + 5 * (1 - u * .4), 0); ctx.lineTo(x0 + len, 1.2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = rgba('#fff3d6', 1 - u); ctx.beginPath(); ctx.arc(x0 + len + .6, 0, 1.6, 0, 7); ctx.fill();
    }
  };
  const fill = () => { if (vis) { ctx.fillStyle = real ? (det ? rlLit(ctx, v.heading, L * .5, B * .7, dark) : dark) : det ? dark : rgba(col, .55 * a); ctx.fill(); } };
  if (!sp.tur) {   // 无炮塔：战斗室固定，炮管随小射界偏转
    if (t === 'spg') {
      ctx.save(); ctx.translate(-hl * .15, 0); ctx.rotate(ra);
      ctx.beginPath(); ctx.rect(-L * .12, -hb * .52, L * .32, hb * 1.04); fill(); ctx.lineWidth = lw(1); ctx.stroke();
      barrel(L * .18, sp.bar, 1.8);
      ctx.restore();
    } else if (t === 'td') {
      ctx.beginPath(); ctx.moveTo(-hl * .5, -hb * .5); ctx.lineTo(hl * .2, -hb * .5); ctx.lineTo(hl * .55, -hb * .3); ctx.lineTo(hl * .55, hb * .3); ctx.lineTo(hl * .2, hb * .5); ctx.lineTo(-hl * .5, hb * .5); ctx.closePath();
      fill(); ctx.lineWidth = lw(1); ctx.stroke();
      ctx.save(); ctx.translate(hl * .5, 0); ctx.rotate(ra); barrel(0, sp.bar, 1.7); ctx.restore();
    } else if (t === 'apc') {   // 车首机枪环
      ctx.save(); ctx.translate(hl * .48, 0);
      ctx.beginPath(); ctx.arc(0, 0, B * .17, 0, 7); fill(); ctx.lineWidth = lw(.9); ctx.stroke();
      ctx.rotate(ra); ctx.lineWidth = lw(.9); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(B * .5, 0); ctx.stroke();
      if (vis && S.t - (v.mgT ?? -99) < .12) { ctx.fillStyle = rgba(COL.amber, .9); ctx.beginPath(); ctx.arc(B * .55, 0, .8, 0, 7); ctx.fill(); }
      ctx.restore();
    }
    return;
  }
  const tx = t === 'amtank' ? hl * .08 : t === 'mine_tank' ? -hl * .05 : -hl * .08;
  ctx.save(); ctx.translate(tx, 0); ctx.rotate(ra);
  const r = sp.tur;
  ctx.beginPath();
  if (t === 'hv_tank') { ctx.moveTo(-r * 1, -r * .85); ctx.lineTo(r * .85, -r * .85); ctx.lineTo(r * 1.05, -r * .55); ctx.lineTo(r * 1.05, r * .55); ctx.lineTo(r * .85, r * .85); ctx.lineTo(-r * 1, r * .85); ctx.closePath(); }
  else if (t === 'aa_veh' || t === 'sam_veh') ctx.arc(0, 0, r, 0, 7);
  else ctx.ellipse(0, 0, r * 1.08, r * .9, 0, 0, 7);
  fill(); ctx.lineWidth = lw(det ? 1 : 1.3); ctx.stroke();
  if (t === 'sam_veh') {   // 双联装机关炮 + 炮塔两侧导弹发射箱 + 炮塔后部旋转的搜索雷达
    ctx.lineWidth = lw(.7);
    ctx.beginPath(); for (const y of [-.7, .7]) { ctx.moveTo(.5, y); ctx.lineTo(r + sp.bar, y); } ctx.stroke();
    ctx.lineWidth = lw(.6);
    for (const y of [-1, 1]) { ctx.beginPath(); ctx.rect(-r * .55, y > 0 ? r * .45 : -r, r * 1.3, r * .55); fill(); ctx.stroke(); }
    if (vis && S.t - (v.mgT ?? -99) < .1) { ctx.fillStyle = rgba(COL.amber, .9); ctx.beginPath(); ctx.arc(r + sp.bar + .6, 0, 1.2, 0, 7); ctx.fill(); }
    if (vis && S.t - (v.samT ?? -99) < .3) { ctx.fillStyle = rgba('#fff3d6', .9); ctx.beginPath(); ctx.arc(r * .8, (v.samN % 2 ? 1 : -1) * r * .72, 1.3, 0, 7); ctx.fill(); }
    if (det) { const rr = v.dead ? 0 : time * 3; ctx.strokeStyle = rgba(col, .7 * a); ctx.beginPath(); ctx.moveTo(-r * .7 - Math.cos(rr) * 1.8, -Math.sin(rr) * 1.8); ctx.lineTo(-r * .7 + Math.cos(rr) * 1.8, Math.sin(rr) * 1.8); ctx.stroke(); }
  } else if (t === 'aa_veh') {   // 四联高射机枪
    ctx.lineWidth = lw(.6);
    ctx.beginPath(); for (const y of [-1.1, -.4, .4, 1.1]) { ctx.moveTo(.5, y); ctx.lineTo(r + sp.bar, y); } ctx.stroke();
    if (vis && S.t - (v.mgT ?? -99) < .1) { ctx.fillStyle = rgba(COL.amber, .9); ctx.beginPath(); ctx.arc(r + sp.bar + .6, 0, 1.4, 0, 7); ctx.fill(); }
    if (det) { ctx.beginPath(); ctx.arc(0, 0, r * .55, 0, 7); ctx.strokeStyle = rgba(col, .4 * a); ctx.stroke(); }
  } else {
    const w = t === 'hv_tank' ? 1.9 : t === 'flame_tank' ? 1.8 : t === 'lt_tank' || t === 'recon' || t === 'amtank' ? 1.1 : 1.4;
    barrel(r * .8, sp.bar, w);
    if (t === 'flame_tank' && vis) { ctx.fillStyle = rgba(COL.amber, .8 * a); ctx.beginPath(); ctx.arc(r * .8 + sp.bar, 0, .9, 0, 7); ctx.fill(); }   // 引火嘴
    if (det && vis) {   // 指挥塔与舱盖
      ctx.strokeStyle = rgba(col, .55 * a); ctx.lineWidth = lw(.6);
      ctx.beginPath(); ctx.arc(-r * .35, -r * .3, r * .3, 0, 7); ctx.stroke();
      if (sp.mg) { ctx.beginPath(); ctx.moveTo(-r * .1, r * .45); ctx.lineTo(r * .6, r * .45); ctx.stroke(); }   // 并列机枪
      if (S.t - (v.mgT ?? -99) < .1) { ctx.fillStyle = rgba(COL.amber, .9); ctx.beginPath(); ctx.arc(r * .7, r * .45, .7, 0, 7); ctx.fill(); }
    }
  }
  ctx.restore();
  if (t === 'mine_tank' && vis) {   // 滚筒与铁链（画在炮塔之后，车头最前）
    const dx = hl + 4.6, spin = v.moving ? time * 14 : 0;
    ctx.fillStyle = dark; ctx.strokeStyle = rgba(col, a); ctx.lineWidth = lw(.9);
    ctx.beginPath(); ctx.rect(dx - .9, -hb * 1.02, 1.8, B * 1.02); ctx.fill(); ctx.stroke();
    if (det) {
      ctx.strokeStyle = rgba(col, .6 * a); ctx.lineWidth = lw(.5);
      ctx.beginPath();
      for (let k = 0; k < 7; k++) { const y = -hb * .9 + k * B * .9 / 6, l = 1.2 + Math.abs(Math.sin(spin + k * 1.3)) * 1.8; ctx.moveTo(dx + .9, y); ctx.lineTo(dx + .9 + l, y + Math.cos(spin + k) * .4); }
      ctx.stroke();
    }
  }
}

// 一辆车：扬尘 / 尾浪 → 剪影 → 冒烟起火 → 状态标记（选中括角、血条、编组点、履带损坏）
function vehDraw(ctx, v, x, y, h, aim, vis, time, sel) {
  const sp = vehSp(v), enemy = v.side === 'e', col = enemy ? COL.enemy : sel ? COL.g : COL.g, k = vehK(v), L = sp.len, lod = L * k * R.s, det = lod >= 34;
  const a = vis ? (v.side === 'p' && v.ammo <= 0 && sp.gun && !sp.gun.flame ? .6 + .3 * Math.sin(time * 6) : 1) : clamp(.6 - (S.t - v.seen) / 120, .25, .6);
  const lw = n => px(n) / k, ch = Math.cos(h), sh = Math.sin(h);
  if (vis && v.moving && !v.swim && det) for (let i = 0; i < 4; i++) {   // 行进扬尘（近看才画）
    const u = (time * 1.5 + i / 4 + v.id * .17) % 1, d = (L * .55 + u * 12) * k, s = Math.sin(i * 2.3 + v.id) * 3 * k;
    ctx.fillStyle = rgba(COL.smoke, .14 * (1 - u));
    ctx.beginPath(); ctx.arc(x - ch * d - sh * s, y - sh * d + ch * s, (1.6 + u * 4) * k, 0, 7); ctx.fill();
  }
  if (vis && v.swim) {   // 泅渡：V 形尾浪 + 车体周围的水线
    const wl = (v.moving ? 1 : .4);
    if (typeof shVWake === 'function') shVWake(ctx, x, y, h, L, sp.wid, k, typeof SH_FOAM === 'string' ? SH_FOAM : '#d4fff0', .4 * wl);
  }
  ctx.save(); ctx.translate(x, y); ctx.rotate(h); ctx.scale(k, k);
  if (!vis) ctx.setLineDash([px(2.5) / k, px(2) / k]);
  const rm = vis && typeof realLook === 'function' && realLook() && typeof rlModelOf === 'function' ? rlModelOf(v) : null;   // 写实：按实车外形建模（models.js）
  if (rm) rlVehModel(ctx, v, rm, h, aim, det, lw, a, col, time);
  else {
    if (typeof realLook === 'function' && realLook()) vehBodyReal(ctx, v, col, a, det, lw, time, vis, enemy);
    else vehBody(ctx, v, col, a, det, lw, time, vis, enemy);
    vehTurret(ctx, v, col, a, det, lw, vis, enemy, time);
  }
  if (vis && v.swim) {   // 水线：车体半没入水中
    ctx.strokeStyle = rgba('#d4fff0', .35); ctx.lineWidth = lw(.8);
    ctx.beginPath(); ctx.ellipse(0, 0, L * .56, sp.wid * .62, 0, 0, 7); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
  if (!vis) return;
  // 受损冒烟、起火
  if (v.hp < v.maxhp * .5 || v.burn > 0) vehSmoke(ctx, x, y, k, time, v.id, v.burn > 0 ? .7 : .35, v.burn > 0);
  // 选中括角
  const half = (Math.abs(ch) * L + Math.abs(sh) * sp.wid) / 2 * k, halfY = (Math.abs(sh) * L + Math.abs(ch) * sp.wid) / 2 * k;
  if (sel) {
    const hx = half + px(4), hy = halfY + px(4), m = Math.max(px(3), Math.min(hx, hy) * .45);
    ctx.strokeStyle = COL.sel; ctx.lineWidth = px(1.5);
    ctx.beginPath();
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.moveTo(x + dx * hx, y + dy * (hy - m)); ctx.lineTo(x + dx * hx, y + dy * hy); ctx.lineTo(x + dx * (hx - m), y + dy * hy); }
    ctx.stroke();
  }
  // 血条（受损或选中时显示）与编组点
  const by = y + halfY + px(4), bw = Math.max(L * k * .9, px(12));
  if (v.hp < v.maxhp || sel) {
    const f = Math.max(0, v.hp) / v.maxhp;
    ctx.fillStyle = rgba(enemy ? COL.enemy : COL.g, .22); ctx.fillRect(x - bw / 2, by, bw, px(2));
    ctx.fillStyle = enemy ? COL.enemy : f < .35 ? COL.enemy : f < .6 ? COL.amber : COL.g; ctx.fillRect(x - bw / 2, by, bw * f, px(2));
  }
  if (v.immob) {   // 履带损坏：琥珀色断链标记
    ctx.strokeStyle = rgba(COL.amber, .9); ctx.lineWidth = px(1.3);
    const r = px(3), cx = x - bw / 2 - px(5), cy = by + px(1);
    ctx.beginPath(); ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx - r * .2, cy - r * .2); ctx.moveTo(cx + r * .2, cy + r * .2); ctx.lineTo(cx + r, cy + r); ctx.stroke();
  }
  if (!enemy && typeof groupOf === 'function' && typeof pips === 'function') { const g = groupOf(v.id); if (g) pips(ctx, g, x, by + px(6), COL.sel); }
  if (!enemy && v.sup > 50 && R.fig) { ctx.fillStyle = rgba(COL.amber, .8); ctx.fillRect(x - bw / 2, by + px(3), bw * Math.min(1, v.sup / 100), px(1.2)); }   // 乘员受压制
}

function vehSmoke(ctx, x, y, k, time, seed, a0, fire) {
  const sk = Math.sqrt(k);
  for (let i = 0; i < 5; i++) {
    const u = (time * .45 + i / 5 + seed * .29) % 1;
    ctx.fillStyle = rgba(COL.smoke, a0 * .32 * (1 - u));
    ctx.beginPath(); ctx.arc(x + Math.sin(i * 1.7 + time) * 2 * sk + u * 9 * sk, y - u * 20 * sk, (1.6 + u * 6) * sk, 0, 7); ctx.fill();
  }
  if (fire) for (let i = 0; i < 3; i++) {
    const f = .5 + .5 * Math.sin(time * 17 + i * 2.1 + seed);
    ctx.fillStyle = rgba(i ? COL.amber : '#fff3d6', (.35 + .45 * f) * (i ? 1 : .7));
    ctx.beginPath(); ctx.arc(x + (i - 1) * 1.6 * sk, y - f * 2 * sk, (1 + f * .9) * sk * (i ? 1 : .6), 0, 7); ctx.fill();
  }
}

// 残骸：压暗的虚线车体、炮塔歪斜、交叉线；击毁后 45 秒内冒黑烟
function vehWreck(ctx, v, time) {
  if (v.side === 'e' && v.kx == null && !inVision(v.x, v.y)) return;
  const sp = vehSp(v), k = vehK(v), col = v.side === 'e' ? COL.enemy : COL.g, lw = n => px(n) / k;
  if (typeof realLook === 'function' && realLook()) {
    vehWreckReal(ctx, v, sp, k);
    const age = S.t - (v.deadT ?? -99);
    if (age < 45) vehSmoke(ctx, v.x, v.y, k, time, v.id, 1 - age / 45, age < 12);
    return;
  }
  ctx.save(); ctx.translate(v.x, v.y); ctx.rotate(v.kh ?? v.heading); ctx.scale(k, k);
  vehHullPath(ctx, v); ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fill();
  ctx.setLineDash([lw(2), lw(2.2)]); ctx.strokeStyle = rgba(col, .32); ctx.lineWidth = lw(1); ctx.stroke(); ctx.setLineDash([]);
  if (sp.tur) { ctx.beginPath(); ctx.arc(sp.len * .1, sp.wid * .18, sp.tur * .9, 0, 7); ctx.strokeStyle = rgba(col, .25); ctx.stroke(); ctx.beginPath(); ctx.moveTo(sp.len * .1, sp.wid * .18); ctx.lineTo(sp.len * .1 + Math.cos(.7) * sp.bar, sp.wid * .18 + Math.sin(.7) * sp.bar); ctx.stroke(); }
  ctx.restore();
  const age = S.t - (v.deadT ?? -99);
  if (age < 45) vehSmoke(ctx, v.x, v.y, k, time, v.id, 1 - age / 45, age < 12);
}

// —— 界面辅助（ui.js 调用）——
// 点选：点在（远景放大后的）车辆剪影内，或离车辆中心 8px 以内
function pickVeh(p) {
  if (!S || !S.veh || !p) return null;
  let best = null, bd = 1e9;
  for (const v of S.veh) {
    if (v.dead || v.side !== 'p' || v.lst) continue;
    const sp = vehSp(v), k = vehK(v), dx = p.x - v.x, dy = p.y - v.y, c = Math.cos(v.heading), s = Math.sin(v.heading);
    const lx = dx * c + dy * s, ly = -dx * s + dy * c, d = Math.hypot(dx, dy), m = px(3);
    if ((Math.abs(lx) <= sp.len / 2 * k + m && Math.abs(ly) <= sp.wid / 2 * k + m) || d < px(8)) if (d < bd) { bd = d; best = v.id; }
  }
  return best;
}
